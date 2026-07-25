import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isProduction } from '../config.js';
import { db } from '../db/pool.js';
import { devSessions, devUsers, initializeDevStore } from '../db/dev-store.js';

export const SESSION_COOKIE = 'yaa_session';

export type AuthenticatedUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  emailVerified: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string, request: FastifyRequest, reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
  if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
    devSessions.set(hashToken(token), { id: randomUUID(), userId, expiresAt: expiresAt.getTime() });
  } else await db.query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), request.headers['user-agent']?.slice(0, 500), request.ip, expiresAt],
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    expires: expiresAt,
    signed: false,
  });
}

export async function loadUser(request: FastifyRequest) {
  request.user = null;
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
    await initializeDevStore();
    const session = devSessions.get(hashToken(token));
    const user = session && session.expiresAt > Date.now()
      ? [...devUsers.values()].find((candidate) => candidate.id === session.userId)
      : undefined;
    if (user) request.user = { id: user.id, email: user.email, fullName: user.fullName, role: user.role, emailVerified: user.emailVerified };
    return;
  }
  const result = await db.query<{
    id: string; email: string; full_name: string; role: string; email_verified_at: Date | null;
  }>(
    `SELECT u.id, u.email, u.full_name, u.role, u.email_verified_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND u.deleted_at IS NULL`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (row) request.user = { id: row.id, email: row.email, fullName: row.full_name, role: row.role, emailVerified: Boolean(row.email_verified_at) };
}

export async function revokeSession(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (token && config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) devSessions.delete(hashToken(token));
  else if (token) await db.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
