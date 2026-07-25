# Payment provider integration

The business flow is provider-neutral:

1. `POST /api/checkout` creates an idempotent order using the server-side course price.
2. The selected adapter creates the provider checkout session.
3. A signed webhook is verified before state changes.
4. The event ID is inserted into `webhook_events`; duplicate delivery returns success without repeating work.
5. One database transaction updates the order, inserts the payment, and creates the enrollment.

Production requirements:

- Store provider secrets only in the secret manager.
- Verify HMAC/signature and timestamp against the raw body.
- Allowlist provider network ranges only as defense in depth.
- Never trust amount, currency, course, or user identifiers from the browser.
- Refunds require `payment.refund`, an audit log, and provider confirmation.

Sandbox is intentionally enabled for local development. Set `PAYMENT_PROVIDER` to the approved adapter before production.
