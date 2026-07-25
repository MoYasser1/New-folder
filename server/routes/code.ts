import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../auth/authorization.js';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { runPython } from '../services/code-runner.js';

export async function codeRoutes(app: FastifyInstance) {
  app.post('/code/run', {
    preHandler: requirePermission('progress.write'),
    config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const input = z.object({
      source: z.string().min(1).max(4000),
      expectedOutput: z.string().max(1000).default('أنا مستعد للمستقبل!'),
      exerciseId: z.uuid().optional(),
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    try {
      const result = await runPython(input.data.source, input.data.expectedOutput);
      if (input.data.exerciseId && !(config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE)) {
        await db.query(
          `INSERT INTO code_submissions(exercise_id,user_id,source_code,status,stdout,stderr,duration_ms)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [input.data.exerciseId, request.user!.id, input.data.source, result.status, result.stdout, result.stderr, result.durationMs],
        );
      }
      return { data: result };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'RUNNER_ERROR';
      return reply.code(code === 'UNSAFE_SOURCE' ? 422 : 503).send({ code });
    }
  });
}
