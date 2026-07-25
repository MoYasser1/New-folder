import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authorization.js';
import { hashPassword, strongPasswordSchema, verifyPassword } from '../auth/password.js';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { devAccountTokens, devSessions, devUsers, initializeDevStore } from '../db/dev-store.js';
import { sendEmail } from '../services/email.js';

const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const inMemory = () => config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE;

export async function accountRoutes(app: FastifyInstance) {
  app.post('/auth/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request) => {
    const parsed = z.object({ email: z.email().transform((value) => value.toLowerCase()) }).safeParse(request.body);
    if (!parsed.success) return { accepted: true };
    const rawToken = randomBytes(32).toString('base64url');
    if (inMemory()) {
      await initializeDevStore();
      const user = devUsers.get(parsed.data.email);
      if (user) devAccountTokens.set(tokenHash(rawToken), {
        userId: user.id, purpose: 'reset_password', expiresAt: Date.now() + 30 * 60_000, attempts: 0,
      });
      if (user) try {
        await sendEmail({
          to: user.email,
          template: 'reset_password',
          variables: {
            resetUrl: `${config.WEB_ORIGIN}/?resetToken=${encodeURIComponent(rawToken)}`,
            expiresMinutes: '30',
          },
        });
      } catch (error) {
        request.log.error({ error, requestId: request.id }, 'Password reset email delivery failed');
      }
      return { accepted: true, ...(user ? { developmentToken: rawToken } : {}) };
    }
    const user = await db.query<{ id: string }>('SELECT id FROM users WHERE lower(email)=$1 AND deleted_at IS NULL', [parsed.data.email]);
    if (user.rows[0]) {
      await db.query(
        `INSERT INTO account_tokens(user_id,purpose,token_hash,expires_at)
         VALUES($1,'reset_password',$2,now()+interval '30 minutes')`,
        [user.rows[0].id, tokenHash(rawToken)],
      );
      await db.query(
        `INSERT INTO notifications(user_id,type,title,body)
         VALUES($1,'password_reset','استعادة كلمة المرور','تم طلب استعادة كلمة المرور. استخدم الرابط المرسل إلى بريدك خلال 30 دقيقة.')`,
        [user.rows[0].id],
      );
      try {
        await sendEmail({
          to: parsed.data.email,
          template: 'reset_password',
          variables: {
            resetUrl: `${config.WEB_ORIGIN}/?resetToken=${encodeURIComponent(rawToken)}`,
            expiresMinutes: '30',
          },
        });
      } catch (error) {
        request.log.error({ error, requestId: request.id }, 'Password reset email delivery failed');
      }
    }
    return { accepted: true };
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const parsed = z.object({ token: z.string().min(32), password: strongPasswordSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const hashedPassword = await hashPassword(parsed.data.password);
    const hashedToken = tokenHash(parsed.data.token);
    if (inMemory()) {
      const record = devAccountTokens.get(hashedToken);
      if (!record || record.expiresAt < Date.now()) return reply.code(400).send({ code: 'TOKEN_INVALID' });
      const user = [...devUsers.values()].find((candidate) => candidate.id === record.userId);
      if (!user) return reply.code(400).send({ code: 'TOKEN_INVALID' });
      user.passwordHash = hashedPassword;
      devAccountTokens.delete(hashedToken);
      for (const [key, session] of devSessions) if (session.userId === user.id) devSessions.delete(key);
      return { reset: true };
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const token = await client.query<{ id: string; user_id: string }>(
        `SELECT id,user_id FROM account_tokens WHERE token_hash=$1 AND purpose='reset_password'
         AND used_at IS NULL AND expires_at>now() FOR UPDATE`, [hashedToken],
      );
      if (!token.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ code: 'TOKEN_INVALID' });
      }
      await client.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2', [hashedPassword, token.rows[0].user_id]);
      await client.query('UPDATE account_tokens SET used_at=now() WHERE id=$1', [token.rows[0].id]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [token.rows[0].user_id]);
      await client.query('COMMIT');
      return { reset: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/account/sessions', { preHandler: requireUser }, async (request) => {
    if (inMemory()) {
      const currentHash = request.cookies.yaa_session ? tokenHash(request.cookies.yaa_session) : '';
      return { data: [...devSessions.entries()].filter(([, value]) => value.userId === request.user!.id)
        .map(([hash, value]) => ({ id: value.id, expiresAt: new Date(value.expiresAt), current: hash === currentHash })) };
    }
    const result = await db.query(
      `SELECT id,user_agent,ip_address,created_at,last_seen_at,expires_at,(token_hash=$2) current
       FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
       ORDER BY last_seen_at DESC`, [request.user!.id, request.cookies.yaa_session ? tokenHash(request.cookies.yaa_session) : ''],
    );
    return { data: result.rows };
  });

  app.delete('/account/sessions/:id', { preHandler: requireUser }, async (request, reply) => {
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (inMemory()) {
      const session = [...devSessions.entries()].find(([, value]) =>
        value.id === parsed.data.id && value.userId === request.user!.id);
      if (!session) return reply.code(404).send({ code: 'SESSION_NOT_FOUND' });
      devSessions.delete(session[0]);
      return reply.code(204).send();
    }
    await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2', [parsed.data.id, request.user!.id]);
    return reply.code(204).send();
  });

  app.get('/account/export', { preHandler: requireUser }, async (request) => {
    if (inMemory()) {
      return {
        exportedAt: new Date().toISOString(),
        profile: {
          id: request.user!.id, email: request.user!.email,
          fullName: request.user!.fullName, role: request.user!.role,
        },
        sessions: [...devSessions.values()].filter((session) => session.userId === request.user!.id)
          .map((session) => ({ id: session.id, expiresAt: new Date(session.expiresAt).toISOString() })),
      };
    }
    const [profile, enrollments, orders, progress, quizAttempts, projectSubmissions] = await Promise.all([
      db.query(`SELECT id,email,phone,full_name "fullName",role,created_at "createdAt" FROM users WHERE id=$1`, [request.user!.id]),
      db.query(`SELECT course_id "courseId",status,enrolled_at "enrolledAt",expires_at "expiresAt"
        FROM enrollments WHERE user_id=$1`, [request.user!.id]),
      db.query(`SELECT id,course_id "courseId",amount_minor "amountMinor",currency,status,created_at "createdAt"
        FROM orders WHERE user_id=$1`, [request.user!.id]),
      db.query(`SELECT lesson_id "lessonId",watched_seconds "watchedSeconds",completed_at "completedAt",
        last_position_seconds "lastPositionSeconds",updated_at "updatedAt" FROM lesson_progress WHERE user_id=$1`, [request.user!.id]),
      db.query(`SELECT quiz_id "quizId",answers,score,passed,submitted_at "submittedAt"
        FROM quiz_attempts WHERE user_id=$1`, [request.user!.id]),
      db.query(`SELECT project_id "projectId",repository_url "repositoryUrl",artifact_url "artifactUrl",
        notes,status,score,feedback,created_at "createdAt" FROM project_submissions WHERE user_id=$1`, [request.user!.id]),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      profile: profile.rows[0], enrollments: enrollments.rows, orders: orders.rows,
      progress: progress.rows, quizAttempts: quizAttempts.rows, projectSubmissions: projectSubmissions.rows,
    };
  });

  app.delete('/account', { preHandler: requireUser }, async (request, reply) => {
    const input = z.object({ password: z.string().min(8).max(128), confirmation: z.literal('DELETE') }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (inMemory()) {
      const user = devUsers.get(request.user!.email);
      if (!user || !(await verifyPassword(input.data.password, user.passwordHash))) {
        return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
      }
      for (const [key, session] of devSessions) if (session.userId === user.id) devSessions.delete(key);
      for (const [key, token] of devAccountTokens) if (token.userId === user.id) devAccountTokens.delete(key);
      devUsers.delete(user.email);
      reply.clearCookie('yaa_session', { path: '/' });
      return reply.code(204).send();
    }
    const user = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [request.user!.id]);
    if (!user.rows[0] || !(await verifyPassword(input.data.password, user.rows[0].password_hash))) {
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET email=('deleted+'||id::text||'@invalid.local'),phone=NULL,full_name='Deleted User',
         deleted_at=now(),updated_at=now() WHERE id=$1`, [request.user!.id],
      );
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [request.user!.id]);
      await client.query('UPDATE account_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [request.user!.id]);
      await client.query('COMMIT');
      reply.clearCookie('yaa_session', { path: '/' });
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
