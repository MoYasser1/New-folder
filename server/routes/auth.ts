import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db/pool.js';
import { hashPassword, strongPasswordSchema, verifyPassword } from '../auth/password.js';
import { createSession, revokeSession } from '../auth/session.js';
import { requireUser } from '../auth/authorization.js';
import { config } from '../config.js';
import { devUsers, initializeDevStore } from '../db/dev-store.js';
import { randomUUID } from 'node:crypto';

const credentials = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
});
const registration = credentials.extend({
  password: strongPasswordSchema,
  fullName: z.string().trim().min(2).max(100),
  acceptedTerms: z.literal(true),
});
const dummyPasswordHash = hashPassword(`unavailable-${randomUUID()}`);

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registration.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: parsed.error.issues });
    const { email, password, fullName } = parsed.data;
    const passwordHash = await hashPassword(password);
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      await initializeDevStore();
      if (devUsers.has(email)) return reply.code(409).send({ code: 'EMAIL_EXISTS' });
      const user = {
        id: randomUUID(), email, fullName, role: 'student', passwordHash, emailVerified: false,
        failedLoginAttempts: 0, lockedUntil: null,
      };
      devUsers.set(email, user);
      await createSession(user.id, request, reply);
      return reply.code(201).send({ user: { id: user.id, email, fullName, role: user.role } });
    }
    try {
      const result = await db.query<{ id: string; role: string }>(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'student') RETURNING id, role`,
        [email, passwordHash, fullName],
      );
      const user = result.rows[0]!;
      await createSession(user.id, request, reply);
      return reply.code(201).send({ user: { id: user.id, email, fullName, role: user.role } });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ code: 'EMAIL_EXISTS', message: 'Email already registered' });
      }
      throw error;
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = credentials.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const { email, password } = parsed.data;
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      await initializeDevStore();
      const user = devUsers.get(email);
      const passwordMatches = await verifyPassword(password, user?.passwordHash ?? await dummyPasswordHash);
      if (!user || (user.lockedUntil !== null && user.lockedUntil > Date.now()) || !passwordMatches) {
        if (user) {
          user.failedLoginAttempts += 1;
          if (user.failedLoginAttempts >= 5) user.lockedUntil = Date.now() + 15 * 60_000;
        }
        return reply.code(401).send({ code: 'INVALID_CREDENTIALS' });
      }
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      await createSession(user.id, request, reply);
      return { user: { id: user.id, email, fullName: user.fullName, role: user.role } };
    }
    const result = await db.query<{
      id: string; password_hash: string; full_name: string; role: string;
      failed_login_attempts: number; locked_until: Date | null;
    }>('SELECT id, password_hash, full_name, role, failed_login_attempts, locked_until FROM users WHERE lower(email) = $1 AND deleted_at IS NULL', [email]);
    const user = result.rows[0];
    const passwordMatches = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash);
    if (!user || (user.locked_until && user.locked_until > new Date()) || !passwordMatches) {
      if (user) await db.query(
        `UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE WHEN failed_login_attempts >= 4 THEN now() + interval '15 minutes' ELSE locked_until END
         WHERE id = $1`, [user.id],
      );
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
    await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
    await createSession(user.id, request, reply);
    return { user: { id: user.id, email, fullName: user.full_name, role: user.role } };
  });

  app.post('/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    await revokeSession(request, reply);
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: requireUser }, async (request) => ({ user: request.user }));
}
