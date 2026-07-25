# Master prompt implementation matrix

Evidence is based on the current repository and automated commands, not intended future work.

| Area | Status | Evidence / remaining gate |
|---|---|---|
| Arabic RTL responsive public experience | Implemented | `src/App.tsx`, `src/styles.css`, desktop/mobile E2E |
| Placement → registration → checkout → onboarding | Implemented locally | API integration and Playwright flows; real payment provider remains external |
| Authentication, sessions, reset, email OTP, device revocation | Implemented | Hashed one-time tokens, expiry/attempt limits, provider adapter, security/integration/browser tests |
| Guardian consent / age policy / phone login | Not implemented | Legal age policy and verified guardian workflow require product/legal decisions and schema/UI work |
| RBAC roles and action permissions | Implemented core | Server middleware and broken-access-control tests |
| PostgreSQL schema, migration, seed | Implemented and schema-tested | Transactional checksum migrations pass against PGlite; Docker/PostgreSQL 17 target drill remains |
| Catalog, modules, lessons, publishing | Implemented | Public APIs, complete CRUD, safe draft deletion, preview, publishing, questions and audit log |
| Progress and server-side quiz grading | Implemented | Learning API; target PostgreSQL integration remains |
| Python exercises | Adapter implemented | Restricted local runner plus authenticated remote sandbox adapter and tests; live remote provider remains |
| Orders, sandbox payments, invoices, refunds, signed webhooks | Implemented core | Idempotent order/payment/enrollment/refund flows and replay tests; real provider adapter remains external |
| Paymob/Stripe | HTTP adapter implemented | Authenticated checkout/refund adapter with bounded validated responses; provider account and credentials required |
| Plans, subscriptions, coupons, product catalog | Not implemented | Current sale is a single-course order; recurring billing and coupon rules remain |
| Student dashboard | Implemented | Responsive UI and E2E |
| Parent portal | Implemented core | Linked-child progress API and UI |
| Instructor/admin portal | Implemented core | At-risk students, course/module/lesson publishing, UI summary |
| HLS video, chapters, notes, bookmarks, in-video questions | Not implemented | Private media upload exists, but production player and video analytics require a video provider |
| Discussions, moderation, and support tickets | Not implemented | No fake UI is exposed; APIs, retention/moderation policy, and operational workflow remain |
| Cohorts, live sessions, attendance, CMS, feature flags | Not implemented | Administrative expansion remains beyond the current core portal |
| Notifications/preferences/outbox | Implemented core | In-app API, preferences, retry/dead-letter schema; delivery provider required |
| AI tutor guardrails | Adapter implemented | OpenAI Responses + moderation, PII/anti-cheating guards and adapter tests; live key/quota/RAG remain |
| Course-grounded RAG and tutor retention/review | Not implemented | Current tutor has strong system guardrails but is not yet grounded in indexed course content |
| Projects and rubric grading | Implemented core | Submission, review, revision request, rubric and grading APIs |
| Achievements and verifiable certificates | Implemented core | Tables and public verification API |
| Certificate PDF/QR issuance workflow | Not implemented | Public verification exists; document generation and revocation UI remain |
| SEO | Implemented SPA baseline | Metadata, canonical, robots, sitemap, manifest; dynamic course SEO needs SSR |
| Accessibility/responsiveness | Tested baseline | axe WCAG A/AA critical/serious scans, RTL semantics and no-overflow desktop/mobile E2E |
| Security | Tested baseline | Headers, redaction, rate limits, password hashing, CORS, RBAC, webhook replay |
| CI/CD | Implemented | `.github/workflows/ci.yml`, web/API container builds and all test gates |
| Docker development stack | Implemented, unverified locally | Web, API, PostgreSQL, Redis; Docker is not installed on this host |
| Monitoring/backups/restore | Documented only | Must be configured and drilled on target platform |
| Background jobs / Redis queue | Not implemented | Notification outbox schema exists, but no worker is claimed or deployed |
| Real video/object storage | Adapter implemented | Authenticated HTTP provider, private access, ownership, type/signature/size validation; live CDN credentials remain |
| Transactional email / OTP delivery | Adapter implemented | Development and authenticated HTTP providers; production provider credentials/templates required |
| Production deployment | Not performed | Domain, hosting, secrets, providers, TLS, monitoring, backups required |

## Current automated evidence

- Unit/integration/security tests: 44 passing at the final full run.
- Browser E2E: 26 expected across desktop and mobile Chromium; rerun is required for each release.
- Strict frontend and API builds: passing.
- Dependency audit: 0 known vulnerabilities at the last run.

This matrix intentionally does not label external or unexecuted gates as complete.
