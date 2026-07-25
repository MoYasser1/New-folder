import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import rawBody from 'fastify-raw-body';
import { createHash } from 'node:crypto';
import { config } from './config.js';
import { loadUser } from './auth/session.js';
import { authRoutes } from './routes/auth.js';
import { learningRoutes } from './routes/learning.js';
import { paymentRoutes } from './routes/payments.js';
import { portalRoutes } from './routes/portals.js';
import { placementRoutes } from './routes/placement.js';
import { tutorRoutes } from './routes/tutor.js';
import { accountRoutes } from './routes/account.js';
import { codeRoutes } from './routes/code.js';
import { credentialRoutes } from './routes/credentials.js';
import { projectRoutes } from './routes/projects.js';
import { verificationRoutes } from './routes/verification.js';
import { uploadRoutes } from './routes/uploads.js';
import { db } from './db/pool.js';

const isPrivateDevelopmentOrigin = (origin: string) => {
  if (config.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '3000') return false;
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ||
      /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname);
  } catch {
    return false;
  }
};

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : config.NODE_ENV === 'production' ? 'info' : 'warn',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', '*.password'],
    },
    trustProxy: config.NODE_ENV === 'production',
    requestIdHeader: 'x-request-id',
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === config.WEB_ORIGIN) return callback(null, true);
      if (isPrivateDevelopmentOrigin(origin)) {
        return callback(null, true);
      }
      return callback(Object.assign(new Error('Origin not allowed'), { statusCode: 403, code: 'ORIGIN_NOT_ALLOWED' }), false);
    },
    credentials: true,
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, {
    limits: { files: 1, fields: 5, fileSize: config.UPLOAD_MAX_BYTES },
  });
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const session = request.cookies?.yaa_session;
      return session ? `session:${createHash('sha256').update(session).digest('hex')}` : `ip:${request.ip}`;
    },
  });

  app.decorateRequest('user', null);
  app.addHook('preHandler', loadUser);
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) return { status: 'ready', database: 'development-memory' };
    try {
      await db.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(learningRoutes, { prefix: '/api' });
  await app.register(paymentRoutes, { prefix: '/api' });
  await app.register(portalRoutes, { prefix: '/api' });
  await app.register(placementRoutes, { prefix: '/api' });
  await app.register(tutorRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(codeRoutes, { prefix: '/api' });
  await app.register(credentialRoutes, { prefix: '/api' });
  await app.register(projectRoutes, { prefix: '/api' });
  await app.register(verificationRoutes, { prefix: '/api' });
  await app.register(uploadRoutes, { prefix: '/api' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ error, requestId: request.id }, 'Request failed');
    else request.log.warn({ code: error.code, status, requestId: request.id }, 'Request rejected');
    reply.code(status).send({
      code: status === 500 ? 'INTERNAL_ERROR' : error.code === 'ORIGIN_NOT_ALLOWED' ? 'ORIGIN_NOT_ALLOWED' : 'REQUEST_ERROR',
      message: status === 500 ? 'Unexpected server error' : error.message,
      requestId: request.id,
    });
  });
  return app;
}
