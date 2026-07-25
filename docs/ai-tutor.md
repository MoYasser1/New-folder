# AI Tutor

The tutor endpoint is `POST /api/tutor/message` and requires an authenticated session.

Guardrails:

- Per-user rate limit.
- Maximum message length.
- Direct requests for graded answers receive Socratic prompts rather than answers.
- Messages and flagged requests are auditable in PostgreSQL.
- The local deterministic provider is the default and requires no external secret.
- Production AI integration is selected through `AI_PROVIDER`; API keys remain server-side.

Before enabling an external provider, add retrieval restricted to published lessons, moderation, usage quotas, deletion/retention controls, and teacher-visible escalation.
