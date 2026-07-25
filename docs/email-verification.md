# Email verification

Registration creates an unverified account and HttpOnly session. Checkout is blocked until the account consumes a six-digit one-time code.

Codes are stored only as SHA-256 hashes, expire after ten minutes, are single-use, and accept at most five failed attempts. Code requests are limited to three per fifteen minutes.

## Providers

- `EMAIL_PROVIDER=development` returns the code to the local UI and is forbidden in production.
- `EMAIL_PROVIDER=http` sends an authenticated JSON request to `EMAIL_PROVIDER_URL`; set `EMAIL_PROVIDER_TOKEN`.
- `EMAIL_PROVIDER=disabled` rejects delivery.

The HTTP payload contains `to`, `template`, and `variables`. The provider must return a successful HTTP status and may return `{ "id": "provider-message-id" }`.

Production deployment must configure provider credentials, verified sender domains, localized templates, bounce handling, and delivery monitoring.
