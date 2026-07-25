import { z } from 'zod';
import { config } from '../config.js';

const checkoutResponse = z.object({
  checkoutUrl: z.url(),
  providerReference: z.string().min(1).max(200),
});
const refundResponse = z.object({
  providerReference: z.string().min(1).max(200),
  status: z.literal('succeeded'),
});

async function providerRequest(path: string, payload: Record<string, unknown>, fetcher: typeof fetch) {
  if (!config.PAYMENT_PROVIDER_URL || !config.PAYMENT_PROVIDER_TOKEN) {
    throw new Error('PAYMENT_PROVIDER_UNAVAILABLE');
  }
  const baseUrl = config.PAYMENT_PROVIDER_URL.endsWith('/')
    ? config.PAYMENT_PROVIDER_URL
    : `${config.PAYMENT_PROVIDER_URL}/`;
  const response = await fetcher(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.PAYMENT_PROVIDER_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => { throw new Error('PAYMENT_PROVIDER_UNAVAILABLE'); });
  if (!response.ok) throw new Error(`PAYMENT_PROVIDER_ERROR_${response.status}`);
  return response.json();
}

export async function createProviderCheckout(
  input: { orderId: string; amountMinor: number; currency: string; customerEmail: string; idempotencyKey: string },
  fetcher: typeof fetch = fetch,
) {
  const payload = await providerRequest('checkouts', {
    ...input, provider: config.PAYMENT_PROVIDER,
    successUrl: `${config.WEB_ORIGIN}/?payment=success&orderId=${encodeURIComponent(input.orderId)}`,
    cancelUrl: `${config.WEB_ORIGIN}/?payment=cancelled&orderId=${encodeURIComponent(input.orderId)}`,
  }, fetcher);
  const parsed = checkoutResponse.safeParse(payload);
  if (!parsed.success) throw new Error('PAYMENT_PROVIDER_INVALID_RESPONSE');
  return parsed.data;
}

export async function createProviderRefund(
  input: { orderId: string; paymentReference: string; amountMinor: number; reason: string; idempotencyKey: string },
  fetcher: typeof fetch = fetch,
) {
  const payload = await providerRequest('refunds', {
    ...input, provider: config.PAYMENT_PROVIDER,
  }, fetcher);
  const parsed = refundResponse.safeParse(payload);
  if (!parsed.success) throw new Error('PAYMENT_PROVIDER_INVALID_RESPONSE');
  return parsed.data;
}
