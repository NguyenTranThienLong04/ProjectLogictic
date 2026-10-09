# Backup and restore runbook

**F06 status, 2026-10-09: VERIFIED for an isolated local logical restore.** Managed-provider backup/PITR, retention, production credentials/roles and end-to-end recovery remain **DOCUMENTED ONLY**. No staging/production database was read, reset, seeded or restored during this task.

## Configuration audit

| Area | Repository evidence | Verified scope / gap |
| --- | --- | --- |
| PostgreSQL | Prisma schema, 28 immutable migrations, [checksum manifest](../backend/prisma/migrations.manifest.json), separate runtime/direct URL examples | Source of truth; restore must include data and migration history |
| Automated DB backup | No scheduled `pg_dump`, provider backup policy or retention configuration in `deploy/` / `.github/` | Provider control-plane configuration was not available or verified |
| Managed PITR | Required by [deployment runbook](DEPLOYMENT.md), not evidence of provisioning | Recovery window, last successful backup, retention, encryption/access and restore access need operator evidence |
| Redis | Local Compose uses AOF; deployment expects managed Redis | AOF is not a PostgreSQL backup. Use a separate empty Redis for a drill, with no live workers |
| Notifications | PostgreSQL `NotificationDelivery` outbox, retry/reconciliation | Preserve completed/skipped delivery markers. Restoring old state can replay external effects; SMTP must stay isolated until reconciled |
| Files | No binary upload/storage pipeline in this release | No object-store backup verified; external proof links cannot be recovered from the DB dump alone |
| CI artifacts | Failure diagnostics 7 days, optional published-image metadata 30 days | These are build/test artifacts, not business-data backup retention |
| RPO/RTO / incident owner | No confirmed environment-specific objectives or owner in repo | Operator must approve and record these before production readiness |

The local drill used PostgreSQL/pg_dump/pg_restore **17.11**, an existing synthetic CI database and a new container with `--network none`, no published ports and no API/worker process. This does not establish a backup schedule or provider recovery guarantee.

After verification, the source/tool containers and the new restore container were stopped; evidence and data were retained. A separate `logistics_demo` DB in the same isolated restore container was used only to validate the documentation's bootstrap SQL; the restored dataset was rechecked unchanged afterward.

## Backup policy to complete before promotion

The environment owner must record the following in the protected operations record: environment/project and database identity, backup owner/on-call, backup/PITR schedule and retention, approved RPO/RTO, last successful backup timestamp/ID, encryption and access policy, storage location, tested restore credentials/extensions, and drill evidence. Repository configuration alone does not prove provider settings.

Use protected direct DB credentials for an authorized backup; never copy pooled/runtime aliases into a restore target by guesswork. Keep secret connection values outside Git, logs and shell history, using protected service/password files or the secret manager. A logical dump covers one database; cluster roles/tablespaces and external services need separate inventory. A custom-format dump can be inspected and restored with `pg_restore`. [PostgreSQL 17 pg_dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html).

For an **authorized** source, the controlled backup job records UTC start/end, source identity, release SHA, migration manifest/history, tool/server versions, dump size and SHA-256. Validate archive readability and protect/encrypt the output. Do not put customer data in GitHub test artifacts. Alert on backup failure/staleness and periodically test restoration. No provider backup job is installed by this documentation change.

## Isolated local drill procedure

The following Bash procedure accepts an existing, trusted custom-format backup from a **disposable local** database. A provider backup may contain PII and executable schema objects; it requires separate authorized handling and review. This procedure never points a restore command at an existing DB URL and never uses `--clean` or `--create`.

1. Stop writers on the disposable source and collect a read-only baseline: exact table counts, stable row digests, migration names/checksums, schema definitions, extensions, constraints/indexes, sequence state, financial totals and pending/completed outbox counts. Record any empty domains; counts alone are insufficient.
2. Export locally, for example from the F07/F08 disposable source retained on the verification workstation (other workstations must use their own explicitly identified disposable source):

   ```sh
   set -euo pipefail
   docker exec logistics-f08-final-postgres pg_dump \
     -U ci -p 55432 -d i1_e2e --format=custom --file=/tmp/f06.dump
   mkdir -p test-results/restore-local
   docker cp logistics-f08-final-postgres:/tmp/f06.dump test-results/restore-local/source.dump
   sha256sum test-results/restore-local/source.dump
   ```

3. Create a uniquely named destination container and DB. Docker refuses a reused container name; do not replace/remove an existing container to get past that guard. Run this in a shell with `set -euo pipefail` so any failed command stops the procedure:

   ```sh
   set -euo pipefail
   drill_stamp=$(date -u +%Y%m%d%H%M%S)
   drill_container="logistics-restore-${drill_stamp}"
   drill_database="f06_restore_${drill_stamp}"
   docker run -d --name "$drill_container" --network none \
     -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=local-drill-only \
     -e POSTGRES_DB="$drill_database" postgres:17-alpine
   for attempt in $(seq 1 30); do
     if docker exec "$drill_container" pg_isready -U drill -d "$drill_database"; then break; fi
     sleep 1
   done
   docker exec "$drill_container" pg_isready -U drill -d "$drill_database"
   test "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$drill_container")" = none
   test "$(docker exec "$drill_container" psql -U drill -d "$drill_database" -Atc \
     "SELECT count(*) FROM pg_tables WHERE schemaname='public'")" = 0
   docker cp test-results/restore-local/source.dump "$drill_container":/tmp/source.dump
   docker exec "$drill_container" pg_restore --list /tmp/source.dump \
     > test-results/restore-local/archive-toc.txt
   docker exec "$drill_container" pg_restore --username=drill --dbname="$drill_database" \
     --no-owner --no-privileges --exit-on-error --single-transaction --verbose /tmp/source.dump \
     > test-results/restore-local/restore.stdout.log 2> test-results/restore-local/restore.stderr.log
   ```

   `--single-transaction` and `--exit-on-error` prevent a successful-looking partial restore. The drill intentionally maps ownership to its local role; real runtime grants/owners require a separate checked provisioning step before cutover. [PostgreSQL 17 pg_restore documentation](https://www.postgresql.org/docs/17/app-pgrestore.html).

4. Compare **all** public tables with the baseline, including `_prisma_migrations`, tracking/audit, assignment/attempt/transfer/trip history, COD/shipping-fee ledgers and `NotificationDelivery`. Verify manifest checksums and completion flags without editing history. Compare schema/extension/index/constraint and sequence definitions/state. Investigate every diff; do not discard CHECK or index definitions just to get a match.
5. Confirm zero unvalidated constraints and invalid indexes. A fresh full restore loads foreign keys after data and checks constraints; never disable triggers or skip failed objects. For representative financial fixtures, reconcile collected/remitted/settled/payout totals and foreign-key ownership before calling that domain verified.
6. Keep API/workers/SMTP/webhooks/GPS publishers off during DB-only validation. For a later authorized application drill, use a separate isolated app+Redis network, disabled email/payment/routing, blocked outbound delivery and local-only test credentials. Verify auth/ownership/readiness and read-only operational views before any controlled test mutation. The `EMAIL_DELIVERY_ENABLED=false` switch alone does not prevent realtime/outbox work.
7. Record restore duration separately from full recovery time. RTO includes provisioning, validation, secrets, application/worker checks and traffic cutover; RPO depends on backup/PITR age and reconciliation. Stop the specific drill container when done. Retain evidence per policy; do not run broad Docker prune or remove another environment's volumes.

## Managed recovery / cutover checklist — not executed

1. Incident owner freezes writes and workers/ingress, records the recovery timestamp, keeps the failed DB intact, and selects a known-good backup/PITR point and compatible release artifacts.
2. Provider restore creates a **new isolated DB/project/branch**. Verify source and target endpoint/project/database identities independently; a pooled and direct hostname may still address the same DB.
3. Isolate restored credentials, network and outbound integrations. Inventory extensions, roles/grants, connection limits and TLS; compare migration history against the matching release. Restore existing schema first, then plan any later additive migration separately.
4. Perform the data/schema checks above and reconcile any operations after the restore point: deliveries, cash receipts/remittances/payouts, shipping-fee payments, sent emails/notifications and external references. Rebuilding queue/cache does not reconstruct unpersisted GPS or re-deliver password-reset secrets automatically; users may need a fresh reset request.
5. Preserve outbox completed/skipped markers. Determine which pending intents may already have reached external recipients before allowing recovery workers to send them. Do not clear notification histories or blindly replay BullMQ queues.
6. Test the matching app against isolated PostgreSQL/Redis with outbound effects suppressed. Only after operator acceptance of integrity, RPO/RTO and reconciliation may credentials/traffic be switched in a separate authorized operation.
7. Observe health, queue backlog, errors and ledger totals. Keep the previous DB/artifacts for investigation and a reviewed fallback. Do not restore over the serving DB, down-migrate business history or use migration `resolve` to hide divergence.

## Drill evidence — 2026-10-09

| Check | Result |
| --- | --- |
| Source | `logistics-f08-final-postgres`, `i1_e2e`, synthetic regression leftovers; app/workers stopped |
| Destination | New `logistics-f06-restore-20261009`, DB `f06_restore_20261009`, initially 0 public tables, network none, no host ports |
| Backup | Custom format, 149042 bytes; SHA-256 `f318b2b528224f2ea8fe9a2ffa3d7576a54fe53b1256d30bf037e303af3185fd` |
| Restore | Exit 0; 515 ms command duration, completed `2026-10-09T05:04:05.527Z`; not end-to-end RTO |
| Data | 29 tables / 114 rows; 16 nonempty tables; every table's count and ordered row digest matched |
| History | All 28 migrations finished, none rolled back; checksum matches repository manifest |
| Integrity | 149 validated constraints; 0 invalid/unready indexes; extension/sequence inventories matched |
| Schema | Matched after removing random psql restrict markers/version comments and reviewing the sole DDL formatting difference: PostgreSQL flattened one redundant AND group in `LineHaulTripRoute_coordinates_check` |
| Business coverage | 14 shipments, 27 tracking events, one transfer/trip/manifest link, one notification/two outbox intents; COD tables empty |
| Excluded | Provider PITR/retention, representative COD balances, production roles/TLS/scale, binary/external storage, app/worker restart, traffic cutover and end-to-end RPO/RTO |

Ignored local evidence: `test-results/final-closure/verification.json`, `restore-result.json`, `restore.log`, `source-fingerprints.jsonl`, `restored-fingerprints.jsonl`, both schema dumps, `restored-migrations.jsonl`, archive TOC and the local synthetic-data dump. Row digests and Git ignore rules are not a substitute for encrypted backup storage. Raw backup contents are not committed.
