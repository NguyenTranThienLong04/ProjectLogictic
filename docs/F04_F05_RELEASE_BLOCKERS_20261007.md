# F04/F05 release blocker closure — 2026-10-07

**RELEASE BLOCKERS CLOSED — local verification, single backend instance.** No commit, push, deployment, staging database write, reset/seed or F06–F09 work. This report supersedes the initial F04/F05 policy and its earlier release-review blockers. Base/HEAD remains `0f2d43c657248e3e9284dab016aa2d4fbc7b001a`; a release SHA will exist only after a separately requested commit. Local build metadata correctly remains `unknown`.

## F04 realtime completion: PASS

Root cause: `emitToRoom` and authorization revalidation swallowed infrastructure errors, so the worker treated a failed attempt as success. Gateway absence also returned success without an attempt. Four added regression cases failed against the original implementation before the product fix.

Durable `emitNotification` now requires a usable gateway and propagates fetchSockets, authorization-database, socket join/emit and other infrastructure errors. Worker failure leaves `completedAt` null, persists a redacted/bounded `lastError`, and rethrows to BullMQ. A producer queue acknowledgement no longer clears a worker error; successful completion clears it. BullMQ retains five attempts and exponential 1-second backoff; PostgreSQL reconciliation retains its bounded 10-second to 5-minute backoff and stable queue identity.

Success means an attempt to the current authorized online sockets completed without an infrastructure exception. Empty/offline rooms remain successful attempts, relying on the durable Notification Center on reconnect. Revoked, suspended, expired or otherwise invalid sessions are disconnected and skipped; they are not a retryable infrastructure error. This is at-least-once attempt delivery, not proof of client receipt or exactly-once SMTP/socket delivery. A crash after an external effect but before acknowledgement may repeat it.

Gateway audit covered `revalidate`, `emitToRoom`, assignment/shipment invalidation, Driver GPS, line-haul GPS/route/deviation/end broadcasts and subscription paths. The authorization-database swallow on the durable notification path shared this root cause and is fixed. Other broadcasts are disposable post-commit invalidations without durable intents; their existing best-effort behavior remains to avoid rejecting already-committed business commands. No Redis Socket.IO adapter or unrelated lifecycle change was added.

Evidence: gateway unit coverage includes success, empty room, adapter failure, authorization DB failure, emit failure, revoked session and missing gateway. The PostgreSQL/real BullMQ suite uses the actual gateway/worker with an injected failing socket adapter. Both reconciliation and restart cases observe five failed attempts, pending intent with lastError, unchanged readable Notification, exactly two durable channel intents after duplicate creation, then a sixth successful attempt/completion and no effect on completed replay. Existing Phase 8 authenticates a real Socket.IO client and verifies notification delivery.

## F04 historical email policy: PASS; blast risk NO under the cutover below

Historical means a Notification tagged by the original outbox backfill with the REALTIME intent's `LEGACY_REALTIME` marker. No guessed clock cutoff is used. New backend creation atomically inserts both intents and does not set that marker.

| Record | Final policy after both migrations |
|---|---|
| Historical realtime | Remains completed with `LEGACY_REALTIME`; no replay |
| Historical email already sent | Existing completion/emailSentAt retained |
| Historical email unsent | EMAIL intent completed with `LEGACY_EMAIL`; no send, including with SMTP enabled |
| New backend notification | Both intents created atomically; normal eligibility, retry and SMTP-enabled/disabled semantics |

Notification content, read state, `emailSentAt`, `emailMessageId` and business history are not rewritten. A skip marker is not represented as an actual sent email. The correction touches only unfinished historical EMAIL intents, preserving already completed deliveries and new backend intents on installations where the original F04 migration was applied earlier.

The original `20261007120000_notification_delivery_outbox` migration had already been applied to local review databases. Its bytes/checksum remain `63958af5056d890960942af346034e7729e25ce0546ec5b58c3bb78a2d21f196`. Instead of rewriting it, this release appends `20261007180000_notification_historical_email_cutover` (`1490a77667b28874b44f0d634ab56f9646e1ea890b555592c9289ebeacffa81a`). The manifest contains 28 files; previously applied migrations are unchanged.

`backend/scripts/verify-notification-cutover.mjs` performs real Prisma deploy on a new empty local DB: baseline 26 migrations → 120 unsent + one sent historical Notification fixtures → unchanged original F04 → new-backend intent fixture → correction → repeated deploy. All 120 historical emails are skipped and produce **zero sends with an enabled test sender**; the sent timestamp is preserved; all original Notification columns match; two new-backend notifications each retain two intents and produce one send/emit despite replay. This is local test-fixture evidence, not a staging mutation or live SMTP acceptance claim.

## F05 backward compatibility: PASS

One contract: `page` defaults to 1; `limit` defaults to 100 and accepts 1–100. Requests without pagination therefore retain the legacy latest-100 behavior. `?page=2` uses the same 100-item window; `?page=1&limit=20` and later 20-item pages remain supported. The current frontend already sends page/limit=20 and requires no product change for this blocker.

Ordering remains `createdAt DESC, id DESC`. Existing items/summary and additive pagination metadata stay in the same response envelope. Summary covers the complete authorized dataset independently of list filters/page. Driver ownership, Admin-only payout filters, RBAC and all COD mutation commands are unchanged.

PostgreSQL/HTTP evidence: 105 owned records plus seven other-driver records, deliberately equal timestamps. Both roles' legacy requests return exactly the expected first 100, and page 2 returns the tail. Explicit 20-item pages return every authorized ID in order without duplicates/gaps and keep identical summaries. Existing 50/50/5, status/payout filters, negative roles, wrong owner and record-105 remit/confirm/settle/payout/customer receipt pass. The first new assertion accidentally expected insertion order for the seven other-driver UUIDs; it was corrected to the documented ID-descending ordering, with no product change or removed assertion.

## Operational constraint and runbook

**Exactly one backend application instance with its integrated workers.** Do not run a separate worker replica, cluster workers or overlap old/new backends during a rolling deployment. Socket.IO rooms remain process-local. Concurrent reconciler tests exercise queue/intents only and are not a multi-instance delivery safety claim.

For a later separately authorized deployment:

1. Verify the committed release SHA, migration manifest and target's read-only migration history. Existing staging H2/H3 exceptions retain their exact audited scope; never repair checksums/ledger. Stop old notification writers and workers and account for in-flight work. Do not start recovery workers between the two F04 migrations.
2. Run the complete `migrate deploy` chain through `20261007180000_notification_historical_email_cutover`. If any migration fails, keep workers stopped. Verify 28 applied migrations and zero unfinished EMAIL intents whose sibling REALTIME intent is tagged `LEGACY_REALTIME`.
3. Start one new backend. Verify health/release identity, new notifications' two atomic intents, recovery, unread ownership, legacy COD requests and explicit pages. Historical email replay is disabled by persisted completion even if SMTP is enabled.
4. For rollback, stop writers/workers first and retain additive schema, completed historical skips and the migration ledger. Prefer a forward fix. A binary rollback to the baseline reopens F01–F03 and produces notifications without outbox intents, so do not resume affected traffic without a reviewed recovery plan. Never undo the historical skips to replay old email.

## Verification

| Gate | Result |
|---|---|
| Migration integrity unit | PASS 14/14 |
| Canonical migration/Git baseline | PASS 28 files |
| Clean DB migrate deploy, repeat deploy, ledger, schema parity | PASS |
| Real migration historical-email cutover/upgrade regression | PASS |
| F01–F05 focused backend unit, including gateway | PASS 120/120 |
| F02/F03 PostgreSQL barriers | PASS 8/8 |
| F04 PostgreSQL/Redis recovery | PASS 10/10 |
| F05 PostgreSQL/HTTP >100 and legacy compatibility | PASS 4/4 |
| Phase 5 return/privacy | PASS 1/1 |
| Phase 8 authenticated Socket/notification regression | PASS 3/3 |
| Phase 7 COD actions | PASS 6/6 |
| COD pagination browser | PASS 375/768/1440px |
| COD action browser regression | PASS 375×812, 812×375, 768×1024, 1440×900 |
| Workspace lint/typecheck/build | PASS |
| Diff check | PASS |

Commands: `node --test backend/scripts/migration-integrity.test.mjs`; `node backend/scripts/migration-integrity.mjs` with the full base SHA; Prisma `migrate deploy` twice plus `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`; `node backend/scripts/verify-notification-cutover.mjs` after build with an explicit empty local `AUDIT_DATABASE_URL`; backend Jest targeted unit/E2E suites; `node frontend/test/cod-pagination.mjs`; `node frontend/test/cod-ux.mjs`; `npm run lint`; `npm run typecheck`; `npm run build`; `git diff --check`.

Local Windows/Node 24.13.1/PostgreSQL 17/Redis 7.4. Target-platform Node 22 CI and process-kill deployment testing are not claimed. Existing build warnings are unknown uncommitted release SHA and chunk size. Sandbox subprocess failures were rerun with approval. Guarded runner/logs/results are ignored under `test-results/f04-f05-blockers/`; local test DBs are `p0_regression_1791381887442` and `release_cutover_1791381887442`. No staging connection was used for these fixes/tests.

## Exact files ready for the release commit

The release index includes the files below. PROJECT_STATE is staged only for F01–F05 paragraphs. Four pre-existing untracked Control Tower reports and their unrelated PROJECT_STATE paragraphs remain in the working tree outside the release index. No unrelated product diff was found. No commit/push has been made.

```text
PROJECT_STATE.md
backend/prisma/migrations.manifest.json
backend/prisma/migrations/20261007120000_notification_delivery_outbox/migration.sql
backend/prisma/migrations/20261007180000_notification_historical_email_cutover/migration.sql
backend/prisma/schema.prisma
backend/scripts/migration-integrity.test.mjs
backend/scripts/verify-notification-cutover.mjs
backend/src/modules/assignments/delivery.service.spec.ts
backend/src/modules/assignments/delivery.service.ts
backend/src/modules/assignments/driver-deliveries.controller.ts
backend/src/modules/cod/cod.controller.ts
backend/src/modules/cod/cod.service.spec.ts
backend/src/modules/cod/cod.service.ts
backend/src/modules/cod/dto/list-cod.dto.ts
backend/src/modules/drivers/drivers.module.ts
backend/src/modules/drivers/drivers.service.spec.ts
backend/src/modules/drivers/drivers.service.ts
backend/src/modules/notifications/notification-jobs.service.spec.ts
backend/src/modules/notifications/notification-jobs.service.ts
backend/src/modules/notifications/notifications.gateway.spec.ts
backend/src/modules/notifications/notifications.gateway.ts
backend/src/modules/notifications/notifications.service.ts
backend/src/modules/users/users.module.ts
backend/src/modules/users/users.service.spec.ts
backend/src/modules/users/users.service.ts
backend/src/modules/warehouses/warehouses.service.spec.ts
backend/src/modules/warehouses/warehouses.service.ts
backend/test/f02-f03-concurrency.e2e-spec.ts
backend/test/f04-notification-recovery.e2e-spec.ts
backend/test/f05-cod-pagination.e2e-spec.ts
backend/test/phase5.e2e-spec.ts
backend/test/phase8.e2e-spec.ts
docs/F01_START_RETURN_PRIVACY_20261007.md
docs/F02_F03_CONCURRENCY_20261007.md
docs/F04_F05_P1_HARDENING_20261007.md
docs/F04_F05_RELEASE_BLOCKERS_20261007.md
frontend/src/features/cod/cod-api.ts
frontend/src/features/cod/cod-dashboard-page.tsx
frontend/test/cod-pagination.mjs
frontend/test/cod-ux.mjs
```
