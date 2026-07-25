import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { generateTutorReply, type TutorContext } from '../services/ai-tutor.js';
import { createHash } from 'node:crypto';
import { DEV_LESSON_ID, devLessonProgress } from '../db/dev-store.js';

const directAnswerPatterns = [/حل الاختبار/i, /الإجابة الصحيحة/i, /give me the answer/i, /امتحان/i];

function socraticReply(message: string, context: TutorContext) {
  const greeting = context.name ? `يا ${context.name}، ` : '';
  const progress = context.totalLessons
    ? `أنت أنجزت ${context.completedLessons ?? 0} من ${context.totalLessons} دروس في مسارك. `
    : '';
  if (directAnswerPatterns.some((pattern) => pattern.test(message))) {
    return `${greeting}لن أعطيك إجابة تقييم جاهزة، لكن سأوصلك للحل: حدّد المعطيات أولًا، ثم اكتب أصغر خطوة يمكنك اختبارها وسأراجعها معك.`;
  }
  if (/خوارزمي|algorithm/i.test(message)) {
    return `${greeting}الخوارزمية ببساطة هي خطوات مرتبة لحل مشكلة، مثل وصفة دقيقة. اختر مهمة يومية، اكتب مدخلاتها ثم خطواتها ثم النتيجة؛ وبعدها نحولها معًا إلى كود.`;
  }
  if (/بايثون|python|متغير|variable/i.test(message)) {
    return `${greeting}في Python المتغير اسم نربطه بقيمة، مثل: age = 16. يمكنك بعدها استخدام age في الحساب أو الطباعة. اكتب مثالًا من حياتك لمتغيرين وسأحوّله معك إلى برنامج صغير.`;
  }
  if (/تقدمي|مستواي|مساري|أنجزت|progress/i.test(message)) {
    return progress
      ? `${greeting}${progress}خطوتك الأفضل الآن هي إكمال الدرس الحالي ثم تطبيق فكرته في تمرين صغير.`
      : `${greeting}لا يظهر لدي مسار نشط بعد. ابدأ اختبار المستوى أو اشترك في مسار، وسأتابع تقدّمك خطوة بخطوة.`;
  }
  if (/مرحبا|أهلا|السلام|hello|hi\b/i.test(message)) {
    return `${greeting}أهلًا بك! أستطيع شرح البرمجة والذكاء الاصطناعي، مساعدتك في التمارين، ومتابعة مسارك${context.courseTitle ? ` في «${context.courseTitle}»` : ''}. ماذا تريد أن تتعلم اليوم؟`;
  }
  return `${greeting}${progress}دعنا نجعل سؤالك عمليًا: اكتب الهدف الذي تريد الوصول إليه، وما الذي جرّبته، وأي خطأ ظهر لك؛ وسأشرح الفكرة وأعطيك الخطوة التالية بوضوح.`;
}

async function getTutorContext(request: FastifyRequest): Promise<TutorContext> {
  const user = request.user;
  if (!user) return {};
  if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
    const lessonProgress = devLessonProgress.get(`${user.id}:${DEV_LESSON_ID}`);
    return {
      name: user.fullName,
      role: user.role,
      courseTitle: user.role === 'student' ? 'انطلاقة البرمجة والذكاء الاصطناعي' : undefined,
      completedLessons: lessonProgress?.completed ? 1 : 0,
      totalLessons: user.role === 'student' ? 8 : undefined,
      currentLesson: user.role === 'student' ? 'التفكير الخوارزمي' : undefined,
    };
  }
  const result = await db.query<{
    title: string; total_lessons: number; completed_lessons: number; current_lesson: string | null;
  }>(
    `SELECT c.title, count(DISTINCT l.id)::int total_lessons,
     count(DISTINCT lp.lesson_id) FILTER (WHERE lp.completed_at IS NOT NULL)::int completed_lessons,
     max(l.title) FILTER (WHERE lp.completed_at IS NULL) current_lesson
     FROM enrollments e JOIN courses c ON c.id=e.course_id
     JOIN modules m ON m.course_id=c.id JOIN lessons l ON l.module_id=m.id
     LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=e.user_id
     WHERE e.user_id=$1 AND e.status='active' GROUP BY c.id ORDER BY c.title LIMIT 1`,
    [user.id],
  );
  const course = result.rows[0];
  return {
    name: user.fullName, role: user.role, courseTitle: course?.title,
    completedLessons: course?.completed_lessons, totalLessons: course?.total_lessons,
    currentLesson: course?.current_lesson ?? undefined,
  };
}

export async function tutorRoutes(app: FastifyInstance) {
  app.post('/tutor/message', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 hour',
        keyGenerator: (request) => {
          const session = request.cookies.yaa_session;
          return session ? createHash('sha256').update(session).digest('hex') : request.ip;
        },
      },
    },
  }, async (request, reply) => {
    const input = z.object({
      message: z.string().trim().min(2).max(1500),
      lessonId: z.uuid().optional(),
    }).safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const context = await getTutorContext(request);
    const flagged = directAnswerPatterns.some((pattern) => pattern.test(input.data.message));
    let response = socraticReply(input.data.message, context);
    let mode = 'socratic-local';
    if (config.AI_PROVIDER === 'openai' && !flagged) {
      try {
        response = await generateTutorReply(input.data.message, context);
        mode = 'openai';
      } catch (error) {
        if (error instanceof Error && ['AI_CONTENT_BLOCKED', 'AI_SENSITIVE_DATA'].includes(error.message)) {
          return reply.code(422).send({ code: error.message });
        }
        request.log.error({ error, requestId: request.id }, 'AI tutor provider failed');
        mode = 'socratic-fallback';
      }
    }
    if (request.user && !(config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE)) {
      await db.query(
        `INSERT INTO tutor_messages(user_id,lesson_id,role,content,flagged)
         VALUES($1,$2,'user',$3,$4),($1,$2,'assistant',$5,$4)`,
        [request.user!.id, input.data.lessonId, input.data.message, flagged, response],
      );
    }
    return { data: { message: response, mode, flagged } };
  });
}
