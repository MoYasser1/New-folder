import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { config } from './config.js';

let app: FastifyInstance;
const multipart = (filename: string, mimeType: string, content: string) => {
  const boundary = `----security-${Date.now()}`;
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--\r\n`),
  };
};

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());

describe('security boundaries', () => {
  it('rejects protected resources without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('prevents a student from creating courses', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const cookie = login.cookies.find((item) => item.name === 'yaa_session')!;
    const response = await app.inject({
      method: 'POST', url: '/api/admin/courses', cookies: { yaa_session: cookie.value },
      payload: { slug: 'forbidden-course', title: 'غير مسموح', description: 'وصف طويل صالح للاختبار', priceMinor: 100 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'FORBIDDEN' });
    const audit = await app.inject({
      method: 'GET', url: '/api/admin/audit-logs',
      cookies: { yaa_session: cookie.value },
    });
    expect(audit.statusCode).toBe(403);
  });

  it('blocks checkout until a newly registered account verifies its email', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        fullName: 'Unverified Student',
        email: `unverified-${Date.now()}@example.com`,
        password: 'Strong@Password2026',
        acceptedTerms: true,
      },
    });
    const cookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const courses = await app.inject({ method: 'GET', url: '/api/courses' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/checkout',
      cookies: { yaa_session: cookie.value },
      payload: {
        courseId: courses.json().data[0].id,
        idempotencyKey: `unverified-checkout-${Date.now()}`,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'EMAIL_VERIFICATION_REQUIRED' });
  });

  it('does not allow unknown browser origins', async () => {
    const response = await app.inject({
      method: 'OPTIONS', url: '/api/auth/login',
      headers: { origin: 'https://attacker.example', 'access-control-request-method': 'POST' },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    const privateNetwork = await app.inject({
      method: 'OPTIONS', url: '/api/auth/login',
      headers: { origin: 'http://192.168.1.2:3000', 'access-control-request-method': 'POST' },
    });
    expect(privateNetwork.statusCode).toBe(204);
    expect(privateNetwork.headers['access-control-allow-origin']).toBe('http://192.168.1.2:3000');
  });

  it('verifies webhook signatures and detects replay', async () => {
    const payload = { event: 'payment.succeeded', reference: 'security-test' };
    const signature = createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest('hex');
    const headers = { 'x-event-id': 'evt_security_1', 'x-webhook-signature': signature };
    const first = await app.inject({ method: 'POST', url: '/api/webhooks/sandbox', headers, payload });
    const replay = await app.inject({ method: 'POST', url: '/api/webhooks/sandbox', headers, payload });
    expect(first.json()).toMatchObject({ received: true, duplicate: false });
    expect(replay.json()).toMatchObject({ received: true, duplicate: true });
    const invalid = await app.inject({
      method: 'POST', url: '/api/webhooks/sandbox',
      headers: { ...headers, 'x-event-id': 'evt_security_2', 'x-webhook-signature': 'invalid' }, payload,
    });
    expect(invalid.statusCode).toBe(401);
    const wrongProvider = await app.inject({
      method: 'POST', url: '/api/webhooks/stripe',
      headers: { ...headers, 'x-event-id': 'evt_security_3' }, payload,
    });
    expect(wrongProvider.statusCode).toBe(404);
  });

  it('enforces upload purpose permissions and file signatures', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const cookie = login.cookies.find((item) => item.name === 'yaa_session')!;
    const fakeImage = multipart('malware.png', 'image/png', '<script>not an image</script>');
    const invalidSignature = await app.inject({
      method: 'POST', url: '/api/uploads/avatar', cookies: { yaa_session: cookie.value },
      headers: { 'content-type': fakeImage.contentType }, payload: fakeImage.body,
    });
    expect(invalidSignature.statusCode).toBe(415);
    expect(invalidSignature.json()).toMatchObject({ code: 'FILE_SIGNATURE_INVALID' });
    const fakeVideo = multipart('lesson.mp4', 'video/mp4', 'fake video');
    const forbiddenPurpose = await app.inject({
      method: 'POST', url: '/api/uploads/lesson_media', cookies: { yaa_session: cookie.value },
      headers: { 'content-type': fakeVideo.contentType }, payload: fakeVideo.body,
    });
    expect(forbiddenPurpose.statusCode).toBe(403);
  });

  it('locks an account temporarily after repeated failed logins', async () => {
    const email = `locked-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Lockout Test', email, password: 'Strong@Password2026', acceptedTerms: true,
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { email, password: 'Wrong@Password2026' },
      });
      expect(failed.statusCode).toBe(401);
      expect(failed.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    const correctButLocked = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email, password: 'Strong@Password2026' },
    });
    expect(correctButLocked.statusCode).toBe(401);
    expect(correctButLocked.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
  });

  it('rejects weak passwords during registration', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Weak Password', email: `weak-${Date.now()}@example.com`,
        password: 'password1234', acceptedTerms: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('does not expose an order when another account reuses its idempotency key', async () => {
    const ownerLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const ownerCookie = ownerLogin.cookies.find((item) => item.name === 'yaa_session')!;
    const idempotencyKey = `private-order-${Date.now()}`;
    const ownerOrder = await app.inject({
      method: 'POST', url: '/api/checkout', cookies: { yaa_session: ownerCookie.value },
      payload: {
        courseId: '11111111-1111-4111-8111-111111111111', idempotencyKey,
      },
    });
    expect(ownerOrder.statusCode).toBe(201);
    const registration = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: {
        fullName: 'Other Student', email: `other-${Date.now()}@example.com`,
        password: 'Strong@Password2026', acceptedTerms: true,
      },
    });
    const otherCookie = registration.cookies.find((item) => item.name === 'yaa_session')!;
    const otp = await app.inject({
      method: 'POST', url: '/api/auth/request-email-verification',
      cookies: { yaa_session: otherCookie.value },
    });
    await app.inject({
      method: 'POST', url: '/api/auth/verify-email', cookies: { yaa_session: otherCookie.value },
      payload: { otp: otp.json().developmentOtp },
    });
    const conflict = await app.inject({
      method: 'POST', url: '/api/checkout', cookies: { yaa_session: otherCookie.value },
      payload: {
        courseId: '11111111-1111-4111-8111-111111111111', idempotencyKey,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(JSON.stringify(conflict.json())).not.toContain(ownerOrder.json().order.id);
  });

  it('isolates authenticated rate limits by hashed session instead of shared NAT IP', async () => {
    const studentLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'student@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const parentLogin = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { email: 'parent@yasser-ai.demo', password: 'Demo@2026!' },
    });
    const studentCookie = studentLogin.cookies.find((item) => item.name === 'yaa_session')!;
    const parentCookie = parentLogin.cookies.find((item) => item.name === 'yaa_session')!;
    let limitedStatus = 0;
    for (let requestNumber = 0; requestNumber < 121; requestNumber += 1) {
      const response = await app.inject({
        method: 'GET', url: '/api/notifications',
        cookies: { yaa_session: studentCookie.value },
      });
      limitedStatus = response.statusCode;
    }
    expect(limitedStatus).toBe(429);
    const independentSession = await app.inject({
      method: 'GET', url: '/api/notifications',
      cookies: { yaa_session: parentCookie.value },
    });
    expect(independentSession.statusCode).toBe(200);
  });
});
