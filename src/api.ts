const configuredApiUrl = import.meta.env.VITE_API_URL || '';
const localBrowserHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const configuredTargetsLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(configuredApiUrl);
const API_URL = configuredApiUrl && (!configuredTargetsLocalhost || localBrowserHost)
  ? configuredApiUrl
  : configuredTargetsLocalhost
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : '';

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !(options.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ code: 'NETWORK_ERROR', message: 'Request failed' })) as {
      code?: string; message?: string;
    };
    throw new ApiError(payload.code || 'REQUEST_ERROR', payload.message || 'Request failed', response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const academyApi = {
  register: (input: { fullName: string; email: string; password: string; acceptedTerms: true }) =>
    apiRequest<{ user: { id: string; fullName: string; email: string; role: string } }>('/auth/register', {
      method: 'POST', body: JSON.stringify(input),
    }),
  login: (input: { email: string; password: string }) =>
    apiRequest<{ user: { id: string; fullName: string; email: string; role: string } }>('/auth/login', {
      method: 'POST', body: JSON.stringify(input),
    }),
  me: () => apiRequest<{ user: { id: string; fullName: string; role: string } }>('/auth/me'),
  requestEmailVerification: () =>
    apiRequest<{ sent: boolean; alreadyVerified?: boolean; developmentOtp?: string }>('/auth/request-email-verification', { method: 'POST' }),
  verifyEmail: (otp: string) =>
    apiRequest<{ verified: boolean }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ otp }) }),
  forgotPassword: (email: string) =>
    apiRequest<{ accepted: boolean; developmentToken?: string }>('/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    apiRequest<{ reset: boolean }>('/auth/reset-password', {
      method: 'POST', body: JSON.stringify({ token, password }),
    }),
  dashboard: () => apiRequest<{ data: Array<{
    id: string; title: string; total_lessons: number; completed_lessons: number;
  }> }>('/dashboard'),
  courses: () => apiRequest<{ data: Array<{ id: string; title: string; price_minor: number; currency: string }> }>('/courses'),
  checkout: (courseId: string, idempotencyKey: string) =>
    apiRequest<{
      order: { id: string; status: string };
      provider: 'sandbox' | 'paymob' | 'stripe';
      checkoutUrl: string;
      providerReference?: string;
    }>('/checkout', {
      method: 'POST', body: JSON.stringify({ courseId, idempotencyKey }),
    }),
  sandboxPay: (orderId: string) =>
    apiRequest<{ status: string; enrollmentCreated: boolean }>(`/payments/sandbox/${orderId}`, { method: 'POST' }),
  orders: () => apiRequest<{ data: Array<{
    id: string; status: string; amountMinor: number; currency: string; createdAt?: string;
  }> }>('/account/orders'),
  runCode: (source: string, expectedOutput: string) =>
    apiRequest<{ data: { status: 'passed' | 'failed' | 'error' | 'timeout'; stdout: string; stderr: string } }>('/code/run', {
      method: 'POST', body: JSON.stringify({ source, expectedOutput }),
    }),
  submitPlacement: (answers: number[]) =>
    apiRequest<{ data: { score: number; level: string; recommendedPath: string } }>('/placement/submit', {
      method: 'POST', body: JSON.stringify({ answers }),
    }),
  tutorMessage: (message: string) =>
    apiRequest<{ data: { message: string; flagged: boolean } }>('/tutor/message', {
      method: 'POST', body: JSON.stringify({ message }),
    }),
  updateProgress: (lessonId: string, watchedSeconds: number, lastPositionSeconds: number) =>
    apiRequest<{ completed: boolean }>(`/lessons/${lessonId}/progress`, {
      method: 'PUT', body: JSON.stringify({ watchedSeconds, lastPositionSeconds }),
    }),
  submitQuiz: (quizId: string, answers: number[]) =>
    apiRequest<{ score: number; passed: boolean; feedback: Array<{ correct: boolean; explanation: string }> }>(
      `/quizzes/${quizId}/submit`, { method: 'POST', body: JSON.stringify({ answers }) },
    ),
  upload: (purpose: 'avatar' | 'project_artifact' | 'lesson_media' | 'lesson_download', file: File) => {
    const body = new FormData();
    body.append('file', file);
    return apiRequest<{ data: {
      id: string; filename: string; mimeType: string; sizeBytes: number; url: string;
    } }>(`/uploads/${purpose}`, { method: 'POST', body });
  },
  parentChildren: () => apiRequest<{ data: Array<{
    id: string; full_name: string; total_lessons: number; completed_lessons: number; watched_seconds: number;
  }> }>('/parent/children'),
  atRiskStudents: () => apiRequest<{ data: Array<{
    id: string; full_name: string; email: string; last_activity: string | null; completed_lessons: number;
  }> }>('/admin/students/at-risk'),
  notifications: () => apiRequest<{ data: Array<{
    id: string; type: string; title: string; body: string; read_at: string | null; created_at: string;
  }> }>('/notifications'),
  markNotificationRead: (id: string) =>
    apiRequest<void>(`/notifications/${id}/read`, { method: 'PUT' }),
  sessions: () => apiRequest<{ data: Array<{ id: string; expiresAt: string; current: boolean }> }>('/account/sessions'),
  revokeSession: (id: string) => apiRequest<void>(`/account/sessions/${id}`, { method: 'DELETE' }),
  exportAccount: () => apiRequest<Record<string, unknown>>('/account/export'),
  deleteAccount: (password: string) => apiRequest<void>('/account', {
    method: 'DELETE', body: JSON.stringify({ password, confirmation: 'DELETE' }),
  }),
};
