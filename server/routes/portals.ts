import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, requireUser } from '../auth/authorization.js';
import { db } from '../db/pool.js';
import { config } from '../config.js';
import {
  devCourses, devLessons, devModules, devNotificationPreferences, devQuestions, devQuizzes, devUsers,
  devAuditLogs,
} from '../db/dev-store.js';
import { randomUUID } from 'node:crypto';
import { writeAuditLog } from '../services/audit.js';

const memoryMode = () => config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE;

export async function portalRoutes(app: FastifyInstance) {
  app.get('/parent/children', { preHandler: requirePermission('child.progress.read') }, async (request) => {
    if (memoryMode()) {
      const student = devUsers.get('student@yasser-ai.demo');
      return { data: student ? [{
        id: student.id, full_name: student.fullName, total_lessons: 8,
        completed_lessons: 1, watched_seconds: 700,
      }] : [] };
    }
    const result = await db.query(
      `SELECT u.id,u.full_name,
       count(DISTINCT l.id)::int total_lessons,
       count(DISTINCT lp.lesson_id) FILTER(WHERE lp.completed_at IS NOT NULL)::int completed_lessons,
       coalesce(sum(lp.watched_seconds),0)::int watched_seconds
       FROM parent_students ps JOIN users u ON u.id=ps.student_id
       LEFT JOIN enrollments e ON e.user_id=u.id AND e.status='active'
       LEFT JOIN modules m ON m.course_id=e.course_id LEFT JOIN lessons l ON l.module_id=m.id
       LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=u.id
       WHERE ps.parent_id=$1 AND ps.verified_at IS NOT NULL GROUP BY u.id`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.get('/admin/students/at-risk', { preHandler: requirePermission('student.progress.read') }, async () => {
    if (memoryMode()) return { data: [...devUsers.values()]
      .filter((user) => user.role === 'student')
      .map((user) => ({ id: user.id, full_name: user.fullName, email: user.email, last_activity: null, completed_lessons: 0 })) };
    const result = await db.query(
      `SELECT u.id,u.full_name,u.email,max(lp.updated_at) last_activity,
       count(DISTINCT lp.lesson_id) FILTER(WHERE lp.completed_at IS NOT NULL)::int completed_lessons
       FROM users u LEFT JOIN lesson_progress lp ON lp.user_id=u.id
       WHERE u.role='student' AND u.deleted_at IS NULL GROUP BY u.id
       HAVING max(lp.updated_at) < now()-interval '3 days' OR max(lp.updated_at) IS NULL
       ORDER BY last_activity NULLS FIRST LIMIT 100`,
    );
    return { data: result.rows };
  });

  app.get('/admin/audit-logs', { preHandler: requirePermission('audit.read') }, async (request, reply) => {
    const query = z.object({
      action: z.string().min(1).max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: query.error.issues });
    if (memoryMode()) {
      const data = devAuditLogs
        .filter((entry) => !query.data.action || entry.action === query.data.action)
        .slice()
        .reverse()
        .slice(0, query.data.limit)
        .map((entry) => ({
          id: entry.id, actor_id: entry.actorId, action: entry.action,
          resource_type: entry.resourceType, resource_id: entry.resourceId,
          request_id: entry.requestId, ip_address: entry.ipAddress,
          user_agent: entry.userAgent, metadata: entry.metadata, created_at: entry.createdAt,
        }));
      return { data };
    }
    const result = await db.query(
      `SELECT a.id,a.actor_id,u.full_name actor_name,a.action,a.resource_type,a.resource_id,
       a.request_id,a.ip_address,a.user_agent,a.metadata,a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
       WHERE ($1::text IS NULL OR a.action=$1)
       ORDER BY a.created_at DESC LIMIT $2`,
      [query.data.action ?? null, query.data.limit],
    );
    return { data: result.rows };
  });

  app.post('/admin/courses', { preHandler: requirePermission('course.create') }, async (request, reply) => {
    const input = z.object({
      slug: z.string().regex(/^[a-z0-9-]+$/).min(3).max(100),
      title: z.string().min(3).max(200),
      description: z.string().min(10).max(5000),
      priceMinor: z.number().int().nonnegative(),
      currency: z.string().length(3).default('EGP'),
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR', issues: input.error.issues });
    if (memoryMode()) {
      if ([...devCourses.values()].some((course) => course.slug === input.data.slug)) {
        return reply.code(409).send({ code: 'COURSE_SLUG_EXISTS' });
      }
      const course = {
        id: randomUUID(), slug: input.data.slug, title: input.data.title, description: input.data.description,
        instructorId: request.user!.id, priceMinor: input.data.priceMinor,
        currency: input.data.currency.toUpperCase(), status: 'draft',
      };
      devCourses.set(course.id, course);
      await writeAuditLog(request, 'course.create', 'course', course.id);
      return reply.code(201).send({ data: course });
    }
    const result = await db.query(
      `INSERT INTO courses(slug,title,description,instructor_id,price_minor,currency)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.data.slug, input.data.title, input.data.description, request.user!.id, input.data.priceMinor, input.data.currency.toUpperCase()],
    );
    await writeAuditLog(request, 'course.create', 'course', result.rows[0].id);
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.post('/admin/courses/:courseId/publish', { preHandler: requirePermission('lesson.publish') }, async (request, reply) => {
    const params = z.object({ courseId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const course = devCourses.get(params.data.courseId);
      if (!course) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      course.status = 'published';
      course.publishedAt ||= new Date().toISOString();
      await writeAuditLog(request, 'course.publish', 'course', course.id);
      return { data: { id: course.id, status: course.status, published_at: course.publishedAt } };
    }
    const result = await db.query(
      `UPDATE courses SET status='published',published_at=coalesce(published_at,now()),updated_at=now()
       WHERE id=$1 RETURNING id,status,published_at`, [params.data.courseId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
    await writeAuditLog(request, 'course.publish', 'course', params.data.courseId);
    return { data: result.rows[0] };
  });

  app.patch('/admin/courses/:courseId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ courseId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200).optional(),
      description: z.string().min(10).max(5000).optional(),
      priceMinor: z.number().int().nonnegative().optional(),
      currency: z.string().length(3).optional(),
    }).refine((value) => Object.keys(value).length > 0).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const course = devCourses.get(params.data.courseId);
      if (!course) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      if (input.data.title !== undefined) course.title = input.data.title;
      if (input.data.description !== undefined) course.description = input.data.description;
      if (input.data.priceMinor !== undefined) course.priceMinor = input.data.priceMinor;
      if (input.data.currency !== undefined) course.currency = input.data.currency.toUpperCase();
      return { data: course };
    }
    const result = await db.query(
      `UPDATE courses SET title=coalesce($1,title),description=coalesce($2,description),
       price_minor=coalesce($3,price_minor),currency=coalesce($4,currency),updated_at=now()
       WHERE id=$5 RETURNING *`,
      [input.data.title, input.data.description, input.data.priceMinor,
        input.data.currency?.toUpperCase(), params.data.courseId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
    return { data: result.rows[0] };
  });

  app.delete('/admin/courses/:courseId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ courseId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const course = devCourses.get(params.data.courseId);
      if (!course) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      if (course.status !== 'draft') return reply.code(409).send({ code: 'PUBLISHED_CONTENT_CANNOT_BE_DELETED' });
      const moduleIds = [...devModules.values()].filter((module) => module.courseId === course.id).map((module) => module.id);
      const lessonIds = [...devLessons.values()].filter((lesson) => moduleIds.includes(lesson.moduleId)).map((lesson) => lesson.id);
      const quizIds = [...devQuizzes.values()].filter((quiz) => lessonIds.includes(quiz.lessonId)).map((quiz) => quiz.id);
      for (const [id, question] of devQuestions) if (quizIds.includes(question.quizId)) devQuestions.delete(id);
      for (const id of quizIds) devQuizzes.delete(id);
      for (const id of lessonIds) devLessons.delete(id);
      for (const id of moduleIds) devModules.delete(id);
      devCourses.delete(course.id);
      return reply.code(204).send();
    }
    const result = await db.query(`DELETE FROM courses WHERE id=$1 AND status='draft' RETURNING id`, [params.data.courseId]);
    if (!result.rows[0]) {
      const exists = await db.query('SELECT status FROM courses WHERE id=$1', [params.data.courseId]);
      return exists.rows[0]
        ? reply.code(409).send({ code: 'PUBLISHED_CONTENT_CANNOT_BE_DELETED' })
        : reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
    }
    return reply.code(204).send();
  });

  app.post('/admin/courses/:courseId/modules', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ courseId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200),
      description: z.string().max(2000).default(''),
      position: z.number().int().positive(),
    }).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      if (!devCourses.has(params.data.courseId)) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      if ([...devModules.values()].some((module) => module.courseId === params.data.courseId && module.position === input.data.position)) {
        return reply.code(409).send({ code: 'POSITION_EXISTS' });
      }
      const module = { id: randomUUID(), courseId: params.data.courseId, ...input.data };
      devModules.set(module.id, module);
      return reply.code(201).send({ data: module });
    }
    const result = await db.query(
      `INSERT INTO modules(course_id,title,description,position) VALUES($1,$2,$3,$4) RETURNING *`,
      [params.data.courseId, input.data.title, input.data.description, input.data.position],
    );
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.post('/admin/modules/:moduleId/lessons', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ moduleId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200),
      summary: z.string().max(3000).default(''),
      transcript: z.string().max(100_000).default(''),
      durationSeconds: z.number().int().nonnegative(),
      position: z.number().int().positive(),
      points: z.number().int().min(0).max(10_000).default(100),
    }).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      if (!devModules.has(params.data.moduleId)) return reply.code(404).send({ code: 'MODULE_NOT_FOUND' });
      if ([...devLessons.values()].some((lesson) => lesson.moduleId === params.data.moduleId && lesson.position === input.data.position)) {
        return reply.code(409).send({ code: 'POSITION_EXISTS' });
      }
      const lesson = { id: randomUUID(), moduleId: params.data.moduleId, ...input.data, status: 'draft' };
      devLessons.set(lesson.id, lesson);
      return reply.code(201).send({ data: lesson });
    }
    const result = await db.query(
      `INSERT INTO lessons(module_id,title,summary,transcript,duration_seconds,position,points)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [params.data.moduleId, input.data.title, input.data.summary, input.data.transcript,
        input.data.durationSeconds, input.data.position, input.data.points],
    );
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.patch('/admin/modules/:moduleId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ moduleId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200).optional(),
      description: z.string().max(2000).optional(),
      position: z.number().int().positive().optional(),
    }).refine((value) => Object.keys(value).length > 0).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const module = devModules.get(params.data.moduleId);
      if (!module) return reply.code(404).send({ code: 'MODULE_NOT_FOUND' });
      Object.assign(module, input.data);
      return { data: module };
    }
    const result = await db.query(
      `UPDATE modules SET title=coalesce($1,title),description=coalesce($2,description),
       position=coalesce($3,position) WHERE id=$4 RETURNING *`,
      [input.data.title, input.data.description, input.data.position, params.data.moduleId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'MODULE_NOT_FOUND' });
    return { data: result.rows[0] };
  });

  app.delete('/admin/modules/:moduleId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ moduleId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const module = devModules.get(params.data.moduleId);
      if (!module) return reply.code(404).send({ code: 'MODULE_NOT_FOUND' });
      const course = devCourses.get(module.courseId);
      if (course?.status !== 'draft') return reply.code(409).send({ code: 'PUBLISHED_CONTENT_CANNOT_BE_DELETED' });
      const lessonIds = [...devLessons.values()].filter((lesson) => lesson.moduleId === module.id).map((lesson) => lesson.id);
      for (const id of lessonIds) devLessons.delete(id);
      devModules.delete(module.id);
      return reply.code(204).send();
    }
    const result = await db.query(
      `DELETE FROM modules m USING courses c WHERE m.id=$1 AND c.id=m.course_id AND c.status='draft' RETURNING m.id`,
      [params.data.moduleId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'MODULE_NOT_FOUND_OR_LOCKED' });
    return reply.code(204).send();
  });

  app.post('/admin/lessons/:lessonId/publish', { preHandler: requirePermission('lesson.publish') }, async (request, reply) => {
    const params = z.object({ lessonId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const lesson = devLessons.get(params.data.lessonId);
      if (!lesson) return reply.code(404).send({ code: 'LESSON_NOT_FOUND' });
      lesson.status = 'published';
      await writeAuditLog(request, 'lesson.publish', 'lesson', lesson.id);
      return { data: { id: lesson.id, status: lesson.status } };
    }
    const result = await db.query(
      `UPDATE lessons SET status='published' WHERE id=$1 AND title<>'' AND duration_seconds>=0 RETURNING id,status`,
      [params.data.lessonId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'LESSON_NOT_FOUND' });
    await writeAuditLog(request, 'lesson.publish', 'lesson', params.data.lessonId);
    return { data: result.rows[0] };
  });

  app.patch('/admin/lessons/:lessonId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ lessonId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200).optional(),
      summary: z.string().max(3000).optional(),
      transcript: z.string().max(100_000).optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
      position: z.number().int().positive().optional(),
      points: z.number().int().min(0).max(10_000).optional(),
    }).refine((value) => Object.keys(value).length > 0).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const lesson = devLessons.get(params.data.lessonId);
      if (!lesson) return reply.code(404).send({ code: 'LESSON_NOT_FOUND' });
      Object.assign(lesson, input.data);
      return { data: lesson };
    }
    const result = await db.query(
      `UPDATE lessons SET title=coalesce($1,title),summary=coalesce($2,summary),
       transcript=coalesce($3,transcript),duration_seconds=coalesce($4,duration_seconds),
       position=coalesce($5,position),points=coalesce($6,points)
       WHERE id=$7 RETURNING *`,
      [input.data.title, input.data.summary, input.data.transcript, input.data.durationSeconds,
        input.data.position, input.data.points, params.data.lessonId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'LESSON_NOT_FOUND' });
    return { data: result.rows[0] };
  });

  app.delete('/admin/lessons/:lessonId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ lessonId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const lesson = devLessons.get(params.data.lessonId);
      if (!lesson) return reply.code(404).send({ code: 'LESSON_NOT_FOUND' });
      if (lesson.status !== 'draft') return reply.code(409).send({ code: 'PUBLISHED_CONTENT_CANNOT_BE_DELETED' });
      const quizIds = [...devQuizzes.values()].filter((quiz) => quiz.lessonId === lesson.id).map((quiz) => quiz.id);
      for (const [id, question] of devQuestions) if (quizIds.includes(question.quizId)) devQuestions.delete(id);
      for (const id of quizIds) devQuizzes.delete(id);
      devLessons.delete(lesson.id);
      return reply.code(204).send();
    }
    const result = await db.query(`DELETE FROM lessons WHERE id=$1 AND status='draft' RETURNING id`, [params.data.lessonId]);
    if (!result.rows[0]) return reply.code(404).send({ code: 'LESSON_NOT_FOUND_OR_LOCKED' });
    return reply.code(204).send();
  });

  app.post('/admin/lessons/:lessonId/quizzes', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ lessonId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200),
      passingScore: z.number().int().min(0).max(100).default(70),
    }).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      if (!devLessons.has(params.data.lessonId)) return reply.code(404).send({ code: 'LESSON_NOT_FOUND' });
      const quiz = { id: randomUUID(), lessonId: params.data.lessonId, ...input.data };
      devQuizzes.set(quiz.id, quiz);
      return reply.code(201).send({ data: quiz });
    }
    const result = await db.query(
      `INSERT INTO quizzes(lesson_id,title,passing_score) VALUES($1,$2,$3) RETURNING *`,
      [params.data.lessonId, input.data.title, input.data.passingScore],
    );
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.post('/admin/quizzes/:quizId/questions', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ quizId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      prompt: z.string().min(3).max(2000),
      choices: z.array(z.string().min(1).max(500)).min(2).max(6),
      correctChoice: z.number().int().nonnegative(),
      explanation: z.string().min(3).max(3000),
      position: z.number().int().positive(),
    }).refine((value) => value.correctChoice < value.choices.length, 'Correct choice is out of range').safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      if (!devQuizzes.has(params.data.quizId)) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
      const question = { id: randomUUID(), quizId: params.data.quizId, ...input.data };
      devQuestions.set(question.id, question);
      return reply.code(201).send({ data: {
        id: question.id, quizId: question.quizId, prompt: question.prompt, choices: question.choices,
        explanation: question.explanation, position: question.position,
      } });
    }
    const result = await db.query(
      `INSERT INTO quiz_questions(quiz_id,prompt,choices,correct_choice,explanation,position)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,prompt,choices,explanation,position`,
      [params.data.quizId, input.data.prompt, JSON.stringify(input.data.choices), input.data.correctChoice,
        input.data.explanation, input.data.position],
    );
    return reply.code(201).send({ data: result.rows[0] });
  });

  app.patch('/admin/quizzes/:quizId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ quizId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      title: z.string().min(3).max(200).optional(),
      passingScore: z.number().int().min(0).max(100).optional(),
    }).refine((value) => Object.keys(value).length > 0).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const quiz = devQuizzes.get(params.data.quizId);
      if (!quiz) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
      Object.assign(quiz, input.data);
      return { data: quiz };
    }
    const result = await db.query(
      `UPDATE quizzes SET title=coalesce($1,title),passing_score=coalesce($2,passing_score)
       WHERE id=$3 RETURNING *`, [input.data.title, input.data.passingScore, params.data.quizId],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
    return { data: result.rows[0] };
  });

  app.delete('/admin/quizzes/:quizId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ quizId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      if (!devQuizzes.delete(params.data.quizId)) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
      for (const [id, question] of devQuestions) if (question.quizId === params.data.quizId) devQuestions.delete(id);
      return reply.code(204).send();
    }
    const result = await db.query('DELETE FROM quizzes WHERE id=$1 RETURNING id', [params.data.quizId]);
    if (!result.rows[0]) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
    return reply.code(204).send();
  });

  app.patch('/admin/questions/:questionId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ questionId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      prompt: z.string().min(3).max(2000).optional(),
      choices: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
      correctChoice: z.number().int().nonnegative().optional(),
      explanation: z.string().min(3).max(3000).optional(),
      position: z.number().int().positive().optional(),
    }).refine((value) => Object.keys(value).length > 0)
      .refine((value) => value.correctChoice === undefined || value.choices === undefined || value.correctChoice < value.choices.length)
      .safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const question = devQuestions.get(params.data.questionId);
      if (!question) return reply.code(404).send({ code: 'QUESTION_NOT_FOUND' });
      const finalChoices = input.data.choices ?? question.choices;
      const finalCorrectChoice = input.data.correctChoice ?? question.correctChoice;
      if (finalCorrectChoice >= finalChoices.length) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
      Object.assign(question, input.data);
      return { data: {
        id: question.id, quizId: question.quizId, prompt: question.prompt, choices: question.choices,
        explanation: question.explanation, position: question.position,
      } };
    }
    const current = await db.query<{ choices: string[]; correct_choice: number }>(
      'SELECT choices,correct_choice FROM quiz_questions WHERE id=$1', [params.data.questionId],
    );
    if (!current.rows[0]) return reply.code(404).send({ code: 'QUESTION_NOT_FOUND' });
    const choices = input.data.choices ?? current.rows[0].choices;
    const correctChoice = input.data.correctChoice ?? current.rows[0].correct_choice;
    if (correctChoice >= choices.length) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const result = await db.query(
      `UPDATE quiz_questions SET prompt=coalesce($1,prompt),choices=$2,correct_choice=$3,
       explanation=coalesce($4,explanation),position=coalesce($5,position)
       WHERE id=$6 RETURNING id,prompt,choices,explanation,position`,
      [input.data.prompt, JSON.stringify(choices), correctChoice, input.data.explanation,
        input.data.position, params.data.questionId],
    );
    return { data: result.rows[0] };
  });

  app.delete('/admin/questions/:questionId', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ questionId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      if (!devQuestions.delete(params.data.questionId)) return reply.code(404).send({ code: 'QUESTION_NOT_FOUND' });
      return reply.code(204).send();
    }
    const result = await db.query('DELETE FROM quiz_questions WHERE id=$1 RETURNING id', [params.data.questionId]);
    if (!result.rows[0]) return reply.code(404).send({ code: 'QUESTION_NOT_FOUND' });
    return reply.code(204).send();
  });

  app.get('/admin/courses/:courseId/preview', { preHandler: requirePermission('course.update') }, async (request, reply) => {
    const params = z.object({ courseId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) {
      const course = devCourses.get(params.data.courseId);
      if (!course) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      const modules = [...devModules.values()].filter((module) => module.courseId === course.id);
      const content: Array<{
        module_id: string; module_title: string; module_position: number;
        lesson_id: string | null; lesson_title: string | null;
        lesson_status: string | null; lesson_position: number | null;
      }> = [];
      for (const module of modules) {
        const lessons = [...devLessons.values()].filter((lesson) => lesson.moduleId === module.id);
        if (!lessons.length) content.push({
          module_id: module.id, module_title: module.title, module_position: module.position,
          lesson_id: null, lesson_title: null, lesson_status: null, lesson_position: null,
        });
        else for (const lesson of lessons) content.push({
          module_id: module.id, module_title: module.title, module_position: module.position,
          lesson_id: lesson.id, lesson_title: lesson.title, lesson_status: lesson.status, lesson_position: lesson.position,
        });
      }
      return { data: { ...course, content, preview: true } };
    }
    const course = await db.query('SELECT id,slug,title,description,status FROM courses WHERE id=$1', [params.data.courseId]);
    if (!course.rows[0]) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
    const content = await db.query(
      `SELECT m.id module_id,m.title module_title,m.position module_position,
       l.id lesson_id,l.title lesson_title,l.status lesson_status,l.position lesson_position
       FROM modules m LEFT JOIN lessons l ON l.module_id=m.id
       WHERE m.course_id=$1 ORDER BY m.position,l.position`, [params.data.courseId],
    );
    return { data: { ...course.rows[0], content: content.rows, preview: true } };
  });

  app.get('/notifications', { preHandler: requireUser }, async (request) => {
    if (memoryMode()) return { data: [] };
    const result = await db.query(
      `SELECT id,type,title,body,read_at,created_at FROM notifications
       WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.put('/notifications/:id/read', { preHandler: requireUser }, async (request, reply) => {
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (memoryMode()) return reply.code(204).send();
    await db.query('UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2',
      [params.data.id, request.user!.id]);
    return reply.code(204).send();
  });

  app.get('/notification-preferences', { preHandler: requireUser }, async (request) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      return { data: [...devNotificationPreferences.entries()]
        .filter(([key]) => key.startsWith(`${request.user!.id}:`)).map(([, value]) => value) };
    }
    const result = await db.query(
      `SELECT channel,notification_type "notificationType",enabled
       FROM notification_preferences WHERE user_id=$1 ORDER BY channel,notification_type`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.put('/notification-preferences', { preHandler: requireUser }, async (request, reply) => {
    const input = z.object({
      channel: z.enum(['email', 'sms', 'whatsapp', 'in_app']),
      notificationType: z.string().min(2).max(100),
      enabled: z.boolean(),
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (['payment_receipt', 'security_alert'].includes(input.data.notificationType) && !input.data.enabled) {
      return reply.code(409).send({ code: 'REQUIRED_NOTIFICATION' });
    }
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      devNotificationPreferences.set(`${request.user!.id}:${input.data.channel}:${input.data.notificationType}`, input.data);
      return { data: input.data };
    }
    await db.query(
      `INSERT INTO notification_preferences(user_id,channel,notification_type,enabled)
       VALUES($1,$2,$3,$4) ON CONFLICT(user_id,channel,notification_type)
       DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now()`,
      [request.user!.id, input.data.channel, input.data.notificationType, input.data.enabled],
    );
    return { data: input.data };
  });
}
