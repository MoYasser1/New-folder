import { config } from '../config.js';

export type EmailMessage = {
  to: string;
  template: 'verify_email' | 'reset_password' | 'payment_receipt' | 'weekly_digest';
  variables: Record<string, string>;
};

export async function sendEmail(message: EmailMessage): Promise<{ providerId: string }> {
  if (config.EMAIL_PROVIDER === 'disabled') throw new Error('EMAIL_PROVIDER_DISABLED');
  if (config.EMAIL_PROVIDER === 'development') {
    return { providerId: `development:${message.template}:${Date.now()}` };
  }
  const response = await fetch(config.EMAIL_PROVIDER_URL!, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.EMAIL_PROVIDER_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_ERROR_${response.status}`);
  const payload = await response.json() as { id?: string };
  return { providerId: payload.id || `http:${Date.now()}` };
}
