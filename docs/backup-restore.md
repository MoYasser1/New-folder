# PostgreSQL backup and restore

Production must use encrypted provider snapshots plus a portable logical backup.

Backup example:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > academy.dump
```

Restore drill into an empty database:

```bash
createdb academy_restore_test
pg_restore --exit-on-error --clean --if-exists --no-owner --dbname=academy_restore_test academy.dump
psql "$RESTORE_DATABASE_URL" -c "select count(*) from users"
psql "$RESTORE_DATABASE_URL" -c "select count(*) from orders"
```

Run restore drills at least quarterly. Record recovery point and recovery time results. Never test destructive restore commands against the production connection string.
