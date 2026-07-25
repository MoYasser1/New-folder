import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, requireUser } from '../auth/authorization.js';
import { db } from '../db/pool.js';
import { config } from '../config.js';
import {
  DEV_COURSE_ID, DEV_LESSON_ID, DEV_MODULE_ID, DEV_QUIZ_ID,
  devLessonProgress, devOrders, devQuizAttempts,
} from '../db/dev-store.js';

const hasDevEnrollment = (userId: string) =>
  [...devOrders.values()].some((order) => order.userId === userId && order.courseId === DEV_COURSE_ID && order.status === 'succeeded');

export async function learningRoutes(app: FastifyInstance) {
  app.get('/courses', async () => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) return { data: [{
      id: DEV_COURSE_ID, slug: 'ai-programming-launch', title: 'انطلاقة البرمجة والذكاء الاصطناعي للثانوية',
      description: 'مسار عربي عملي من التفكير الحاسوبي إلى أول مشروع.', price_minor: 79900,
      currency: 'EGP', module_count: 8, lesson_count: 8,
    }] };
    const result = await db.query(
      `SELECT c.id, c.slug, c.title, c.description, c.price_minor, c.currency,
       count(DISTINCT m.id)::int AS module_count, count(DISTINCT l.id)::int AS lesson_count
       FROM courses c LEFT JOIN modules m ON m.course_id = c.id
       LEFT JOIN lessons l ON l.module_id = m.id
       WHERE c.status = 'published' GROUP BY c.id ORDER BY c.published_at DESC`,
    );
    return { data: result.rows };
  });

  app.get('/courses/:slug', async (request, reply) => {
    const params = z.object({ slug: z.string().min(1).max(100) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const { slug } = params.data;
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      if (slug !== 'ai-programming-launch') return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      return { data: {
        id: DEV_COURSE_ID, slug, title: 'انطلاقة البرمجة والذكاء الاصطناعي للثانوية',
        description: 'مسار عربي عملي من التفكير الحاسوبي إلى أول مشروع.', status: 'published',
        price_minor: 79_900, currency: 'EGP',
        modules: [{
          id: DEV_MODULE_ID, title: 'كيف يفكر الكمبيوتر؟', description: 'مدخل عملي للتفكير الحاسوبي', position: 1,
          lessons: [{ id: DEV_LESSON_ID, title: 'الخوارزميات في حياتنا', durationSeconds: 720, position: 1 }],
        }],
      } };
    }
    const course = await db.query('SELECT * FROM courses WHERE slug = $1 AND status = $2', [slug, 'published']);
    if (!course.rows[0]) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
    const modules = await db.query(
      `SELECT m.id, m.title, m.description, m.position,
       coalesce(json_agg(json_build_object('id',l.id,'title',l.title,'durationSeconds',l.duration_seconds,'position',l.position)
       ORDER BY l.position) FILTER (WHERE l.id IS NOT NULL), '[]') AS lessons
       FROM modules m LEFT JOIN lessons l ON l.module_id=m.id AND l.status='published'
       WHERE m.course_id=$1 GROUP BY m.id ORDER BY m.position`, [course.rows[0].id],
    );
    return { data: { ...course.rows[0], modules: modules.rows } };
  });

  app.get('/dashboard', { preHandler: requireUser }, async (request) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const isDemoStudent = request.user!.email === 'student@yasser-ai.demo';
      if (!isDemoStudent && !hasDevEnrollment(request.user!.id)) return { data: [] };
      const progress = devLessonProgress.get(`${request.user!.id}:${DEV_LESSON_ID}`);
      return { data: [{
        id: DEV_COURSE_ID, title: 'انطلاقة البرمجة والذكاء الاصطناعي للثانوية',
        total_lessons: 8, completed_lessons: progress?.completed ? 1 : 0,
      }] };
    }
    const result = await db.query(
      `SELECT c.id, c.title,
       count(DISTINCT l.id)::int AS total_lessons,
       count(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed_at IS NOT NULL)::int AS completed_lessons
       FROM enrollments e JOIN courses c ON c.id=e.course_id
       JOIN modules m ON m.course_id=c.id JOIN lessons l ON l.module_id=m.id
       LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=e.user_id
       WHERE e.user_id=$1 AND e.status='active' GROUP BY c.id`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.put('/lessons/:lessonId/progress', { preHandler: requirePermission('progress.write') }, async (request, reply) => {
    const params = z.object({ lessonId: z.uuid() }).safeParse(request.params);
    const body = z.object({
      watchedSeconds: z.number().int().nonnegative(),
      lastPositionSeconds: z.number().int().nonnegative(),
    }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const isDemoStudent = request.user!.email === 'student@yasser-ai.demo';
      if (params.data.lessonId !== DEV_LESSON_ID || (!isDemoStudent && !hasDevEnrollment(request.user!.id))) {
        return reply.code(404).send({ code: 'LESSON_NOT_ACCESSIBLE' });
      }
      const watchedSeconds = Math.min(body.data.watchedSeconds, 720);
      const completed = watchedSeconds / 720 >= 0.9;
      const key = `${request.user!.id}:${DEV_LESSON_ID}`;
      const previous = devLessonProgress.get(key);
      devLessonProgress.set(key, {
        userId: request.user!.id, lessonId: DEV_LESSON_ID,
        watchedSeconds: Math.max(previous?.watchedSeconds ?? 0, watchedSeconds),
        lastPositionSeconds: Math.min(body.data.lastPositionSeconds, 720),
        completed: previous?.completed || completed,
      });
      return { completed: previous?.completed || completed, watchedSeconds };
    }
    const lesson = await db.query<{ duration_seconds: number; completion_percent: number }>(
      `SELECT l.duration_seconds, l.completion_percent FROM lessons l
       JOIN modules m ON m.id=l.module_id JOIN enrollments e ON e.course_id=m.course_id
       WHERE l.id=$1 AND e.user_id=$2 AND e.status='active'`, [params.data.lessonId, request.user!.id],
    );
    const found = lesson.rows[0];
    if (!found) return reply.code(404).send({ code: 'LESSON_NOT_ACCESSIBLE' });
    const cappedWatched = Math.min(body.data.watchedSeconds, found.duration_seconds);
    const completed = found.duration_seconds === 0 || cappedWatched / found.duration_seconds * 100 >= found.completion_percent;
    await db.query(
      `INSERT INTO lesson_progress (user_id,lesson_id,watched_seconds,last_position_seconds,completed_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id,lesson_id) DO UPDATE SET
       watched_seconds=GREATEST(lesson_progress.watched_seconds,EXCLUDED.watched_seconds),
       last_position_seconds=EXCLUDED.last_position_seconds,
       completed_at=coalesce(lesson_progress.completed_at,EXCLUDED.completed_at),updated_at=now()`,
      [request.user!.id, params.data.lessonId, cappedWatched, body.data.lastPositionSeconds, completed ? new Date() : null],
    );
    return { completed, watchedSeconds: cappedWatched };
  });

  app.post('/quizzes/:quizId/submit', { preHandler: requirePermission('quiz.submit') }, async (request, reply) => {
    const params = z.object({ quizId: z.uuid() }).safeParse(request.params);
    const body = z.object({ answers: z.array(z.number().int().nonnegative()).max(100) }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      if (params.data.quizId !== DEV_QUIZ_ID) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
      const correct = body.data.answers[0] === 1;
      const score = correct ? 100 : 0;
      const passed = score >= 70;
      devQuizAttempts.push({ userId: request.user!.id, quizId: DEV_QUIZ_ID, answers: body.data.answers, score, passed });
      return { score, passed, feedback: [{ correct, explanation: 'الخوارزمية خطوات واضحة ومرتبة لحل مشكلة.' }] };
    }
    const quiz = await db.query<{ passing_score: number }>('SELECT passing_score FROM quizzes WHERE id=$1', [params.data.quizId]);
    if (!quiz.rows[0]) return reply.code(404).send({ code: 'QUIZ_NOT_FOUND' });
    const questions = await db.query<{ correct_choice: number; explanation: string }>(
      'SELECT correct_choice, explanation FROM quiz_questions WHERE quiz_id=$1 ORDER BY position', [params.data.quizId],
    );
    const correct = questions.rows.filter((q, index) => body.data.answers[index] === q.correct_choice).length;
    const score = questions.rowCount ? Math.round(correct / questions.rowCount * 100) : 0;
    const passed = score >= quiz.rows[0].passing_score;
    await db.query('INSERT INTO quiz_attempts(user_id,quiz_id,answers,score,passed) VALUES($1,$2,$3,$4,$5)',
      [request.user!.id, params.data.quizId, JSON.stringify(body.data.answers), score, passed]);
    return { score, passed, feedback: questions.rows.map((q, index) => ({
      correct: body.data.answers[index] === q.correct_choice,
      explanation: q.explanation,
    })) };
  });
}
