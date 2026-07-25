# Production deployment

1. Provision PostgreSQL 17+, an HTTPS domain, object storage, email delivery, an isolated code runner, OpenAI access when enabled, and a supported payment provider.
2. Generate `SESSION_SECRET` and `PAYMENT_WEBHOOK_SECRET` with at least 32 random bytes in the platform secret manager.
3. Set `NODE_ENV=production`, exact `WEB_ORIGIN`, provider credentials, and a TLS-enforced `DATABASE_URL`.
   Build the web image with `VITE_PAYMENT_MODE=provider` (the production Dockerfile default) and same-origin `VITE_API_URL` unless the API is deliberately hosted on another allowed origin.
4. Run `npm run db:migrate` as a one-off release job before switching traffic. Migrations are ordered, transactional, checksum-verified, and protected with an advisory lock.
5. Deploy `server.Dockerfile`, then the web `Dockerfile`. Confirm `/health/ready`.
6. Keep `SEED_DEMO_DATA=false` in production. Seed only development/staging.
7. Configure daily database backups, point-in-time recovery, error monitoring, uptime checks, and alerting on webhook failures.

Rollback uses the previous immutable web/API images. Database migrations must remain backward compatible for at least one release.
