# Security notes

- Never use the demo authentication or local progress as an authorization boundary.
- Production must use secure, HttpOnly, SameSite cookies, CSRF defenses, rate limits, MFA for privileged roles, and server-side RBAC.
- Payment webhooks must be signed, timestamp-checked, and idempotent.
- Code execution must run in disposable, network-isolated sandboxes with CPU, memory, output, and time limits.
- AI tutor retrieval must be limited to published course content and must avoid giving direct graded-assessment answers.
- Store secrets in the deployment platform, never in `VITE_*` variables.
