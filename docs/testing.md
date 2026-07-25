# Testing

## Local and CI gates

```bash
npm run check
npm run test:e2e
npm audit --audit-level=high
```

`npm run check` runs ESLint, 44 Vitest tests, the strict frontend build, and the strict API build. Tests cover production fail-closed configuration, password hashing and strength, sessions and isolated rate limits, lockout, OTP/reset replay, privacy export/deletion, CRUD/publishing, progress and server-side grading, projects, uploads/storage and forged signatures, checkout/refunds/webhooks, provider adapters, notification preferences, RBAC/CORS, migration constraints, AI moderation/PII, and bounded code execution.

Playwright runs 26 checks across desktop Chromium and Pixel 7 emulation. It covers the visitor funnel, login, lesson/quiz/code, email verification and checkout, parent/instructor portals, upload, privacy export, notifications, forgotten password, RTL/no-overflow, keyboard CTA, and axe WCAG A/AA critical/serious scans.

## Release-environment gates

Automated local tests do not replace:

- PostgreSQL 17 migration, concurrency, backup, and restore drills.
- Real provider sandbox checkout/refund/webhook tests.
- Email deliverability and object-storage signed URL expiry checks.
- Live OpenAI moderation/generation quota and retention checks.
- Remote runner escape/resource-limit testing.
- Load testing, TLS/domain validation, monitoring, and alert exercises.
