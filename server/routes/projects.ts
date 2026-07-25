import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../auth/authorization.js';
import { db } from '../db/pool.js';
import { config } from '../config.js';
import { DEV_PROJECT_ID, devOrders, devProjectSubmissions } from '../db/dev-store.js';
import { randomUUID } from 'node:crypto';

const memoryMode = () => config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE;

export async function projectRoutes(app: FastifyInstance) {
  app.post('/projects/:projectId/submissions', { preHandler: requirePermission('progress.write') }, async (request, reply) => {
    const params = z.object({ projectId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      repositoryUrl: z.url().optional(),
      artifactUrl: z.url().optional(),
      notes: z.string().max(5000).default(''),
    }).refine((value) => value.repositoryUrl || value.artifactUrl, 'A repository or artifact is required').safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const hasEnrollment = request.user!.email === 'student@yasser-ai.demo' ||
        [...devOrders.values()].some((order) => order.userId === request.user!.id && order.status === 'succeeded');
      if (params.data.projectId !== DEV_PROJECT_ID || !hasEnrollment) {
        return reply.code(404).send({ code: 'PROJECT_NOT_ACCESSIBLE' });
      }
      const submission = {
        id: randomUUID(), projectId: params.data.projectId, userId: request.user!.id,
        ...input.data, status: 'submitted', submittedAt: new Date().toISOString(),
      };
      devProjectSubmissions.set(submission.id, submission);
      return reply.code(201).send({ data: submission });
    }
    const result = await db.query(
      `INSERT INTO project_submissions(project_id,user_id,repository_url,artifact_url,notes,status,submitted_at)
       SELECT $1,$2,$3,$4,$5,'submitted',now() FROM projects p
       JOIN enrollments e ON e.course_id=p.course_id AND e.user_id=$2 AND e.status='active'
       WHERE p.id=$1 AND p.status='published' RETURNING *`,
      [params.data.projectId, request.user!.id, input.data.repositoryUrl, input.data.artifactUrl, input.data.notes],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'PROJECT_NOT_ACCESSIBLE' });
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.put('/submissions/:submissionId/grade', { preHandler: requirePermission('submission.grade') }, async (request, reply) => {
    const params = z.object({ submissionId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      score: z.number().int().min(0).max(100),
      rubricResult: z.record(z.string(), z.number().nonnegative()),
      feedback: z.string().min(3).max(10_000),
      revisionRequested: z.boolean().default(false),
    }).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const submission = devProjectSubmissions.get(params.data.submissionId);
      if (!submission || !['submitted', 'revision_requested'].includes(submission.status)) {
        return reply.code(404).send({ code: 'SUBMISSION_NOT_FOUND' });
      }
      Object.assign(submission, {
        score: input.data.score, rubricResult: input.data.rubricResult, feedback: input.data.feedback,
        status: input.data.revisionRequested ? 'revision_requested' : 'graded',
        gradedAt: new Date().toISOString(), gradedBy: request.user!.id,
      });
      return { data: submission };
    }
    const result = await db.query(
      `UPDATE project_submissions SET score=$1,rubric_result=$2,feedback=$3,
       status=$4,graded_at=now(),graded_by=$5 WHERE id=$6 AND status IN ('submitted','revision_requested')
       RETURNING *`,
      [input.data.score, JSON.stringify(input.data.rubricResult), input.data.feedback,
        input.data.revisionRequested ? 'revision_requested' : 'graded', request.user!.id, params.data.submissionId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'SUBMISSION_NOT_FOUND' });
    return { data: result.rows[0] };
  });
}
