import { describe, expect, it, vi } from 'vitest';
import { createProviderCheckout, createProviderRefund } from './payment-provider.js';
import { config } from '../config.js';

describe('payment HTTP provider adapter', () => {
  it('creates a bounded authenticated checkout request', async () => {
    const oldUrl = config.PAYMENT_PROVIDER_URL;
    const oldToken = config.PAYMENT_PROVIDER_TOKEN;
    Object.assign(config, { PAYMENT_PROVIDER_URL: 'https://payments.example/api', PAYMENT_PROVIDER_TOKEN: 'secret-token' });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      checkoutUrl: 'https://checkout.example/session/123', providerReference: 'pay_123',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    try {
      const result = await createProviderCheckout({
        orderId: '11111111-1111-4111-8111-111111111111', amountMinor: 79900,
        currency: 'EGP', customerEmail: 'student@example.com', idempotencyKey: 'checkout-key-123456',
      }, fetcher);
      expect(result.checkoutUrl).toContain('checkout.example');
      const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
      expect(url.href).toBe('https://payments.example/api/checkouts');
      expect(options.headers).toMatchObject({ authorization: 'Bearer secret-token' });
      expect(JSON.parse(String(options.body))).toMatchObject({ amountMinor: 79900, currency: 'EGP' });
    } finally {
      Object.assign(config, { PAYMENT_PROVIDER_URL: oldUrl, PAYMENT_PROVIDER_TOKEN: oldToken });
    }
  });

  it('validates refund responses instead of trusting provider JSON', async () => {
    const oldUrl = config.PAYMENT_PROVIDER_URL;
    const oldToken = config.PAYMENT_PROVIDER_TOKEN;
    Object.assign(config, { PAYMENT_PROVIDER_URL: 'https://payments.example/api/', PAYMENT_PROVIDER_TOKEN: 'secret-token' });
    try {
      const invalid = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'magic' }), { status: 200 }));
      await expect(createProviderRefund({
        orderId: '11111111-1111-4111-8111-111111111111', paymentReference: 'pay_123',
        amountMinor: 100, reason: 'Customer request', idempotencyKey: 'refund-key-1234567',
      }, invalid)).rejects.toThrow('PAYMENT_PROVIDER_INVALID_RESPONSE');
    } finally {
      Object.assign(config, { PAYMENT_PROVIDER_URL: oldUrl, PAYMENT_PROVIDER_TOKEN: oldToken });
    }
  });
});
