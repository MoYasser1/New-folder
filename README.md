# Yasser AI Academy

منصة تعليم عربية RTL مبنية بـ React 19 وTypeScript وFastify وPostgreSQL. تشمل رحلة الطالب، المصادقة والجلسات، الدفع، المحتوى والاختبارات والمشروعات، بوابتي ولي الأمر والمدرّس، رفع الملفات، مساعدًا سقراطيًا، وتشغيل تمارين Python.

## التشغيل المحلي

```bash
npm install
npm run dev:all
```

الواجهة: `http://localhost:3000` — API: `http://localhost:3001` — فحص الجاهزية: `http://localhost:3001/health/ready`.

الوضع الافتراضي للتطوير يستخدم مخزنًا داخل الذاكرة ومزوّدات محلية آمنة للتجربة. لتشغيل PostgreSQL انسخ `.env.example` إلى `.env`، اضبط `DEV_MEMORY_MODE=false` و`DATABASE_URL`، ثم نفّذ:

```bash
npm run db:migrate
npm run db:seed
```

## الحسابات التجريبية

كلمة المرور لكل الحسابات: `Demo@2026!`

- `student@yasser-ai.demo`
- `parent@yasser-ai.demo`
- `instructor@yasser-ai.demo`
- `admin@yasser-ai.demo`

بيانات العرض للتطوير فقط، ولا تُستخدم في الإنتاج. التسجيل الحقيقي يفرض كلمة مرور قوية من 12 حرفًا على الأقل.

## بوابات الجودة

```bash
npm run check
npm run test:e2e
npm audit --audit-level=high
```

`check` يشغّل lint و44 اختبار Unit/Integration/Security ثم يبني الواجهة والـAPI. اختبارات Playwright تغطي سطح المكتب والموبايل وإتاحة WCAG.

## الإنتاج

لا يكفي تغيير `NODE_ENV` وحده. يحتاج النشر PostgreSQL وخدمات بريد وتخزين ودفع وتشغيل كود وOpenAI فعلية، مع TLS ونسخ احتياطي ومراقبة. إعداد الإنتاج يفشل مبكرًا إذا غابت الأسرار أو بقي مزوّد محلي. راجع:

- `docs/deployment.md`
- `docs/production-readiness.md`
- `docs/requirements-matrix.md`
- `docs/openapi.yaml`

## البنية

- `src/`: واجهة React وربط API وحالات loading/empty/error.
- `server/`: Fastify، Auth/RBAC، الخدمات، المزوّدات، ومسارات API.
- `server/db/migrations/`: مخطط PostgreSQL ومهاجرات محمية بـchecksum وقفل advisory.
- `e2e/`: رحلات متصفح وظيفية وإتاحة واستجابة.
- `docs/`: العقود، التشغيل، الأمن، ومصفوفة الجاهزية.

## English quick start

Install with `npm install`, then run the web app and API together using `npm run dev:all`. Open `http://localhost:3000`; API readiness is available at `http://localhost:3001/health/ready`. Use `npm run check`, `npm run test:e2e`, and `npm audit --audit-level=high` before release. Production additionally requires PostgreSQL and configured payment, email, private storage, AI, and isolated code-runner providers; local adapters are rejected by production configuration.
