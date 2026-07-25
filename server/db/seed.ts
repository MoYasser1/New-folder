import { hashPassword } from '../auth/password.js';
import { db } from './pool.js';

const passwordHash = await hashPassword('Demo@2026!');
const client = await db.connect();
try {
  await client.query('BEGIN');
  const instructor = await client.query<{ id: string }>(
    `INSERT INTO users(email,password_hash,full_name,role,email_verified_at)
     VALUES('instructor@yasser-ai.demo',$1,'م. محمد ياسر','instructor',now())
     ON CONFLICT ((lower(email))) WHERE deleted_at IS NULL DO UPDATE SET full_name=EXCLUDED.full_name
     RETURNING id`, [passwordHash],
  );
  const users = [
    ['student@yasser-ai.demo', 'محمد أحمد', 'student'],
    ['parent@yasser-ai.demo', 'ولي أمر محمد', 'parent'],
    ['admin@yasser-ai.demo', 'مدير المنصة', 'super_admin'],
  ] as const;
  const ids = new Map<string, string>();
  for (const [email, name, role] of users) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO users(email,password_hash,full_name,role,email_verified_at)
       VALUES($1,$2,$3,$4,now())
       ON CONFLICT ((lower(email))) WHERE deleted_at IS NULL DO UPDATE SET full_name=EXCLUDED.full_name
       RETURNING id`, [email, passwordHash, name, role],
    );
    ids.set(role, result.rows[0]!.id);
  }
  const course = await client.query<{ id: string }>(
    `INSERT INTO courses(slug,title,description,instructor_id,status,price_minor,currency,published_at)
     VALUES('ai-programming-launch','انطلاقة البرمجة والذكاء الاصطناعي للثانوية',
     'مسار عربي عملي من التفكير الحاسوبي إلى أول مشروع ذكاء اصطناعي.',$1,'published',79900,'EGP',now())
     ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title RETURNING id`, [instructor.rows[0]!.id],
  );
  await client.query(
    `INSERT INTO achievements(code,title,description,points) VALUES
     ('FIRST_MISSION','أول مهمة','أكمل أول مهمة تعليمية',120),
     ('WEEK_STREAK','سلسلة أسبوع','تعلّم سبعة أيام متتالية',250),
     ('FIRST_PROJECT','أول مشروع','سلّم أول مشروع برمجي',500)
     ON CONFLICT(code) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,points=EXCLUDED.points`,
  );
  const moduleTitles = [
    'كيف يفكر الكمبيوتر؟', 'الخوارزميات والتفكير المنطقي', 'البداية مع Python',
    'المتغيرات والشروط والحلقات', 'الدوال وتقسيم المشكلة', 'مقدمة في البيانات',
    'ما هو الذكاء الاصطناعي؟', 'مشروع: مساعد دراسي ذكي',
  ];
  for (const [index, title] of moduleTitles.entries()) {
    const moduleResult = await client.query<{ id: string }>(
      `INSERT INTO modules(course_id,title,description,position) VALUES($1,$2,$3,$4)
       ON CONFLICT(course_id,position) DO UPDATE SET title=EXCLUDED.title RETURNING id`,
      [course.rows[0]!.id, title, `المخرجات التعليمية للوحدة ${index + 1}`, index + 1],
    );
    const lesson = await client.query<{ id: string }>(
      `INSERT INTO lessons(module_id,title,summary,transcript,duration_seconds,position,status,points)
       VALUES($1,$2,$3,$4,$5,1,'published',120)
       ON CONFLICT(module_id,position) DO UPDATE SET title=EXCLUDED.title RETURNING id`,
      [moduleResult.rows[0]!.id, title, `درس عملي: ${title}`, 'نص تجريبي قصير قابل للتحرير من نظام إدارة المحتوى.', 720 + index * 60],
    );
    if (index === 0) {
      const quiz = await client.query<{ id: string }>(
        `INSERT INTO quizzes(lesson_id,title,passing_score)
         SELECT $1,'اختبار فهم الخوارزميات',70
         WHERE NOT EXISTS(SELECT 1 FROM quizzes WHERE lesson_id=$1) RETURNING id`, [lesson.rows[0]!.id],
      );
      if (quiz.rows[0]) await client.query(
        `INSERT INTO quiz_questions(quiz_id,prompt,choices,correct_choice,explanation,position)
         VALUES($1,'ما أفضل وصف للخوارزمية؟',$2,1,'الخوارزمية خطوات واضحة ومرتبة لحل مشكلة.',1)`,
        [quiz.rows[0].id, JSON.stringify(['لغة برمجة', 'خطوات مرتبة', 'جهاز', 'ملف بيانات'])],
      );
    }
  }
  await client.query(
    `INSERT INTO enrollments(user_id,course_id) VALUES($1,$2)
     ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`,
    [ids.get('student'), course.rows[0]!.id],
  );
  await client.query(
    `INSERT INTO parent_students(parent_id,student_id,verified_at) VALUES($1,$2,now())
     ON CONFLICT DO NOTHING`, [ids.get('parent'), ids.get('student')],
  );
  await client.query('COMMIT');
  process.stdout.write('Demo data seeded. Password for all demo accounts: Demo@2026!\n');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.end();
}
