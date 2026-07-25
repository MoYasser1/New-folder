import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/pool.js';

const correctAnswers = [1, 1, 2, 0, 0, 2] as const;

export async function placementRoutes(app: FastifyInstance) {
  app.post('/placement/submit', async (request, reply) => {
    const input = z.object({
      anonymousId: z.uuid().optional(),
      answers: z.array(z.number().int().min(0).max(3)).length(correctAnswers.length),
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues });
    const correct = input.data.answers.filter((answer, index) => answer === correctAnswers[index]).length;
    const score = Math.round(correct / correctAnswers.length * 100);
    const level = score >= 80 ? 'مستكشف متقدم' : score >= 50 ? 'مستكشف واعد' : 'بداية جديدة';
    const result: {
      id: string;
      score: number;
      level: string;
      recommendedPath: string;
      strengths: string[];
      improvements: string[];
    } = {
      id: randomUUID(),
      score,
      level,
      recommendedPath: score >= 80 ? 'Python والذكاء الاصطناعي' : 'أساسيات البرمجة ثم Python',
      strengths: score >= 50 ? ['التفكير المنطقي', 'الاستعداد للتطبيق'] : ['الرغبة في التعلم'],
      improvements: score >= 80 ? ['بناء المشاريع'] : ['قراءة الكود', 'تفكيك المشكلات'],
    };
    if (!(config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE)) {
      const saved = await db.query<{ id: string }>(
        `INSERT INTO placement_attempts(user_id,anonymous_id,answers,score,level,recommended_path)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [request.user?.id, input.data.anonymousId, JSON.stringify(input.data.answers), score, level, result.recommendedPath],
      );
      result.id = saved.rows[0]!.id;
    }
    return reply.code(201).send({ data: result });
  });
}
