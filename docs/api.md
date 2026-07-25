# API reference

Base URL: `/api`. Browser authentication uses the `yaa_session` HttpOnly, Secure-in-production, SameSite cookie. JSON errors expose a stable `code`; unexpected errors also include `requestId`.

## Authentication and privacy

- `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `POST /auth/request-email-verification`, `POST /auth/verify-email`
- `POST /auth/forgot-password`, `POST /auth/reset-password`
- `GET /account/sessions`, `DELETE /account/sessions/:id`
- `GET /account/export`, `DELETE /account`

Registration/reset passwords require 12+ characters with upper/lowercase, number, and symbol. Reset and OTP values are one-time, hashed at rest, expiring, and attempt-limited.

## Learning and assessment

- `POST /placement/submit`
- `GET /courses`, `GET /courses/:slug`, `GET /dashboard`
- `PUT /lessons/:lessonId/progress`
- `POST /quizzes/:quizId/submit`
- `POST /code/run`
- `POST /tutor/message`

Correct quiz choices never leave the server before submission. Code execution is local only in development and uses an authenticated isolated-runner adapter in production.

## Commerce

- `POST /checkout`
- `POST /payments/sandbox/:orderId` (development only)
- `POST /webhooks/:provider`
- `GET /account/orders`, `GET /account/orders/:orderId/invoice`
- `POST /finance/orders/:orderId/refunds`

Checkout/refund inputs require idempotency keys. External providers use the configured authenticated HTTP adapter. Webhooks require `x-event-id` and an HMAC `x-webhook-signature` over the exact raw body.

## Private uploads

- `POST /uploads/:purpose` — multipart purpose: `avatar`, `project_artifact`, `lesson_media`, or `lesson_download`
- `GET /account/uploads`
- `GET /uploads/:id`, `DELETE /uploads/:id`

Uploads enforce role, ownership, size, MIME allowlist, and file magic signature. Storage keys are never returned to clients.

## Parent, credentials, projects, and notifications

- `GET /parent/children`
- `GET /account/achievements`, `GET /account/certificates`
- `GET /certificates/verify/:code` (public)
- `POST /projects/:projectId/submissions`
- `PUT /submissions/:submissionId/grade`
- `GET /notifications`, `PUT /notifications/:id/read`
- `GET /notification-preferences`, `PUT /notification-preferences`

## Instructor and administration

- `GET /admin/students/at-risk`, `GET /admin/audit-logs`
- `POST /admin/courses`
- `PATCH|DELETE /admin/courses/:courseId`
- `POST /admin/courses/:courseId/publish`
- `GET /admin/courses/:courseId/preview`
- `POST /admin/courses/:courseId/modules`
- `PATCH|DELETE /admin/modules/:moduleId`
- `POST /admin/modules/:moduleId/lessons`
- `PATCH|DELETE /admin/lessons/:lessonId`
- `POST /admin/lessons/:lessonId/publish`
- `POST /admin/lessons/:lessonId/quizzes`
- `PATCH|DELETE /admin/quizzes/:quizId`
- `POST /admin/quizzes/:quizId/questions`
- `PATCH|DELETE /admin/questions/:questionId`

All admin operations pass through action-level RBAC. Published course/lesson content cannot be destructively deleted through the draft deletion endpoints.

The machine-readable contract is `docs/openapi.yaml`. Provider-specific request/response contracts are documented in the matching files under `docs/`.
