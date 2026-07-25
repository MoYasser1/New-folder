import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/password.js';

export type DevUser = {
  id: string; email: string; fullName: string; role: string; passwordHash: string; emailVerified: boolean;
  failedLoginAttempts: number; lockedUntil: number | null;
};
export const devUsers = new Map<string, DevUser>();
export const devSessions = new Map<string, { id: string; userId: string; expiresAt: number }>();
export const devAccountTokens = new Map<string, { userId: string; purpose: 'reset_password' | 'verify_email'; expiresAt: number; attempts: number }>();
export const DEV_COURSE_ID = '11111111-1111-4111-8111-111111111111';
export const DEV_MODULE_ID = '22222222-2222-4222-8222-222222222222';
export const DEV_LESSON_ID = '33333333-3333-4333-8333-333333333333';
export const DEV_QUIZ_ID = '44444444-4444-4444-8444-444444444444';
export const DEV_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
export const devOrders = new Map<string, {
  id: string; userId: string; courseId: string; status: string; amountMinor: number;
  currency: string; idempotencyKey: string;
}>();
export const devLessonProgress = new Map<string, {
  userId: string; lessonId: string; watchedSeconds: number; lastPositionSeconds: number; completed: boolean;
}>();
export const devQuizAttempts: Array<{ userId: string; quizId: string; answers: number[]; score: number; passed: boolean }> = [];
export const devWebhookEvents = new Set<string>();
export const devNotificationPreferences = new Map<string, { channel: string; notificationType: string; enabled: boolean }>();
export const devRefunds = new Map<string, { id: string; orderId: string; amountMinor: number; status: string; reason: string }>();
export type DevMediaAsset = {
  id: string; ownerId: string; purpose: string; filename: string; mimeType: string;
  sizeBytes: number; storageKey: string; createdAt: string;
};
export const devMediaAssets = new Map<string, DevMediaAsset>();
export const devCourses = new Map<string, {
  id: string; slug: string; title: string; description: string; instructorId: string;
  priceMinor: number; currency: string; status: string; publishedAt?: string;
}>();
export const devModules = new Map<string, {
  id: string; courseId: string; title: string; description: string; position: number;
}>();
export const devLessons = new Map<string, {
  id: string; moduleId: string; title: string; summary: string; transcript: string;
  durationSeconds: number; position: number; points: number; status: string;
}>();
export const devQuizzes = new Map<string, {
  id: string; lessonId: string; title: string; passingScore: number;
}>();
export const devQuestions = new Map<string, {
  id: string; quizId: string; prompt: string; choices: string[]; correctChoice: number;
  explanation: string; position: number;
}>();
export const devProjectSubmissions = new Map<string, {
  id: string; projectId: string; userId: string; repositoryUrl?: string; artifactUrl?: string;
  notes: string; status: string; score?: number; rubricResult?: Record<string, number>;
  feedback?: string; submittedAt: string; gradedAt?: string; gradedBy?: string;
}>();
export const devAuditLogs: Array<{
  id: string; actorId: string; action: string; resourceType: string; resourceId?: string;
  requestId: string; ipAddress: string; userAgent?: string; metadata: Record<string, unknown>; createdAt: string;
}> = [];

export async function initializeDevStore() {
  if (devUsers.size) return;
  const passwordHash = await hashPassword('Demo@2026!');
  for (const [email, fullName, role] of [
    ['student@yasser-ai.demo', 'محمد أحمد', 'student'],
    ['parent@yasser-ai.demo', 'ولي أمر محمد', 'parent'],
    ['instructor@yasser-ai.demo', 'م. محمد ياسر', 'instructor'],
    ['admin@yasser-ai.demo', 'مدير المنصة', 'super_admin'],
  ] as const) {
    devUsers.set(email, {
      id: randomUUID(), email, fullName, role, passwordHash, emailVerified: true,
      failedLoginAttempts: 0, lockedUntil: null,
    });
  }
}
