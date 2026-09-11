# Phase I1 — Final Production Readiness Audit

Audit date: **2026-09-09**. Scope: existing A→H3 only. **Application verification PASS; production release BLOCKER.** No production deployment, production migration, provider selection, new feature or dependency was performed.

## Verification evidence

| Check | Result | Evidence / limit |
|---|---|---|
| Backend unit | PASS | 240 tests, 48 suites |
| Frontend model/unit | PASS | 32 tests, including transient cross-tab auth and loopback URL regression |
| All backend E2E | PASS | 76 tests across all 21 suites, sequential isolated PostgreSQL + Redis; no skipped suite |
| Full Playwright | PASS | 8/8 Chromium journeys, retries disabled; F, G3A/G3B2, G3C1/C2/C3, H1/H2/H3 |
| Lint + typecheck | PASS | Both workspaces |
| Production builds | PASS | `backend/dist/main.js`; Vite same-origin API/socket and REAL GPS build |
| Production artifact smoke | PASS | Actual compiled Nest process, `NODE_ENV=production`, real local PostgreSQL/Redis, both providers DISABLED |
| Prisma schema validate | PASS | Prisma 7.9.1 schema validation |
| SQL migration replay/shadow | PASS after fixes | Exactly 25 migrations replayed independently into two empty PostgreSQL 17 databases; columns, constraints, indexes and enums match |
| Development migration history | BLOCKER | 25 successful migrations; 23 matching checksums, H2/H3 checksum mismatches; zero unresolved failures/unknown migration rows. Read-only inspection, no history repair |
| Prisma deploy/status/schema drift | BLOCKER | Windows Application Control blocks `schema-engine-windows.exe`, including outside sandbox. Native SQL replay and Prisma schema validation are not substitutes for this release gate |
| Shadow safety | PASS | Optional `SHADOW_DATABASE_URL` uses Prisma 7 config; validation rejects same runtime/direct database, including Neon pooled host alias |
| Dependency audit | PASS | `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities in the current feed; no forced update/downgrade |
| Secrets/config scan | PASS within scan scope | 687 workspace paths and all 7 reachable Git revisions: 0 findings for tracked env/private-key/token/Neon credential patterns. `.env` is ignored; no real secret was added |
| Dead-file/debug review | PASS within scan scope | All 193 backend and 146 frontend product TS files reachable from entrypoints; no C05-protected history hard-delete, debug mutation endpoint or production simulation control found. This is not proof that every unused symbol is absent |
| Production frontend bundle scan | PASS | No development simulator label, localhost:3000 URL or test webhook secret marker in generated assets |
| `git diff --check` | PASS | Includes pre-existing tracked working-tree changes; no whitespace errors |

Logs are local ignored artifacts: `test-i1-unit.log`, `test-i1-e2e.log`, `test-i1-browser.log`, `test-i1-build.log`, `test-i1-production-smoke.log`, `test-i1-replay.log`, `test-i1-history.log`, `test-i1-prisma-validate.log`, `test-i1-secrets.log`; dependency JSON is in `test-results/i1/`. Playwright HTML report is in `playwright-report/`. These test files/logs are not release assets. A machine/Docker interruption required restarting the disposable containers and rerunning the final browser suite; the PASS above is the completed final run.

## Defects and regression fixes

| ID | Root Cause | Broken Invariant | Correct Fix | Regression Test |
|---|---|---|---|---|
| I1-01 | H2/H3 add enum values and reference them in CHECK constraints in the same SQL migration transaction. Fresh replay fails with PostgreSQL unsafe enum use | C10, C18: repeatable migration/data-integrity gate | Commit the enum-addition phase explicitly before dependent DDL. Only transaction boundaries changed; 25 migration directories retained | Fresh replay originally fails at H2; after fix all 25 pass twice with matching catalogs. H1/H2/H3 E2E pass. Existing development checksums are explicitly blocked pending controlled reconciliation |
| I1-02 | Gateway authenticates only on connection; revoked/suspended sessions and stale room scope may keep receiving events | C04, C11, C15 | Revalidate JWT/session/user and current resource scope before subscriptions and each room delivery; evict/disconnect invalid clients, fail closed on auth-read failure. Await line-haul GPS/ended publication to preserve ordering against arrival | Revocation, suspension, warehouse-scope change and DB failure unit cases; production logout→socket subscription rejection; real Redis/Socket E2E and G3A Playwright |
| I1-03 | Refresh cookie shared by tabs but access-token state isolated; refreshed sessions revoke old socket tokens, causing repeated cross-tab rotations. The API interceptor also catches a retried business 409 as a refresh failure and clears a valid session | C04, C09, C11: secure rotation/reconnect must remain usable | Transient BroadcastChannel propagates session/logout, Web Locks serialize refresh when available, and HTTP/socket retry reuses a newer current token before rotating again. Only actual refresh failures clear the session; retried business errors propagate without logout. No token persistence | Two-tab session/logout unit test; G3A multi-page authenticated map/detail/reroute journey; F rotates the cookie then verifies a delivered-shipment cancellation 409 preserves authentication |
| I1-04 | Redis PTTL milliseconds returned as Nest throttler response seconds | Security/rate-limit contract, C18 | Convert TTLs to rounded-up seconds; leave atomic counter/block durations in milliseconds | Unit 60,000ms→60s; actual production 429 `Retry-After <= 60`, spoofed forwarding headers cannot avoid limits |
| I1-05 | Frontend production URL check compares IPv6 hostname to `::1`, while URL parser returns `[::1]` | Production config/no-core-localhost requirement | Reject IPv6 loopback, 127/8, `.localhost` and unspecified IPv4 hosts | Production URL model tests and same-origin production build |
| I1-06 | Leaflet zoom-transition callback can run after React removes the map | UI lifecycle correctness, C18 | Disable queued map zoom/fade/marker animations; fit/setView without animation for realtime updates | G3A map navigation/reroute/arrival flow and page-error assertion; final browser run has no observed Leaflet lifecycle exception |
| I1-07 | Old E2E fixture/expectations lag H1 ledger/collection and G3B1 metrics; browser board now has two matching rows; combined runs share rate budgets | C18; fixtures must represent C07/C08 data | Seed legitimate shipping-fee snapshots, submit exact amounts, assert current route/fee messages, scope schedule row to its board, refresh GPS through API before reroute, isolate only test Redis rate keys | All 21 E2E suites and all 8 browser journeys pass with backend ownership/lifecycle rules retained |
| I1-08 | README/deployment runbook absent and roadmap omits A–I1 | Reviewable release/config consistency | Add README/runbook/audit report, update env example, testing and roadmap; add guarded Prisma shadow configuration | CLI help/config/schema validation, rejected same-DB shadow config, reviewed deployment checklist |

## Audited behavior

- **Auth/RBAC:** global access guard validates HS256, issuer/audience, DB session/user state and tokenVersion; role guard and command services enforce resource ownership. HttpOnly Secure refresh cookie, trusted Origin for browser auth, rotation/replay rejection and temporary-password restrictions remain backend-authoritative. Socket current-scope checks now include already-connected recipients.
- **Transactions/concurrency/idempotency:** all operational E2E suites cover shipment/assignment ownership, transfer origin/destination, line-haul driver/vehicle reservation exclusion, capacity, READY/dispatch/arrival, delivery/POD/COD, independent shipping-fee ledgers and signed webhook replay. History is append-only; no generic status command or frontend authority was introduced.
- **PostgreSQL/Redis/BullMQ:** runtime pool/direct migration connections remain separate; Prisma and Redis initialization/cleanup and normal Nest app close exercised by E2E. Redis GPS TTL stays 20 seconds; failed writes do not publish fabricated location. Queue delivery remains separate from committed business state. Dependency failure cases have unit/integration coverage. Target-platform shutdown/drain, managed-service TLS/ACL/eviction and SMTP delivery still require staging evidence.
- **HTTP/health:** Helmet, exact frontend CORS, explicit proxy-hop setting, per-endpoint throttling and structured redaction were inspected. Production smoke verifies secure cookie/origin rejection, 401/403, anti-spoofed rate budget, seconds-based retry header, correlation/security headers and live/ready. PostgreSQL failure→503 and runtime Redis failure→degraded readiness remain covered by health tests.
- **Public/dev surfaces:** public API identity exposes only name/version; public tracking is constrained; auth/health and the verified payment webhook are intentionally public. Swagger is off in production smoke. The TEST adapter remains development/test code selected only by validated config; production cannot select it. GPS simulator UI is build-gated and absent from the REAL production bundle. No route/debug proxy or C05-protected history deletion was found; the existing saved-address delete preserves Shipment snapshots.
- **Secrets/dependencies:** scanners print paths only; root development `.env` was not modified. Production credentials, SMTP delivery and managed Redis were not supplied and were not inferred from local successful tests. Current audit feed is clean; continue normal advisory monitoring for the pinned dependency set.

## Production remains disabled at provider boundaries

`ROUTE_PROVIDER=DISABLED`: assignment eligibility and manual dispatch remain functional; distance is honest `HAVERSINE_FALLBACK`, ETA/duration unavailable, planned road geometry nullable, deviation UNKNOWN without geometry, external reroute unavailable. Full operational backend E2E used disabled routing. No production road-provider URL/credential or fabricated road metric is required.

`PAYMENT_PROVIDER=DISABLED`: production artifact rejects payment creation/webhook, while H1/H2 cash collection/reconciliation stays separate from COD. No TEST HMAC secret is used by the production process. Browser payment tests explicitly run against the development TEST adapter and do not count as a live payment-provider test.

## Release blockers and required follow-up

1. **Migration gate:** run real Prisma deploy/status + migration-to-schema diff on a permitted build/staging runner with a disposable shadow DB. Review and reconcile the two H2/H3 development checksum changes; do not edit `_prisma_migrations` automatically or claim that SQL replay satisfies Prisma history/drift verification.
2. **Release artifact/infra:** no production Dockerfile/static-server deployment config or CI workflow exists. Choose a deployment target, provision PostgreSQL + `btree_gist` + backup/PITR, managed standalone Redis + noeviction/TLS, HTTPS static host/reverse proxy/WebSocket forwarding, secret manager and monitoring. Verify target SIGTERM/drain and restore/rollback. The runbook is reviewable documentation, not proof of deployed infrastructure.
3. **SMTP/account recovery:** configure and test actual SMTP/password reset delivery or explicitly accept unavailable email recovery before go-live. No bootstrap Admin production account was created by this audit.
4. **Release commit:** the incoming workspace already contained broad A→H3 tracked/untracked changes. They were preserved. Review and include all migrations/modules/tests in a release commit; do not deploy an incomplete HEAD that excludes them.

Initial topology is **one backend instance**. Redis runtime outage uses local rate-limit fallback, and Socket rooms are process-local. Horizontal scaling is not release-ready; sticky sessions alone do not supply distributed fan-out or outage-safe global rate limiting.

Production env, infrastructure specifics and migration/deployment/rollback order are canonical in [DEPLOYMENT.md](DEPLOYMENT.md). Stop after I1; no deployment or provider-enablement action is authorized by this report.

## Files changed by I1

- Migration/config: H2/H3 `migration.sql`, `backend/prisma.config.ts`, `.env.example`.
- Backend: `notifications.gateway.ts/.spec.ts`, async notification/route/location callers, `redis-throttler.storage.ts/.spec.ts`.
- Frontend: `services/auth-session.ts`, `services/api.ts`, `services/operations-socket.ts`, `features/locations/location-map.tsx`, `vite.config.ts`, auth-tab/URL tests.
- Verification: five `backend/scripts/audit-*.mjs` scripts, corrected legacy E2E fixtures, browser test isolation helper and F/G3A/G3C2 expectations plus shared imports.
- Documentation: `README.md`, this report, `DEPLOYMENT.md`, `TESTING.md`, `ROADMAP.md`, `PROJECT_STATE.md`.
