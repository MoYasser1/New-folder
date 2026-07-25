# Production readiness evidence

## Automated gates

- `npm run lint` — TypeScript/React/API lint.
- `npm run test` — 44 password, authentication, session-isolated rate limiting, privacy, production config, placement, CRUD, uploads/storage, checkout/refunds, provider adapters, notifications, tutor, runner, migration, RBAC, CORS, and webhook tests.
- `npm run test:e2e` — 26 functional, responsive, and WCAG A/AA checks on desktop and mobile Chromium.
- `npm run build` and `npm run build:api` — strict TypeScript production builds.
- `npm audit --audit-level=high` — dependency vulnerability gate.

## Deployment gates requiring the target environment

- PostgreSQL 17 migration and restore drill (the full schema is additionally exercised with PGlite in CI).
- Redis persistence/failover test.
- Real provider sandbox payment and signed webhook.
- Email/OTP deliverability and bounce handling.
- Object storage signed URL expiry.
- OpenAI generation/moderation live smoke test, quotas, and retention policy.
- HTTPS, CSP tailored to the final domain, uptime/error monitoring, backups, and alerts.

The application must not be labelled production-ready until every target-environment gate is evidenced.

## Product-scope gates from the master prompt

The current build is a strong core release, not the entire master-prompt product. Production launch scope must either implement or explicitly defer with stakeholder approval: guardian consent/age policy, subscriptions/plans/coupons, HLS player and notes/bookmarks, discussions/support, cohorts/live attendance, CMS/feature flags, course-grounded RAG, and certificate PDF/QR issuance. See `requirements-matrix.md`.
