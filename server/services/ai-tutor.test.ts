import { describe, expect, it, vi } from 'vitest';
import { generateTutorReply } from './ai-tutor.js';

describe('OpenAI tutor adapter', () => {
  it('uses a bounded, non-persistent Socratic Responses API request', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: 'ما أول خطوة صغيرة يمكنك اختبارها؟' });
    const moderate = vi.fn().mockResolvedValue({ results: [{ flagged: false }] });
    const result = await generateTutorReply('ساعدني في فهم الحلقة', {
      moderations: { create: moderate }, responses: { create },
    });
    expect(result).toContain('أول خطوة');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: expect.any(String),
      input: 'ساعدني في فهم الحلقة',
      max_output_tokens: 300,
      store: false,
    }));
    expect(create.mock.calls[0][0].instructions).toContain('لا تعطِ إجابة اختبار');
    expect(moderate).toHaveBeenCalledWith({
      model: 'omni-moderation-latest', input: 'ساعدني في فهم الحلقة',
    });
  });

  it('rejects an empty provider response', async () => {
    const create = vi.fn().mockResolvedValue({ output_text: '   ' });
    const moderate = vi.fn().mockResolvedValue({ results: [{ flagged: false }] });
    await expect(generateTutorReply('سؤال', { moderations: { create: moderate }, responses: { create } }))
      .rejects.toThrow('AI_PROVIDER_EMPTY_RESPONSE');
  });

  it('blocks personal contact data before calling the provider', async () => {
    const create = vi.fn();
    const moderate = vi.fn();
    await expect(generateTutorReply('راسلني على student@example.com', {
      moderations: { create: moderate }, responses: { create },
    })).rejects.toThrow('AI_SENSITIVE_DATA');
    expect(moderate).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('blocks content flagged by moderation before generation', async () => {
    const create = vi.fn();
    const moderate = vi.fn().mockResolvedValue({ results: [{ flagged: true }] });
    await expect(generateTutorReply('unsafe request', {
      moderations: { create: moderate }, responses: { create },
    })).rejects.toThrow('AI_CONTENT_BLOCKED');
    expect(create).not.toHaveBeenCalled();
  });
});
