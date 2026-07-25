// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { config, validateProductionConfig } from './config.js';

const production = (overrides: Partial<typeof config>) => ({
  ...config,
  NODE_ENV: 'production' as const,
  DEV_MEMORY_MODE: false,
  ...overrides,
});

describe('production configuration fail-closed checks', () => {
  it('rejects default secrets and local providers', () => {
    expect(() => validateProductionConfig(production({
      SESSION_SECRET: 'development-only-secret-change-before-production',
      PAYMENT_WEBHOOK_SECRET: 'sandbox-webhook-secret-change-me',
      PAYMENT_PROVIDER: 'sandbox',
      CODE_RUNNER_PROVIDER: 'local',
      EMAIL_PROVIDER: 'development',
      STORAGE_PROVIDER: 'development',
    }))).toThrow('Production secrets must be explicitly configured');
  });

  it('accepts a complete external-provider production configuration', () => {
    expect(() => validateProductionConfig(production({
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      PAYMENT_WEBHOOK_SECRET: 'abcdef0123456789abcdef0123456789',
      PAYMENT_PROVIDER: 'stripe',
      PAYMENT_PROVIDER_URL: 'https://payments.example/api',
      PAYMENT_PROVIDER_TOKEN: 'payment-token',
      CODE_RUNNER_PROVIDER: 'remote',
      CODE_RUNNER_URL: 'https://runner.example/execute',
      CODE_RUNNER_TOKEN: 'runner-token',
      EMAIL_PROVIDER: 'http',
      EMAIL_PROVIDER_URL: 'https://email.example/send',
      EMAIL_PROVIDER_TOKEN: 'email-token',
      STORAGE_PROVIDER: 'http',
      STORAGE_PROVIDER_URL: 'https://storage.example/objects',
      STORAGE_PROVIDER_TOKEN: 'storage-token',
      AI_PROVIDER: 'disabled',
    }))).not.toThrow();
  });
});
