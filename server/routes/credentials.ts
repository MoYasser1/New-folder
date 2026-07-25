import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authorization.js';
import { config } from '../config.js';
import { db } from '../db/pool.js';

const demoCertificate = {
  verificationCode: 'YAA-DEMO-2026',
  studentName: 'محمد أحمد',
  courseTitle: 'انطلاقة البرمجة والذكاء الاصطناعي للثانوية',
  issuedAt: '2026-07-23T00:00:00.000Z',
  valid: true,
};

export async function credentialRoutes(app: FastifyInstance) {
  app.get('/certificates/verify/:code', async (request, reply) => {
    const parsed = z.object({ code: z.string().min(8).max(100) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      if (parsed.data.code !== demoCertificate.verificationCode) return reply.code(404).send({ code: 'CERTIFICATE_NOT_FOUND' });
      return { data: demoCertificate };
    }
    const result = await db.query(
      `SELECT c.verification_code "verificationCode",u.full_name "studentName",
       co.title "courseTitle",c.issued_at "issuedAt",(c.revoked_at IS NULL) valid
       FROM certificates c JOIN users u ON u.id=c.user_id JOIN courses co ON co.id=c.course_id
       WHERE c.verification_code=$1`, [parsed.data.code],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'CERTIFICATE_NOT_FOUND' });
    return { data: result.rows[0] };
  });

  app.get('/account/achievements', { preHandler: requireUser }, async (request) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) return { data: [
      { code: 'FIRST_MISSION', title: 'أول مهمة', description: 'أكملت أول مهمة تعليمية', points: 120, awardedAt: new Date().toISOString() },
    ] };
    const result = await db.query(
      `SELECT a.code,a.title,a.description,a.points,ua.awarded_at "awardedAt"
       FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id
       WHERE ua.user_id=$1 ORDER BY ua.awarded_at DESC`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.get('/account/certificates', { preHandler: requireUser }, async (request) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) return { data: [] };
    const result = await db.query(
      `SELECT c.verification_code "verificationCode",co.title "courseTitle",
       c.issued_at "issuedAt",c.revoked_at "revokedAt"
       FROM certificates c JOIN courses co ON co.id=c.course_id
       WHERE c.user_id=$1 ORDER BY c.issued_at DESC`, [request.user!.id],
    );
    return { data: result.rows };
  });
}
