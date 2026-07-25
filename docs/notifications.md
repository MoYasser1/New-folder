# Notifications

In-app notifications are stored separately from delivery jobs. Email, SMS, and WhatsApp use `notification_outbox`, allowing atomic business transactions without calling third parties inline.

Workers claim pending rows, increment attempts, and use exponential backoff. After the configured maximum, the row moves to `dead` and triggers an operational alert. Provider message IDs and sanitized errors should be attached without storing secrets.

Users can disable optional notification types per channel. Security alerts and payment receipts remain mandatory. Weekly learning digests should be preferred over multiple low-value messages.
