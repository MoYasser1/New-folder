import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission, requireVerifiedUser } from '../auth/authorization.js';
import { config } from '../config.js';
import { db } from '../db/pool.js';
import { DEV_COURSE_ID, devOrders, devRefunds, devWebhookEvents } from '../db/dev-store.js';
import { randomUUID } from 'node:crypto';
import { createProviderCheckout, createProviderRefund } from '../services/payment-provider.js';

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const paymentEventSchema = z.object({
  event: z.enum(['payment.succeeded', 'payment.failed', 'payment.cancelled']),
  orderId: z.uuid(),
  providerReference: z.string().min(3).max(200),
  amountMinor: z.number().int().nonnegative(),
});

export async function paymentRoutes(app: FastifyInstance) {
  app.post('/checkout', { preHandler: [requirePermission('payment.create'), requireVerifiedUser] }, async (request, reply) => {
    const parsed = z.object({ courseId: z.uuid(), idempotencyKey: z.string().min(16).max(100) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      if (parsed.data.courseId !== DEV_COURSE_ID) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
      const existing = [...devOrders.values()].find((order) => order.idempotencyKey === parsed.data.idempotencyKey);
      if (existing && (existing.userId !== request.user!.id || existing.courseId !== parsed.data.courseId)) {
        return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT' });
      }
      const order = existing ?? {
        id: randomUUID(), userId: request.user!.id, courseId: parsed.data.courseId,
        status: 'pending', amountMinor: 79900, currency: 'EGP', idempotencyKey: parsed.data.idempotencyKey,
      };
      devOrders.set(order.id, order);
      return reply.code(201).send({ order, provider: 'sandbox', checkoutUrl: `/api/payments/sandbox/${order.id}` });
    }
    const course = await db.query<{ price_minor: number; currency: string }>(
      `SELECT price_minor, currency FROM courses WHERE id=$1 AND status='published'`, [parsed.data.courseId],
    );
    if (!course.rows[0]) return reply.code(404).send({ code: 'COURSE_NOT_FOUND' });
    const result = await db.query(
      `INSERT INTO orders(user_id,course_id,amount_minor,currency,idempotency_key)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(idempotency_key) DO NOTHING
       RETURNING id,status,amount_minor,currency`,
      [request.user!.id, parsed.data.courseId, course.rows[0].price_minor, course.rows[0].currency, parsed.data.idempotencyKey],
    );
    let order = result.rows[0];
    if (!order) {
      const existing = await db.query(
        `SELECT id,status,amount_minor,currency FROM orders
         WHERE idempotency_key=$1 AND user_id=$2 AND course_id=$3`,
        [parsed.data.idempotencyKey, request.user!.id, parsed.data.courseId],
      );
      order = existing.rows[0];
      if (!order) return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT' });
    }
    if (config.PAYMENT_PROVIDER === 'sandbox') {
      return reply.code(201).send({ order, provider: 'sandbox', checkoutUrl: `/api/payments/sandbox/${order.id}` });
    }
    try {
      const checkout = await createProviderCheckout({
        orderId: order.id, amountMinor: order.amount_minor, currency: order.currency,
        customerEmail: request.user!.email, idempotencyKey: parsed.data.idempotencyKey,
      });
      return reply.code(201).send({ order, provider: config.PAYMENT_PROVIDER, ...checkout });
    } catch (error) {
      request.log.error({ err: error, orderId: order.id }, 'Payment checkout provider failed');
      return reply.code(502).send({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    }
  });

  app.post('/payments/sandbox/:orderId', { preHandler: [requirePermission('payment.create'), requireVerifiedUser] }, async (request, reply) => {
    if (config.PAYMENT_PROVIDER !== 'sandbox') return reply.code(404).send({ code: 'NOT_FOUND' });
    const params = z.object({ orderId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const { orderId } = params.data;
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const order = devOrders.get(orderId);
      if (!order || order.userId !== request.user!.id) return reply.code(404).send({ code: 'ORDER_NOT_FOUND' });
      order.status = 'succeeded';
      return { status: 'succeeded', enrollmentCreated: true };
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query<{ course_id: string; amount_minor: number }>(
        `SELECT course_id,amount_minor FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`, [orderId, request.user!.id],
      );
      if (!order.rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ code: 'ORDER_NOT_FOUND' });
      }
      const reference = `sandbox_${orderId}`;
      await client.query(`UPDATE orders SET status='succeeded',updated_at=now() WHERE id=$1`, [orderId]);
      await client.query(
        `INSERT INTO payments(order_id,provider,provider_reference,amount_minor,status)
         VALUES($1,'sandbox',$2,$3,'succeeded') ON CONFLICT(provider,provider_reference) DO NOTHING`,
        [orderId, reference, order.rows[0].amount_minor],
      );
      await client.query(
        `INSERT INTO enrollments(user_id,course_id) VALUES($1,$2)
         ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`,
        [request.user!.id, order.rows[0].course_id],
      );
      await client.query('COMMIT');
      return { status: 'succeeded', enrollmentCreated: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/webhooks/:provider', { config: { rawBody: true } }, async (request, reply) => {
    const params = z.object({ provider: z.string().regex(/^[a-z0-9_-]+$/).min(1).max(30) }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    const { provider } = params.data;
    if (provider !== config.PAYMENT_PROVIDER) return reply.code(404).send({ code: 'PROVIDER_NOT_CONFIGURED' });
    const signature = request.headers['x-webhook-signature'];
    const eventId = request.headers['x-event-id'];
    if (typeof signature !== 'string' || typeof eventId !== 'string') {
      return reply.code(401).send({ code: 'INVALID_WEBHOOK' });
    }
    const payload = request.rawBody || JSON.stringify(request.body);
    const expected = createHmac('sha256', config.PAYMENT_WEBHOOK_SECRET).update(payload).digest('hex');
    if (!safeEqual(signature, expected)) return reply.code(401).send({ code: 'INVALID_SIGNATURE' });
    const paymentEvent = paymentEventSchema.safeParse(request.body);
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const key = `${provider}:${eventId}`;
      const duplicate = devWebhookEvents.has(key);
      if (duplicate) return { received: true, duplicate: true, processed: false };
      if (paymentEvent.success) {
        const order = devOrders.get(paymentEvent.data.orderId);
        if (!order || order.amountMinor !== paymentEvent.data.amountMinor) {
          return reply.code(422).send({ code: 'WEBHOOK_ORDER_MISMATCH' });
        }
        devWebhookEvents.add(key);
        order.status = paymentEvent.data.event === 'payment.succeeded'
          ? 'succeeded'
          : paymentEvent.data.event === 'payment.failed' ? 'failed' : 'cancelled';
      } else {
        devWebhookEvents.add(key);
      }
      return { received: true, duplicate: false, processed: paymentEvent.success };
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO webhook_events(provider,event_id,payload_hash) VALUES($1,$2,$3)
         ON CONFLICT DO NOTHING RETURNING event_id`, [provider, eventId, expected],
      );
      if (inserted.rowCount === 0) {
        await client.query('COMMIT');
        return { received: true, duplicate: true, processed: false };
      }
      if (!paymentEvent.success) {
        await client.query('COMMIT');
        return { received: true, duplicate: false, processed: false };
      }
      const order = await client.query<{ user_id: string; course_id: string; amount_minor: number }>(
        'SELECT user_id,course_id,amount_minor FROM orders WHERE id=$1 FOR UPDATE', [paymentEvent.data.orderId],
      );
      if (!order.rows[0] || order.rows[0].amount_minor !== paymentEvent.data.amountMinor) {
        await client.query('ROLLBACK');
        return reply.code(422).send({ code: 'WEBHOOK_ORDER_MISMATCH' });
      }
      const status = paymentEvent.data.event === 'payment.succeeded'
        ? 'succeeded'
        : paymentEvent.data.event === 'payment.failed' ? 'failed' : 'cancelled';
      await client.query('UPDATE orders SET status=$1,updated_at=now() WHERE id=$2', [status, paymentEvent.data.orderId]);
      await client.query(
        `INSERT INTO payments(order_id,provider,provider_reference,amount_minor,status,raw_event)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(provider,provider_reference) DO UPDATE SET status=EXCLUDED.status,raw_event=EXCLUDED.raw_event`,
        [paymentEvent.data.orderId, provider, paymentEvent.data.providerReference,
          paymentEvent.data.amountMinor, status, JSON.stringify(request.body)],
      );
      if (status === 'succeeded') await client.query(
        `INSERT INTO enrollments(user_id,course_id) VALUES($1,$2)
         ON CONFLICT(user_id,course_id) DO UPDATE SET status='active'`,
        [order.rows[0].user_id, order.rows[0].course_id],
      );
      await client.query('COMMIT');
      return { received: true, duplicate: false, processed: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/account/orders', { preHandler: requirePermission('payment.create') }, async (request) => {
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      return { data: [...devOrders.values()].filter((order) => order.userId === request.user!.id) };
    }
    const result = await db.query(
      `SELECT o.id,o.amount_minor "amountMinor",o.currency,o.status,o.created_at "createdAt",
       c.title course_title FROM orders o JOIN courses c ON c.id=o.course_id
       WHERE o.user_id=$1 ORDER BY o.created_at DESC`, [request.user!.id],
    );
    return { data: result.rows };
  });

  app.get('/account/orders/:orderId/invoice', { preHandler: requirePermission('payment.create') }, async (request, reply) => {
    const params = z.object({ orderId: z.uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const order = devOrders.get(params.data.orderId);
      if (!order || order.userId !== request.user!.id || order.status !== 'succeeded') return reply.code(404).send({ code: 'INVOICE_NOT_FOUND' });
      return { data: {
        id: order.id,
        number: `YAA-${order.id.slice(0, 8).toUpperCase()}`,
        amountMinor: order.amountMinor,
        currency: order.currency,
        status: order.status,
        issuedAt: new Date().toISOString(),
        customerName: request.user!.fullName,
        email: request.user!.email,
        courseTitle: 'AI Programming Launch',
      } };
    }
    const result = await db.query(
      `SELECT o.id,('YAA-'||upper(substr(o.id::text,1,8))) number,o.amount_minor "amountMinor",
       o.currency,o.status,o.created_at "issuedAt",u.full_name "customerName",u.email,c.title "courseTitle"
       FROM orders o JOIN users u ON u.id=o.user_id JOIN courses c ON c.id=o.course_id
       WHERE o.id=$1 AND o.user_id=$2 AND o.status IN ('succeeded','partially_refunded','refunded')`,
      [params.data.orderId, request.user!.id],
    );
    if (!result.rows[0]) return reply.code(404).send({ code: 'INVOICE_NOT_FOUND' });
    return { data: result.rows[0] };
  });

  app.post('/finance/orders/:orderId/refunds', { preHandler: requirePermission('payment.refund') }, async (request, reply) => {
    const params = z.object({ orderId: z.uuid() }).safeParse(request.params);
    const input = z.object({
      amountMinor: z.number().int().positive(),
      reason: z.string().min(5).max(500),
      idempotencyKey: z.string().min(16).max(100),
    }).safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    if (config.NODE_ENV !== 'production' && config.DEV_MEMORY_MODE) {
      const existing = devRefunds.get(input.data.idempotencyKey);
      if (existing) return { data: existing };
      const order = devOrders.get(params.data.orderId);
      const alreadyRefunded = order
        ? [...devRefunds.values()].filter((refund) => refund.orderId === order.id && refund.status === 'succeeded')
          .reduce((total, refund) => total + refund.amountMinor, 0)
        : 0;
      if (!order || !['succeeded', 'partially_refunded'].includes(order.status) ||
          alreadyRefunded + input.data.amountMinor > order.amountMinor) {
        return reply.code(409).send({ code: 'REFUND_NOT_ALLOWED' });
      }
      const refund = { id: randomUUID(), orderId: order.id, amountMinor: input.data.amountMinor, status: 'succeeded', reason: input.data.reason };
      devRefunds.set(input.data.idempotencyKey, refund);
      order.status = alreadyRefunded + input.data.amountMinor === order.amountMinor ? 'refunded' : 'partially_refunded';
      return reply.code(201).send({ data: refund });
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const existingRefund = await client.query(
        'SELECT * FROM refunds WHERE idempotency_key=$1', [input.data.idempotencyKey],
      );
      if (existingRefund.rows[0]) {
        await client.query('COMMIT');
        return { data: existingRefund.rows[0] };
      }
      const payment = await client.query<{ id: string; amount_minor: number; provider_reference: string }>(
        `SELECT p.id,p.amount_minor,p.provider_reference FROM payments p JOIN orders o ON o.id=p.order_id
         WHERE o.id=$1 AND p.status='succeeded' FOR UPDATE`, [params.data.orderId],
      );
      const paymentRow = payment.rows[0];
      const refundedResult = paymentRow
        ? await client.query<{ refunded: number }>(
          `SELECT coalesce(sum(amount_minor) FILTER(WHERE status='succeeded'),0)::int refunded FROM refunds WHERE payment_id=$1`,
          [paymentRow.id],
        ) : null;
      const refunded = refundedResult?.rows[0]?.refunded ?? 0;
      if (!paymentRow || refunded + input.data.amountMinor > paymentRow.amount_minor) {
        await client.query('ROLLBACK');
        return reply.code(409).send({ code: 'REFUND_NOT_ALLOWED' });
      }
      const providerRefund = config.PAYMENT_PROVIDER === 'sandbox'
        ? { providerReference: `sandbox_refund_${params.data.orderId}_${input.data.idempotencyKey}`, status: 'succeeded' as const }
        : await createProviderRefund({
          orderId: params.data.orderId, paymentReference: paymentRow.provider_reference,
          amountMinor: input.data.amountMinor, reason: input.data.reason,
          idempotencyKey: input.data.idempotencyKey,
        }).catch((error) => {
          request.log.error({ err: error, orderId: params.data.orderId }, 'Payment refund provider failed');
          return null;
        });
      if (!providerRefund) {
        await client.query('ROLLBACK');
        return reply.code(502).send({ code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
      }
      const refund = await client.query(
        `INSERT INTO refunds(payment_id,requested_by,amount_minor,reason,status,provider_reference,idempotency_key,completed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $5='succeeded' THEN now() ELSE NULL END)
         ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`,
        [paymentRow.id, request.user!.id, input.data.amountMinor, input.data.reason,
          providerRefund.status, providerRefund.providerReference, input.data.idempotencyKey],
      );
      const total = refunded + input.data.amountMinor;
      await client.query(`UPDATE orders SET status=$1,updated_at=now() WHERE id=$2`,
        [total === paymentRow.amount_minor ? 'refunded' : 'partially_refunded', params.data.orderId]);
      await client.query('COMMIT');
      return reply.code(201).send({ data: refund.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
