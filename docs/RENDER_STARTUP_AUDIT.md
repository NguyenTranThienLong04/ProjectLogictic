# Render startup audit — 2026-09-26

Target: existing Web Service `logistics-staging-api`, repository root directory.

## Evidence and diagnosis

User-supplied failed deployment: commit `f1da917c69b70a9d69a372f0ef0b7879daccf103`, build succeeds and verifies `backend/dist/main.js`, then Render reports no open ports. No application startup output was included. The precise remote blocking dependency remains unconfirmed; neither a bad Start Command nor Node 26 incompatibility is proven.

- Start Command before **and after**: `node backend/dist/main.js`. This is already correct from the repository root. `backend` had `start: node dist/main.js`; it now also has `start:prod: node dist/main.js`. Root-workspace alternative is `npm run start:prod --workspace backend`, but no dashboard command change is needed.
- Build Command stays `npm ci --include=dev && npm run build --workspace backend`. No runtime compilation or migrations.
- Before: `app.listen(port)` with validated `PORT`, implicit wildcard host (not an explicit localhost bind). After: numeric validated PORT and `app.listen(port, '0.0.0.0')`.
- CI and Docker use Node 22. Root `engines` changes from unbounded `>=20` to `22.x`; `.node-version` selects 22. Render's `NODE_VERSION` dashboard override takes precedence: remove an obsolete override or set it to 22. See [Render version selection](https://render.com/docs/node-version) and [port binding](https://render.com/docs/web-services#port-binding).

## Startup blockers corrected

1. Environment validation runs during AppModule import. Import now happens inside guarded bootstrap; `Starting API...` precedes it. Nest construction errors reach the sanitized catch (`abortOnError: false`, logging disabled only during construction).
2. Prisma `onModuleInit`: `$connect` and `SELECT 1`; existing pool acquisition timeout was 10 seconds, but the complete startup query had no deadline. Both now have a shared 15-second deadline and a safe dependency-specific error.
3. Redis `onModuleInit`: `connect` and `PING`; TCP timeout alone did not bound ready-check/PING waiting. The full operation now has a 15-second deadline, disconnects on failure and remains required in production.
4. BullMQ producer connections inherit Redis's reconnect-after-ready retry strategy. `Promise.all(connect())` could retry indefinitely before listen. It now has a 15-second deadline, disconnects both clients on failure, and fails production startup instead of silently disabling queues. Worker connections are created asynchronously and are not awaited pre-listen; their runtime retry policy is unchanged.
5. Global bootstrap deadline: 60 seconds with startup stage. Previously `process.exitCode = 1` could leave a failed process alive because of Redis/queue sockets. Failure now logs only redacted top-level error/stage (no raw cause/stack) and exits 1. Successful binding clears the deadline and logs `Listening on 0.0.0.0:<PORT>`.

Production validation/security, DB and Redis remain enabled. No shipment transition, ownership, historical records or money rules change; C01–C18 business invariants remain unchanged. Redis is still disposable infrastructure, not the source of truth.

## Verification

- Backend build, typecheck, lint: PASS.
- Focused environment, Redis, queue, deadline and health tests: 30/30 PASS. Follow-up `--detectOpenHandles` on startup/Redis/queue tests: 14/14 PASS, no reported handles.
- Isolated Docker Node **22.23.2**, PostgreSQL 17, Redis 7.4: compiled artifact starts in production, HTTP `/api/v1/health/ready` returns **200**, `database: up`, `redis: up`.
- Actual Linux `/proc/net/tcp`: `00000000:2710` in LISTEN state, proving **0.0.0.0:10000** (not merely a log assertion).
- Actual Node 22 artifact failure regression: **4/4 PASS** (invalid production secret, unavailable DB, unavailable Redis, Redis accepting TCP without answering). Every process exits 1, never logs Listening, and never exposes injected secret markers. Initial harness limit of 25 seconds was too short for Windows-to-Linux module bind-mount loading; increased the test-only ceiling to 90 seconds, leaving application deadlines at 15/60 seconds.
- Infrastructure contains no staging data or credentials; no migrations/business writes were performed. This verifies startup readiness, not business-schema deployment.
- Render failed deploy: **FAIL** per supplied logs. Fixed revision deployment/Live: **BLOCKED**, no authenticated Render management connection; local HTTP success cannot prove a Render revision is Live.

## Changed files

- Runtime/version: `package.json`, `package-lock.json`, `.node-version`, `backend/package.json`.
- Bootstrap/dependencies: `backend/src/main.ts`, `backend/src/common/startup.ts`, `backend/src/database/prisma.service.ts`, `backend/src/redis/redis.service.ts`, `backend/src/modules/notifications/notification-jobs.service.ts`.
- Verification: `backend/src/common/startup.spec.ts`, `backend/src/modules/notifications/notification-jobs.service.spec.ts`, `backend/scripts/check-startup-failures.mjs`, `deploy/startup-smoke.compose.yml`.
- Evidence: this report and `PROJECT_STATE.md`.

Reproduce:

```sh
npm run build --workspace backend
docker compose -p logistics-startup-smoke -f deploy/startup-smoke.compose.yml up -d --wait
docker compose -p logistics-startup-smoke -f deploy/startup-smoke.compose.yml run --rm --no-deps api node check-startup-failures.mjs
docker compose -p logistics-startup-smoke -f deploy/startup-smoke.compose.yml down -v
```

After deploying the fixed revision, verify selected Node 22, both startup messages, health HTTP 200 with both dependencies up, and the revision's Render status **Live**. Retain the existing production environment/security validation; use the dependency-specific failure if startup fails. Set the health check path to `/api/v1/health/ready`.
