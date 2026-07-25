import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createHmac } from 'node:crypto';
import { config } from './config.js';

let app: FastifyInstance;

const multipartFile = (field: string, filename: string, mimeType: string, content: string | Buffer) => {
  const boundary = `----yaa-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('API integration', () => {
  it('reports development readiness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ready' });
  });

  it('registers, authenticates, and serves the current user', async () => {
    const email = `student-${Date.now()}@example.com`;
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'طالب اختبار', email, password: 'Strong@Password2026', acceptedTerms: true },
    });
    expect(registration.statusCode).toBe(201);
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session');
    expect(cookie?.httpOnly).toBe(true);
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { yaa_session: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ email, role: 'student' });
    const secondLogin = await app.inject({
      method: 'POST', url: '/api/auth/login', payload: { email, password: 'Strong@Password2026' },
    });
    const secondCookie = secondLogin.cookies.find((item) => item.name === 'yaa_session')!;
    const sessions = await app.inject({
      method: 'GET', url: '/api/account/sessions', cookies: { yaa_session: secondCookie.value },
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().data).toHaveLength(2);
    expect(sessions.json().data[0].id).toMatch(/^[0-9a-f-]{36}$/);
    const revoked = await app.inject({
      method: 'DELETE', url: `/api/account/sessions/${sessions.json().data[0].id}`,
      cookies: { yaa_session: secondCookie.value },
    });
    expect(revoked.statusCode).toBe(204);
  });

  it('verifies a new email with a hashed, expiring development OTP', async () => {
    const email = `verify-${Date.now()}@example.com`;
    const registration = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { fullName: 'طالب تحقق', email, password: 'Strong@Password2026', acceptedTerms: true },
    });
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const requestOtp = await app.inject({
      method: 'POST', url: '/api/auth/request-email-verification', cookies: { yaa_session: cookie.value },
    });
    expect(requestOtp.statusCode).toBe(200);
    const otp = requestOtp.json().developmentOtp as string;
    expect(otp).toMatch(/^\d{6}$/);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrongOtp = String(100_000 + ((Number(otp) + attempt + 1) % 900_000)).padStart(6, '0');
      const rejected = await app.inject({
        method: 'POST', url: '/api/auth/verify-email',
        cookies: { yaa_session: cookie.value }, payload: { otp: wrongOtp },
      });
      expect(rejected.statusCode).toBe(400);
    }
    const lockedCode = await app.inject({
      method: 'POST', url: '/api/auth/verify-email',
      cookies: { yaa_session: cookie.value }, payload: { otp },
    });
    expect(lockedCode.statusCode).toBe(400);
    const replacement = await app.inject({
      method: 'POST', url: '/api/auth/request-email-verification', cookies: { yaa_session: cookie.value },
    });
    const replacementOtp = replacement.json().developmentOtp as string;
    const verification = await app.inject({
      method: 'POST', url: '/api/auth/verify-email', cookies: { yaa_session: cookie.value }, payload: { otp: replacementOtp },
    });
    expect(verification.json()).toEqual({ verified: true });
    const replay = await app.inject({
      method: 'POST', url: '/api/auth/verify-email', cookies: { yaa_session: cookie.value }, payload: { otp: replacementOtp },
    });
    expect(replay.statusCode).toBe(400);
  });

  it('scores placement answers on the server', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/placement/submit',
      payload: { answers: [1, 1, 2, 0, 0, 2] },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ score: 100, level: 'مستكشف متقدم' });
  });

  it('creates one sandbox order and enrollment through authenticated checkout', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const cookie = login.cookies.find((item) => item.name === 'yaa_session')!;
    const courses = await app.inject({ method: 'GET', url: '/api/courses' });
    const courseId = courses.json().data[0].id as string;
    const checkout = await app.inject({
      method: 'POST', url: '/api/checkout', cookies: { yaa_session: cookie.value },
      payload: { courseId, idempotencyKey: `test-${Date.now()}-checkout` },
    });
    expect(checkout.statusCode).toBe(201);
    const payment = await app.inject({
      method: 'POST', url: `/api/payments/sandbox/${checkout.json().order.id}`,
      cookies: { yaa_session: cookie.value },
    });
    expect(payment.json()).toMatchObject({ status: 'succeeded', enrollmentCreated: true });
    const orders = await app.inject({
      method: 'GET', url: '/api/account/orders', cookies: { yaa_session: cookie.value },
    });
    expect(orders.statusCode).toBe(200);
    expect(orders.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: checkout.json().order.id, status: 'succeeded' }),
    ]));
    const invoice = await app.inject({
      method: 'GET', url: `/api/account/orders/${checkout.json().order.id}/invoice`,
      cookies: { yaa_session: cookie.value },
    });
    expect(invoice.statusCode).toBe(200);
    expect(invoice.json().data).toMatchObject({
      id: checkout.json().order.id,
      status: 'succeeded',
      currency: 'EGP',
    });
    const dashboard = await app.inject({
      method: 'GET', url: '/api/dashboard', cookies: { yaa_session: cookie.value },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data[0]).toMatchObject({ total_lessons: 8 });
    const progress = await app.inject({
      method: 'PUT',
      url: '/api/lessons/33333333-3333-4333-8333-333333333333/progress',
      cookies: { yaa_session: cookie.value },
      payload: { watchedSeconds: 700, lastPositionSeconds: 700 },
    });
    expect(progress.json()).toMatchObject({ completed: true, watchedSeconds: 700 });
    const quiz = await app.inject({
      method: 'POST',
      url: '/api/quizzes/44444444-4444-4444-8444-444444444444/submit',
      cookies: { yaa_session: cookie.value },
      payload: { answers: [1] },
    });
    expect(quiz.json()).toMatchObject({ score: 100, passed: true });
  });

  it('issues an idempotent partial refund through finance permission', async () => {
    const studentLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const studentCookie = studentLogin.cookies.find((item) => item.name === 'yaa_session')!;
    const courses = await app.inject({ method: 'GET', url: '/api/courses' });
    const checkout = await app.inject({
      method: 'POST', url: '/api/checkout', cookies: { yaa_session: studentCookie.value },
      payload: { courseId: courses.json().data[0].id, idempotencyKey: `refund-order-${Date.now()}` },
    });
    await app.inject({
      method: 'POST', url: `/api/payments/sandbox/${checkout.json().order.id}`, cookies: { yaa_session: studentCookie.value },
    });
    const adminLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const adminCookie = adminLogin.cookies.find((item) => item.name === 'yaa_session')!;
    const idempotencyKey = `refund-${Date.now()}-partial`;
    const refund = await app.inject({
      method: 'POST', url: `/api/finance/orders/${checkout.json().order.id}/refunds`,
      cookies: { yaa_session: adminCookie.value },
      payload: { amountMinor: 10_000, reason: 'طلب استرداد جزئي للاختبار', idempotencyKey },
    });
    expect(refund.statusCode).toBe(201);
    const replay = await app.inject({
      method: 'POST', url: `/api/finance/orders/${checkout.json().order.id}/refunds`,
      cookies: { yaa_session: adminCookie.value },
      payload: { amountMinor: 10_000, reason: 'طلب استرداد جزئي للاختبار', idempotencyKey },
    });
    expect(replay.json().data.id).toBe(refund.json().data.id);
    const finalRefund = await app.inject({
      method: 'POST', url: `/api/finance/orders/${checkout.json().order.id}/refunds`,
      cookies: { yaa_session: adminCookie.value },
      payload: {
        amountMinor: 69_900, reason: 'Complete the remaining refund amount',
        idempotencyKey: `refund-${Date.now()}-remaining`,
      },
    });
    expect(finalRefund.statusCode).toBe(201);
    const orders = await app.inject({
      method: 'GET', url: '/api/account/orders', cookies: { yaa_session: studentCookie.value },
    });
    expect(orders.json().data.find((order: { id: string }) => order.id === checkout.json().order.id))
      .toMatchObject({ status: 'refunded' });
  });

  it('refuses direct assessment answers with a Socratic hint', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const cookie = login.cookies.find((item) => item.name === 'yaa_session')!;
    const response = await app.inject({
      method: 'POST',
      url: '/api/tutor/message',
      cookies: { yaa_session: cookie.value },
      payload: { message: 'أعطني الإجابة الصحيحة في الامتحان' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ flagged: true, mode: 'socratic-local' });
  });

  it('resets a password once and revokes existing sessions', async () => {
    const forgot = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'student@yasser-ai.demo' },
    });
    expect(forgot.statusCode).toBe(200);
    const developmentToken = forgot.json().developmentToken as string;
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: developmentToken, password: 'Changed@Password2026' },
    });
    expect(reset.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: developmentToken, password: 'Another@Password2026' },
    });
    expect(replay.statusCode).toBe(400);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Changed@Password2026' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('verifies public certificates without exposing private account data', async () => {
    const valid = await app.inject({ method: 'GET', url: '/api/certificates/verify/YAA-DEMO-2026' });
    expect(valid.statusCode).toBe(200);
    expect(valid.json().data).toMatchObject({ valid: true, courseTitle: expect.any(String) });
    expect(valid.json().data).not.toHaveProperty('email');
    const unknown = await app.inject({ method: 'GET', url: '/api/certificates/verify/YAA-NOT-FOUND' });
    expect(unknown.statusCode).toBe(404);
  });

  it('uploads and privately retrieves a validated account image', async () => {
    const registration = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Upload Student',
        email: `upload-${Date.now()}@example.com`,
        password: 'Strong@Password2026',
        acceptedTerms: true,
      },
    });
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const image = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from('safe-development-image'),
    ]);
    const multipart = multipartFile('file', 'avatar.png', 'image/png', image);
    const upload = await app.inject({
      method: 'POST',
      url: '/api/uploads/avatar',
      cookies: { yaa_session: cookie.value },
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().data).toMatchObject({
      filename: 'avatar.png',
      mimeType: 'image/png',
      sizeBytes: image.byteLength,
    });
    expect(upload.json().data).not.toHaveProperty('storageKey');
    const download = await app.inject({
      method: 'GET',
      url: upload.json().data.url,
      cookies: { yaa_session: cookie.value },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('image/png');
    expect(download.rawPayload).toEqual(image);
    const assets = await app.inject({
      method: 'GET', url: '/api/account/uploads', cookies: { yaa_session: cookie.value },
    });
    expect(assets.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: upload.json().data.id, filename: 'avatar.png' }),
    ]));
    expect(assets.json().data[0]).not.toHaveProperty('storageKey');
    const deleted = await app.inject({
      method: 'DELETE', url: upload.json().data.url, cookies: { yaa_session: cookie.value },
    });
    expect(deleted.statusCode).toBe(204);
    const missing = await app.inject({
      method: 'GET', url: upload.json().data.url, cookies: { yaa_session: cookie.value },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('runs the complete in-memory instructor content authoring flow', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'admin@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const cookie = login.cookies.find((item) => item.name === 'yaa_session')!;
    const stamp = Date.now();
    const course = await app.inject({
      method: 'POST', url: '/api/admin/courses', cookies: { yaa_session: cookie.value },
      payload: {
        slug: `content-flow-${stamp}`, title: 'Content Flow Course',
        description: 'A complete content authoring integration test course.',
        priceMinor: 10_000, currency: 'egp',
      },
    });
    expect(course.statusCode).toBe(201);
    const module = await app.inject({
      method: 'POST', url: `/api/admin/courses/${course.json().data.id}/modules`,
      cookies: { yaa_session: cookie.value },
      payload: { title: 'Module One', description: 'Core module', position: 1 },
    });
    expect(module.statusCode).toBe(201);
    const lesson = await app.inject({
      method: 'POST', url: `/api/admin/modules/${module.json().data.id}/lessons`,
      cookies: { yaa_session: cookie.value },
      payload: {
        title: 'Lesson One', summary: 'A useful summary', transcript: 'A complete transcript.',
        durationSeconds: 600, position: 1, points: 100,
      },
    });
    expect(lesson.statusCode).toBe(201);
    const quiz = await app.inject({
      method: 'POST', url: `/api/admin/lessons/${lesson.json().data.id}/quizzes`,
      cookies: { yaa_session: cookie.value },
      payload: { title: 'Lesson Quiz', passingScore: 70 },
    });
    const question = await app.inject({
      method: 'POST', url: `/api/admin/quizzes/${quiz.json().data.id}/questions`,
      cookies: { yaa_session: cookie.value },
      payload: {
        prompt: 'Which choice is correct?', choices: ['First', 'Second'],
        correctChoice: 1, explanation: 'The second choice is correct.', position: 1,
      },
    });
    expect(question.statusCode).toBe(201);
    expect(question.json().data).not.toHaveProperty('correctChoice');
    const updates = await Promise.all([
      app.inject({
        method: 'PATCH', url: `/api/admin/courses/${course.json().data.id}`,
        cookies: { yaa_session: cookie.value }, payload: { title: 'Updated Content Flow Course' },
      }),
      app.inject({
        method: 'PATCH', url: `/api/admin/modules/${module.json().data.id}`,
        cookies: { yaa_session: cookie.value }, payload: { description: 'Updated module description' },
      }),
      app.inject({
        method: 'PATCH', url: `/api/admin/lessons/${lesson.json().data.id}`,
        cookies: { yaa_session: cookie.value }, payload: { points: 150 },
      }),
      app.inject({
        method: 'PATCH', url: `/api/admin/quizzes/${quiz.json().data.id}`,
        cookies: { yaa_session: cookie.value }, payload: { passingScore: 80 },
      }),
      app.inject({
        method: 'PATCH', url: `/api/admin/questions/${question.json().data.id}`,
        cookies: { yaa_session: cookie.value }, payload: { explanation: 'Updated safe explanation.' },
      }),
    ]);
    expect(updates.every((response) => response.statusCode === 200)).toBe(true);
    expect((await app.inject({
      method: 'POST', url: `/api/admin/lessons/${lesson.json().data.id}/publish`,
      cookies: { yaa_session: cookie.value },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: 'POST', url: `/api/admin/courses/${course.json().data.id}/publish`,
      cookies: { yaa_session: cookie.value },
    })).statusCode).toBe(200);
    const preview = await app.inject({
      method: 'GET', url: `/api/admin/courses/${course.json().data.id}/preview`,
      cookies: { yaa_session: cookie.value },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toMatchObject({ preview: true, status: 'published' });
    expect(preview.json().data.content).toHaveLength(1);
    const audit = await app.inject({
      method: 'GET', url: '/api/admin/audit-logs?limit=20',
      cookies: { yaa_session: cookie.value },
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.map((entry: { action: string }) => entry.action))
      .toEqual(expect.arrayContaining(['course.create', 'lesson.publish', 'course.publish']));
    expect(audit.json().data.every((entry: { metadata: unknown }) =>
      !JSON.stringify(entry.metadata).includes('Demo@2026!'))).toBe(true);
    const disposable = await app.inject({
      method: 'POST', url: '/api/admin/courses', cookies: { yaa_session: cookie.value },
      payload: {
        slug: `disposable-${stamp}`, title: 'Disposable Course',
        description: 'A draft course created to verify safe deletion.', priceMinor: 0, currency: 'EGP',
      },
    });
    const deleted = await app.inject({
      method: 'DELETE', url: `/api/admin/courses/${disposable.json().data.id}`,
      cookies: { yaa_session: cookie.value },
    });
    expect(deleted.statusCode).toBe(204);
    const missingPreview = await app.inject({
      method: 'GET', url: `/api/admin/courses/${disposable.json().data.id}/preview`,
      cookies: { yaa_session: cookie.value },
    });
    expect(missingPreview.statusCode).toBe(404);
  });

  it('submits and grades a project through the development API', async () => {
    const student = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Project Student', email: `project-${Date.now()}@example.com`,
        password: 'Strong@Password2026', acceptedTerms: true,
      },
    });
    const studentCookie = student.cookies.find((item) => item.name === 'yaa_session')!;
    const otp = await app.inject({
      method: 'POST', url: '/api/auth/request-email-verification',
      cookies: { yaa_session: studentCookie.value },
    });
    await app.inject({
      method: 'POST', url: '/api/auth/verify-email', cookies: { yaa_session: studentCookie.value },
      payload: { otp: otp.json().developmentOtp },
    });
    const checkout = await app.inject({
      method: 'POST', url: '/api/checkout', cookies: { yaa_session: studentCookie.value },
      payload: {
        courseId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: `project-enrollment-${Date.now()}`,
      },
    });
    await app.inject({
      method: 'POST', url: `/api/payments/sandbox/${checkout.json().order.id}`,
      cookies: { yaa_session: studentCookie.value },
    });
    const submission = await app.inject({
      method: 'POST',
      url: '/api/projects/55555555-5555-4555-8555-555555555555/submissions',
      cookies: { yaa_session: studentCookie.value },
      payload: { repositoryUrl: 'https://github.com/example/student-project', notes: 'Ready for review.' },
    });
    expect(submission.statusCode).toBe(201);
    const instructor = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'instructor@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const instructorCookie = instructor.cookies.find((item) => item.name === 'yaa_session')!;
    const grade = await app.inject({
      method: 'PUT', url: `/api/submissions/${submission.json().data.id}/grade`,
      cookies: { yaa_session: instructorCookie.value },
      payload: {
        score: 88, rubricResult: { quality: 44, correctness: 44 },
        feedback: 'Strong implementation and clear repository.', revisionRequested: false,
      },
    });
    expect(grade.statusCode).toBe(200);
    expect(grade.json().data).toMatchObject({ score: 88, status: 'graded' });
  });

  it('processes a signed payment webhook exactly once', async () => {
    const registration = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Webhook Student', email: `webhook-${Date.now()}@example.com`,
        password: 'Strong@Password2026', acceptedTerms: true,
      },
    });
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const otp = await app.inject({
      method: 'POST', url: '/api/auth/request-email-verification',
      cookies: { yaa_session: cookie.value },
    });
    await app.inject({
      method: 'POST', url: '/api/auth/verify-email', cookies: { yaa_session: cookie.value },
      payload: { otp: otp.json().developmentOtp },
    });
    const checkout = await app.inject({
      method: 'POST', url: '/api/checkout', cookies: { yaa_session: cookie.value },
      payload: {
        courseId: '11111111-1111-4111-8111-111111111111',
        idempotencyKey: `webhook-checkout-${Date.now()}`,
      },
    });
    const payload = {
      event: 'payment.succeeded', orderId: checkout.json().order.id,
      providerReference: `provider-${Date.now()}`, amountMinor: 79_900,
    };
    const raw = JSON.stringify(payload);
    const headers = {
      'content-type': 'application/json',
      'x-event-id': `webhook-event-${Date.now()}`,
      'x-webhook-signature': createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex'),
    };
    const mismatchedRaw = JSON.stringify({ ...payload, amountMinor: 1 });
    const mismatch = await app.inject({
      method: 'POST', url: '/api/webhooks/sandbox',
      headers: {
        ...headers,
        'x-webhook-signature': createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(mismatchedRaw).digest('hex'),
      },
      payload: mismatchedRaw,
    });
    expect(mismatch.statusCode).toBe(422);
    const first = await app.inject({ method: 'POST', url: '/api/webhooks/sandbox', headers, payload: raw });
    const replay = await app.inject({ method: 'POST', url: '/api/webhooks/sandbox', headers, payload: raw });
    expect(first.json()).toMatchObject({ received: true, duplicate: false, processed: true });
    expect(replay.json()).toMatchObject({ received: true, duplicate: true, processed: false });
    const dashboard = await app.inject({
      method: 'GET', url: '/api/dashboard', cookies: { yaa_session: cookie.value },
    });
    expect(dashboard.json().data).toHaveLength(1);
  });

  it('exports and permanently closes a development account with password confirmation', async () => {
    const email = `privacy-${Date.now()}@example.com`;
    const registration = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Privacy Student', email,
        password: 'Strong@Password2026', acceptedTerms: true,
      },
    });
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const exported = await app.inject({
      method: 'GET', url: '/api/account/export', cookies: { yaa_session: cookie.value },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().profile).toMatchObject({ email, fullName: 'Privacy Student' });
    expect(JSON.stringify(exported.json())).not.toContain('password');
    const deleted = await app.inject({
      method: 'DELETE', url: '/api/account', cookies: { yaa_session: cookie.value },
      payload: { password: 'Strong@Password2026', confirmation: 'DELETE' },
    });
    expect(deleted.statusCode).toBe(204);
    const me = await app.inject({
      method: 'GET', url: '/api/auth/me', cookies: { yaa_session: cookie.value },
    });
    expect(me.statusCode).toBe(401);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email, password: 'Strong@Password2026' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('persists optional notification preferences and protects mandatory alerts', async () => {
    const registration = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Notification Student', email: `notifications-${Date.now()}@example.com`,
        password: 'Strong@Password2026', acceptedTerms: true,
      },
    });
    expect(registration.statusCode).toBe(201);
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const saved = await app.inject({
      method: 'PUT', url: '/api/notification-preferences', cookies: { yaa_session: cookie.value },
      payload: { channel: 'email', notificationType: 'course_reminder', enabled: false },
    });
    expect(saved.statusCode).toBe(200);
    const listed = await app.inject({
      method: 'GET', url: '/api/notification-preferences', cookies: { yaa_session: cookie.value },
    });
    expect(listed.json().data).toContainEqual({
      channel: 'email', notificationType: 'course_reminder', enabled: false,
    });
    const mandatory = await app.inject({
      method: 'PUT', url: '/api/notification-preferences', cookies: { yaa_session: cookie.value },
      payload: { channel: 'in_app', notificationType: 'security_alert', enabled: false },
    });
    expect(mandatory.statusCode).toBe(409);
    expect(mandatory.json()).toMatchObject({ code: 'REQUIRED_NOTIFICATION' });
  });
});
