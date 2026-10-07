# F02 / F03 concurrency verification and minimal fixes

Date: 2026-10-07 (Asia/Saigon). **F02 CLOSED. F03 CLOSED. Locally verified.**

Only F02/F03 were investigated and fixed. Product code was changed only after both findings reproduced on real PostgreSQL. No deployment, migration, database reset or seed; no P1/P2 work. F01 edits and unrelated workspace changes were preserved.

## Test method and reproduction evidence

`backend/test/f02-f03-concurrency.e2e-spec.ts` runs the actual Nest services and Prisma queries against the existing disposable localhost PostgreSQL database. An instrumented Prisma client delegates every query/transaction unchanged, then pauses a chosen actual read with a promise barrier. No business result or PostgreSQL operation is mocked. Redis is stubbed in this service integration suite; the database and concurrency are real.

Command A is held at the barrier while command B executes. The coordinator waits for B to finish or for PostgreSQL `pg_blocking_pids(B)` to identify A as its blocker, then releases A. Transaction backend PIDs are obtained on their own connections. This verifies a real database lock wait, rather than inferring overlap from sleeps or `Promise.all` alone. Independent final database reads check the invariant; post-fix assertions also require one successful command, the existing conflict code, and exactly one success audit.

Fixtures use unique IDs and are removed only by this suite's scoped teardown. The first fixture attempt needed AVAILABLE Driver flags (`isOnline/isAvailable`) to satisfy an existing check constraint; this was corrected before F03 reproduction, without product changes.

Before product edits, all eight invariant assertions failed for the intended reasons: both commands succeeded and committed inconsistent state. Captured evidence is in ignored `test-results/f02-f03/before.log`, `before.json`, and `before-source-hashes.json`. Checkout base: `0f2d43c657248e3e9284dab016aa2d4fbc7b001a`; unrelated/F01 working-tree edits were already present.

## F02 — destination vs create transfer

**Reproduced YES. Invariant violated YES before fix. Fix required YES. Tests after fix PASS 2/2.**

Exact interleavings reproduced:

1. A `createTransfer` reads Shipment destination B, then pauses. B `routeDestination` observes no active transfer, changes destination B → C and commits. A resumes, validates its stale B snapshot and creates a PENDING transfer to B. Final committed state: Shipment destination C; active transfer destination B.
2. A `routeDestination` reads Shipment B and observes no active transfer, then pauses. B `createTransfer` creates and commits transfer to B. A resumes and changes destination to C. Transfer creation does not increment Shipment version, so the existing route CAS succeeds. The same inconsistency results.

Fix: both commands acquire `SELECT id FROM Shipment ... FOR UPDATE` inside their transaction before reading the destination/active-transfer state. Validation, writes and audit now share this boundary. Existing CAS, idempotency checks, lifecycle policy, response mapping and notification behavior are preserved.

| First command holding the lock | Second command after waiting | Final state |
|---|---|---|
| createTransfer to B | routeDestination C rejects `ACTIVE_TRANSFER_EXISTS` | Shipment B; one active transfer B |
| routeDestination C | createTransfer B rejects `TRANSFER_DESTINATION_MISMATCH` | Shipment C; no active transfer B |

Both fixed tests observed `POSTGRES_B_BLOCKED_BY_A`. Routing retry still avoids duplicate notification/audit; transfer retry still returns the existing record.

## F03 — Driver eligibility vs READY

**Reproduced YES. Invariant violated YES before fix. Fix required YES. Tests after fix PASS 6/6.**

All three Admin mutation paths reproduced: DriverProfile suspension (`DriversService.update`), Driver User suspension (`UsersService.setStatus`), and removal of LINE_HAUL (`DriversService.setCapabilities`). Each was tested in both orders:

1. A eligibility mutation checks executing trip count = 0 while the trip is PLANNED, then pauses. B `prepare` locks the Driver, reads the still-eligible profile/User, transitions the trip to READY and commits. A resumes, updates eligibility and commits. READY keeps a suspended Driver/User or a Driver without LINE_HAUL.
2. A `prepare` locks execution resources and rereads the eligible trip/Driver, then pauses. B eligibility mutation checks executing trip count = 0 and proceeds to its update, where PostgreSQL blocks on A's Driver lock. A resumes and commits READY. B's already-completed eligibility check is stale; its update then succeeds. READY again holds an ineligible Driver. `prepare` does not increment DriverProfile version, so the old Driver CAS does not prevent this race.

Fix: the three eligibility mutation paths use the existing `DriverTaskOwnershipService.lock` before eligibility/active-trip validation and mutation. User suspension rereads User + DriverProfile after acquiring the Driver lock. `prepare` already locks and rereads correctly, so no Line-haul service/policy code was changed. No new locking mechanism or duplicated business policy was added.

| Race | Eligibility mutation wins | prepare wins |
|---|---|---|
| prepare vs profile suspend | prepare rejects `LINE_HAUL_DRIVER_INACTIVE`; trip stays PLANNED | suspend rejects `DRIVER_HAS_ACTIVE_LINE_HAUL_TRIP`; READY Driver remains active |
| prepare vs User suspend | prepare rejects `LINE_HAUL_DRIVER_INACTIVE`; trip stays PLANNED | suspend rejects `DRIVER_HAS_ACTIVE_LINE_HAUL_TRIP`; READY User/Driver remain active |
| prepare vs remove LINE_HAUL | prepare rejects `LINE_HAUL_CAPABILITY_REQUIRED`; trip stays PLANNED | removal rejects `DRIVER_CAPABILITY_IN_USE`; READY Driver retains capability |

All six fixed tests observed `POSTGRES_B_BLOCKED_BY_A`, one winner and no losing-command success audit.

## Files changed in this task

- `backend/src/modules/warehouses/warehouses.service.ts`: transaction boundary and shared private Shipment lock for only routeDestination/createTransfer.
- `backend/src/modules/drivers/drivers.service.ts`: reuse Driver lock for suspension and capability changes.
- `backend/src/modules/users/users.service.ts`: Driver lock and reread before account suspension checks.
- `backend/src/modules/drivers/drivers.module.ts`, `backend/src/modules/users/users.module.ts`: import the existing exported Driver ownership service through AssignmentsModule.
- Corresponding `warehouses.service.spec.ts`, `drivers.service.spec.ts`, `users.service.spec.ts`: adapt transaction/dependency fixtures without removing business assertions. Transfer idempotency-key rejection now checks no transfer/audit write instead of requiring no transaction.
- `backend/test/f02-f03-concurrency.e2e-spec.ts`: eight deterministic PostgreSQL regression cases.
- `PROJECT_STATE.md` and this report: closure and evidence.

Invariants enforced: C01 backend authority, C09 idempotency, C10 concurrency/relational consistency, C18 regression tests. API routes, statuses, response contracts and business lifecycle rules are unchanged; races now reject the losing command with existing domain errors.

## Verification

| Check | Result |
|---|---|
| Before-fix invariant suite | Expected FAIL 8/8, both defects reproduced |
| Final PostgreSQL barrier suite | PASS 8/8: F02 2; F03 6 |
| Backend unit | PASS 515/515 across 60 suites |
| Warehouse transfer Phase 4 E2E | PASS 6/6 |
| Line-haul G1 E2E | PASS 6/6 |
| Line-haul G2 E2E | PASS 11/11 |
| Line-haul G3C2 schedule E2E | PASS 7/7 |
| Workspace lint | PASS |
| Workspace typecheck | PASS |
| Backend + frontend build | PASS |
| `git diff --check` | PASS |

Commands: `npm run test --workspace backend`; `npm run lint`; `npm run typecheck`; `npm run build`. PostgreSQL runner: `node test-results/f02-f03/run-e2e.mjs` and `--regression`; `--before` captured the pre-fix run. The ignored runner refuses a different container/port and reuses `p0_regression_1791224446659`; it contains no migration/reset/seed commands. Final results/logs: `test-results/f02-f03/after.{json,log}` and `regression.{json,log}`.

Validation environment: local Windows, Node 24.13.1, PostgreSQL 17 and dedicated local Redis. No Node 22 CI/staging/deployment verification is claimed. Existing non-blocking release-SHA and frontend chunk-size build warnings remain outside scope.

**Migration required: NO. F02 CLOSED. F03 CLOSED.**
