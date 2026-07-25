import OpenAI from 'openai';
import { config } from '../config.js';

type ResponseInput = Parameters<OpenAI['responses']['create']>[0];
type TutorClient = {
  moderations: {
    create(input: Parameters<OpenAI['moderations']['create']>[0]): Promise<{ results: Array<{ flagged: boolean }> }>;
  };
  responses: {
    create(input: ResponseInput): Promise<{ output_text?: string }>;
  };
};

const instructions = `أنت مرشد تعليمي عربي لطلاب المرحلة الثانوية في البرمجة والذكاء الاصطناعي.
استخدم أسلوبًا سقراطيًا: قدّم تلميحًا واحدًا أو سؤالًا يقود الطالب للخطوة التالية.
لا تعطِ إجابة اختبار أو واجب جاهزة، ولا تكتب حلًا كاملًا قابلًا للتسليم.
لا تطلب بيانات شخصية، ولا تخمّن معلومات عن الطالب.
اجعل الرد واضحًا ومشجعًا ومختصرًا، وبحد أقصى 120 كلمة.`;

export type TutorContext = {
  name?: string;
  role?: string;
  courseTitle?: string;
  completedLessons?: number;
  totalLessons?: number;
  currentLesson?: string;
};

export async function generateTutorReply(
  message: string,
  contextOrClient: TutorContext | TutorClient = {},
  providedClient?: TutorClient,
) {
  const context = 'moderations' in contextOrClient ? {} : contextOrClient;
  const injectedClient = 'moderations' in contextOrClient ? contextOrClient : providedClient;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(message) || /(?:\+?20|0)1[0125]\d{8}/.test(message.replace(/[\s-]/g, ''))) {
    throw new Error('AI_SENSITIVE_DATA');
  }
  if (!config.AI_API_KEY && !injectedClient) throw new Error('AI_PROVIDER_UNAVAILABLE');
  const client = injectedClient ?? new OpenAI({
    apiKey: config.AI_API_KEY,
    timeout: 10_000,
    maxRetries: 1,
  });
  const moderation = await client.moderations.create({
    model: 'omni-moderation-latest',
    input: message,
  });
  if (moderation.results.some((result) => result.flagged)) throw new Error('AI_CONTENT_BLOCKED');
  const response = await client.responses.create({
    model: config.AI_MODEL,
    instructions: `${instructions}
سياق المستخدم المصرح به من المنصة:
${JSON.stringify(context)}
استخدم هذا السياق للتخصيص عند فائدته فقط. لا تذكر بيانات غير مطلوبة، ولا تدّعِ معرفة أي شيء غير موجود في السياق.`,
    input: message,
    max_output_tokens: 300,
    store: false,
  });
  const text = response.output_text?.trim();
  if (!text) throw new Error('AI_PROVIDER_EMPTY_RESPONSE');
  return text.slice(0, 2_000);
}
