import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).default('postgres://academy:academy@localhost:5432/academy'),
  SESSION_SECRET: z.string().min(32).default('development-only-secret-change-before-production'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default('sandbox-webhook-secret-change-me'),
  PAYMENT_PROVIDER: z.enum(['sandbox', 'paymob', 'stripe']).default('sandbox'),
  PAYMENT_PROVIDER_URL: z.string().url().optional(),
  PAYMENT_PROVIDER_TOKEN: z.string().optional(),
  DEV_MEMORY_MODE: z.string().default('true').transform((value) => value === 'true'),
  AI_PROVIDER: z.enum(['disabled', 'openai']).default('disabled'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-5.6-luna'),
  CODE_RUNNER_PROVIDER: z.enum(['disabled', 'local', 'remote']).default('local'),
  CODE_RUNNER_URL: z.string().url().optional(),
  CODE_RUNNER_TOKEN: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['development', 'http', 'disabled']).default('development'),
  EMAIL_PROVIDER_URL: z.string().url().optional(),
  EMAIL_PROVIDER_TOKEN: z.string().optional(),
  STORAGE_PROVIDER: z.enum(['development', 'http', 'disabled']).default('development'),
  STORAGE_PROVIDER_URL: z.string().url().optional(),
  STORAGE_PROVIDER_TOKEN: z.string().optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(25 * 1024 * 1024),
});

export const config = environmentSchema.parse(process.env);
export function validateProductionConfig(candidate: typeof config) {
  if (candidate.NODE_ENV !== 'production') return;
  const forbiddenDefaults = [
    'development-only-secret-change-before-production',
    'sandbox-webhook-secret-change-me',
  ];
  if (forbiddenDefaults.includes(candidate.SESSION_SECRET) || forbiddenDefaults.includes(candidate.PAYMENT_WEBHOOK_SECRET)) {
    throw new Error('Production secrets must be explicitly configured with strong random values.');
  }
  if (candidate.DEV_MEMORY_MODE) throw new Error('DEV_MEMORY_MODE must be false in production.');
  if (candidate.PAYMENT_PROVIDER === 'sandbox') throw new Error('Sandbox payments are forbidden in production.');
  if (!candidate.PAYMENT_PROVIDER_URL || !candidate.PAYMENT_PROVIDER_TOKEN) {
    throw new Error('PAYMENT_PROVIDER_URL and PAYMENT_PROVIDER_TOKEN are required in production.');
  }
  if (candidate.AI_PROVIDER === 'openai' && !candidate.AI_API_KEY) throw new Error('AI_API_KEY is required for the OpenAI provider.');
  if (candidate.CODE_RUNNER_PROVIDER === 'local') throw new Error('Local code execution is forbidden in production.');
  if (candidate.CODE_RUNNER_PROVIDER === 'remote' && (!candidate.CODE_RUNNER_URL || !candidate.CODE_RUNNER_TOKEN)) {
    throw new Error('CODE_RUNNER_URL and CODE_RUNNER_TOKEN are required for remote code execution.');
  }
  if (candidate.EMAIL_PROVIDER === 'development') throw new Error('Development email provider is forbidden in production.');
  if (candidate.EMAIL_PROVIDER === 'http' && (!candidate.EMAIL_PROVIDER_URL || !candidate.EMAIL_PROVIDER_TOKEN)) {
    throw new Error('EMAIL_PROVIDER_URL and EMAIL_PROVIDER_TOKEN are required for the HTTP email provider.');
  }
  if (candidate.STORAGE_PROVIDER === 'development') throw new Error('Development storage provider is forbidden in production.');
  if (candidate.STORAGE_PROVIDER === 'http' && (!candidate.STORAGE_PROVIDER_URL || !candidate.STORAGE_PROVIDER_TOKEN)) {
    throw new Error('STORAGE_PROVIDER_URL and STORAGE_PROVIDER_TOKEN are required for the HTTP storage provider.');
  }
}
validateProductionConfig(config);
export const isProduction = config.NODE_ENV === 'production';
