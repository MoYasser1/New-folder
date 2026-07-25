import { createHash, randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authorization.js';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { devAccountTokens, devUsers } from '../db/dev-store.js';
import { sendEmail } from '../services/email.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const memoryMode = () => config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE;

export async function verificationRoutes(app: FastifyInstance) {
  app.post('/auth/request-email-verification', {
    preHandler: requireUser,
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '15 minutes',
        keyGenerator: (request) => {
          const session = request.cookies.yaa_session;
          return session ? `session:${hash(session)}` : `ip:${request.ip}`;
        },
      },
    },
  }, async (request) => {
    if (request.user!.emailVerified) return { sent: false, alreadyVerified: true };
    const otp = randomInt(100_000, 1_000_000).toString();
    const otpHash = hash(otp);
    if (memoryMode()) {
      for (const [tokenHash, token] of devAccountTokens) {
        if (token.userId === request.user!.id && token.purpose === 'verify_email') devAccountTokens.delete(tokenHash);
      }
      devAccountTokens.set(otpHash, {
        userId: request.user!.id, purpose: 'verify_email', expiresAt: Date.now() + 10 * 60_000, attempts: 0,
      });
    } else {
      await db.query(`UPDATE account_tokens SET used_at=now() WHERE user_id=$1 AND purpose='verify_email' AND used_at IS NULL`, [request.user!.id]);
      await db.query(
        `INSERT INTO account_tokens(user_id,purpose,token_hash,expires_at)
         VALUES($1,'verify_email',$2,now()+interval '10 minutes')`, [request.user!.id, otpHash],
      );
    }
    await sendEmail({ to: request.user!.email, template: 'verify_email', variables: { otp, expiresMinutes: '10' } });
    return { sent: true, ...(config.EMAIL_PROVIDER === 'development' ? { developmentOtp: otp } : {}) };
  });

  app.post('/auth/verify-email', { preHandler: requireUser }, async (request, reply) => {
    const input = z.object({ otp: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const otpHash = hash(input.data.otp);
    if (memoryMode()) {
      const token = devAccountTokens.get(otpHash);
      if (!token || token.userId !== request.user!.id || token.purpose !== 'verify_email' || token.expiresAt < Date.now() || token.attempts >= 5) {
        const activeToken = [...devAccountTokens.values()].find((candidate) =>
          candidate.userId === request.user!.id && candidate.purpose === 'verify_email' && candidate.expiresAt >= Date.now());
        if (activeToken) activeToken.attempts += 1;
        return reply.code(400).send({ code: 'OTP_INVALID' });
      }
      const user = [...devUsers.values()].find((candidate) => candidate.id === request.user!.id);
      if (!user) return reply.code(400).send({ code: 'OTP_INVALID' });
      user.emailVerified = true;
      request.user!.emailVerified = true;
      devAccountTokens.delete(otpHash);
      return { verified: true };
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const token = await client.query<{ id: string }>(
        `SELECT id FROM account_tokens WHERE user_id=$1 AND purpose='verify_email' AND token_hash=$2
         AND used_at IS NULL AND expires_at>now() AND attempts<5 FOR UPDATE`, [request.user!.id, otpHash],
      );
      if (!token.rows[0]) {
        await client.query(
          `UPDATE account_tokens SET attempts=attempts+1 WHERE user_id=$1 AND purpose='verify_email' AND used_at IS NULL`, [request.user!.id],
        );
        await client.query('COMMIT');
        return reply.code(400).send({ code: 'OTP_INVALID' });
      }
      await client.query('UPDATE account_tokens SET used_at=now() WHERE id=$1', [token.rows[0].id]);
      await client.query('UPDATE users SET email_verified_at=now(),updated_at=now() WHERE id=$1', [request.user!.id]);
      await client.query('COMMIT');
      return { verified: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
