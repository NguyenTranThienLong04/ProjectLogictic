# Reset staging, keep the sole ADMIN

Run from repository root. No dependency installation, migration command, DDL,
seed, migration-history write, or production target is involved.

Before use, independently verify the deployed staging PostgreSQL endpoint/database,
Redis endpoint/database and API binding in the hosting provider. A filename or
`NODE_ENV=production` is not evidence of the deployment environment. Redis must
be dedicated to this app's staging environment; shared Redis is refused because
existing app keys do not provide reliable cross-environment isolation.

Create a local, untracked target JSON outside version control with these fields:

```json
{
  "environment": "staging",
  "verifiedBy": "operator name",
  "evidence": "provider project/branch and deployment binding reference",
  "database": "verified-direct-host:5432/database-name",
  "redis": "verified-redis-host:6379/0",
  "redisDedicated": true,
  "adminEmail": "current-admin@example.test",
  "apiBase": "https://verified-staging-host/api/v1",
  "writersStopped": false
}
```

Provide an explicit env file containing DATABASE_URL, DIRECT_URL (TLS),
and REDIS_URL (rediss). The script never falls back to root .env or prints credentials.

```powershell
node backend/scripts/reset-staging-data.mjs <env-file> <target-json>
```

Review dry-run counts, ADMIN identity and FK order. When multiple ADMINs exist,
execution requires the exact independently verified `adminEmail`, `keepAdminId`
and `deleteOtherAdmins=true`; no automatic selection is made. Copy the dry-run
`before` object, `migrationFingerprint` and `playingWithNeon` count into
`expectedBefore`, `migrationFingerprint` and `expectedSampleRows` respectively.
Any DB count/history change between dry run and execution aborts before deletion.
Stop staging mutations, workers, schedulers and simulation where possible; keep
a controlled API instance for the final health/login probe. Set writersStopped=true
only after doing this. If running with live staging writers, set
liveResetAccepted=true explicitly, and rely on post-commit checks to detect new
data. PostgreSQL locks cannot stop workers from recreating data after commit.

Set ALLOW_STAGING_RESET=true and RESET_CONFIRM=RESET_STAGING_KEEP_ADMIN in the
invoking process environment to execute the same command. Neither flag is loaded
from the env file. For a real login check, supply RESET_ADMIN_PASSWORD securely in
the process environment (never a command literal, checked-in file, or chat).
Absent a password, login is reported NOT_TESTED and exit status is nonzero.

The script preserves the entire ADMIN row and its AuthSession/PasswordResetToken
rows. All other model rows are deleted in FK order, with currentRouteId nulled
inside the same transaction. All migration rows are fingerprinted before/after.
The exact Neon sample table `playing_with_neon` is preserved with its data and
schema. All other unknown tables or cross-schema FKs abort. All keys in the verified dedicated Redis
database are scanned and unlinked, without FLUSHALL/FLUSHDB. Key names/payloads
are never printed. Login may create a new ADMIN session and fresh rate-limit keys.

PostgreSQL and Redis cannot commit atomically. A Redis/probe failure after DB
commit is reported as databaseCommitted=true; do not interpret it as rollback.
Keep writers stopped, fix the cause, review another dry run, then rerun if needed.
Do not resume writers until counts, migration history, Redis and auth checks pass.

Guard/schema tests: `node --test backend/scripts/reset-staging-data.test.mjs`.
These tests do not constitute live staging execution or database integration proof.
