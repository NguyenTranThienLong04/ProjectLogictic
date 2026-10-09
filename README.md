# Logistics Operations

A full-stack logistics portfolio project covering shipment booking, dispatch, warehouse handoffs, line-haul transport, last-mile delivery and cash reconciliation. Five roles work on the same operational history, with authorization and lifecycle rules enforced by the backend.

Built to demonstrate practical Intern/Fresher engineering: a modular monolith, transactional business commands, scoped access, concurrency controls, responsive workflows and reproducible regression checks.

**Verification, 2026-10-09:** F07/F08 passed local Linux/Node 22 release gates at implementation commit `adbbbc41d5fe136bc04cb721b81a214773a2adba`. The final candidate includes the separate F09/F06 documentation commit on top; identify that exact SHA with `git rev-parse HEAD` in the release checkout. GitHub-hosted CI and staging smoke for the final candidate are pending. **F06: VERIFIED LOCAL / PROVIDER UNVERIFIED** — backup/PITR on the managed provider has not been verified. See the [closure record](docs/FINAL_PROJECT_CLOSURE_20261009.md).

## What you can demonstrate

| Role | Workspace and responsibilities |
| --- | --- |
| Customer | Quote/book shipments, follow tracking, receive notifications, acknowledge COD payouts |
| Dispatcher | Confirm shipments, assign eligible drivers, plan/schedule line-haul trips, monitor Control Tower |
| Warehouse staff | Check in pickups, route shipments, create/receive transfers, release eligible shipments for delivery within their assigned warehouse |
| Driver | Accept pickups, complete deliveries or record failure/return, submit cash remittances, share current location |
| Admin | Manage staff, warehouses, driver capabilities, fleet and pricing; review audit history and reconcile COD/shipping fees |

- Warehouse transfers have server pagination, search, status/direction filters and stable totals; record 101 remains reachable.
- Strict line-haul requires a scheduled, eligible trip and manifest before dispatch; destination receipt follows trip arrival.
- Control Tower links directly to the exact Shipment, Transfer or Trip, with SLA/aging filters and reloadable URLs.
- Auth refresh/F5, role changes, notification navigation and operational flows have browser regression coverage.

## Architecture

```mermaid
flowchart LR
  UI[React role workspaces] -->|REST /api/v1| API[NestJS controllers and guards]
  API --> Services[Domain services and policies]
  Services -->|Transactions, history, outbox| DB[(PostgreSQL)]
  Services --> Cache[(Redis: cache, current GPS)]
  DB --> Recovery[Notification recovery]
  Recovery --> Queue[BullMQ on Redis]
  Queue --> Workers[Workers]
  Workers --> Socket[Socket.IO /operations]
  Socket --> UI
  Workers --> SMTP[SMTP when enabled]
```

PostgreSQL owns business state, audit/tracking history and notification delivery intents. Redis supports cache, transient location and queue work. Controllers validate requests and roles; services enforce ownership, transitions and atomic writes. React consumes explicit commands and server-calculated state.

| Layer | Stack in this repository |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router, TanStack Query, React Hook Form/Zod, Leaflet, Recharts |
| API | NestJS 11, REST/OpenAPI, JWT access tokens + rotating HttpOnly refresh cookie, Socket.IO |
| Data/background work | PostgreSQL 17, Prisma 7, Redis 7.4, BullMQ |
| Verification/release | Jest, Supertest, Node test runner, Playwright/Chromium, GitHub Actions, Docker/Nginx |

Exact dependency versions are pinned in [package-lock.json](package-lock.json). Runtime: **Node 22.x**, **npm 11.18.0**. Upload/object-storage integration is not implemented in this release.

## Domain lifecycle

```mermaid
flowchart LR
  PENDING -->|Confirm| AWAITING_PICKUP_ASSIGNMENT
  AWAITING_PICKUP_ASSIGNMENT --> PICKUP_ASSIGNED
  PICKUP_ASSIGNED -->|Driver accepts| PICKUP_IN_PROGRESS
  PICKUP_IN_PROGRESS --> PICKED_UP
  PICKED_UP -->|Check in| AT_ORIGIN_WAREHOUSE
  AT_ORIGIN_WAREHOUSE -->|Trip dispatch| IN_TRANSIT
  IN_TRANSIT -->|Arrive and receive| AT_DESTINATION_WAREHOUSE
  AT_DESTINATION_WAREHOUSE -->|Ready for delivery| AWAITING_DELIVERY_ASSIGNMENT
  AWAITING_DELIVERY_ASSIGNMENT --> DELIVERY_ASSIGNED
  DELIVERY_ASSIGNED --> OUT_FOR_DELIVERY
  OUT_FOR_DELIVERY --> DELIVERED
  OUT_FOR_DELIVERY --> DELIVERY_FAILED
  DELIVERY_FAILED -->|Redeliver| AWAITING_DELIVERY_ASSIGNMENT
  DELIVERY_FAILED --> RETURN_REQUESTED
  RETURN_REQUESTED --> RETURN_IN_TRANSIT
  RETURN_IN_TRANSIT --> RETURNED
```

This is the main cross-warehouse journey. Confirmation records `CONFIRMED` in history before entering the pickup queue. Same-warehouse delivery and eligible cancellation have separate guards. Money is integer VND; pricing snapshots, COD and shipping-fee ledgers are separate. See [domain reference](docs/DOMAIN.md) and [business invariants](docs/CONSTITUTION.md).

## Run locally

Use Node 22/npm 11.18.0, Docker and a Linux shell (Linux/WSL2 for migration/release tooling). Run commands at the repository root. PostgreSQL below is a **new local demo database**, separate from staging and from destructive test fixtures.

```sh
npm install --global npm@11.18.0
npm ci
# Copy only if .env does not already exist; preserve any existing local settings.
test -e .env || cp .env.example .env
docker compose up -d redis
docker run -d --name logistics-demo-postgres \
  -e POSTGRES_USER=demo -e POSTGRES_PASSWORD=demo-local-only \
  -e POSTGRES_DB=logistics_demo \
  -p 127.0.0.1:55433:5432 postgres:17-alpine
```

For an existing demo container, use `docker start logistics-demo-postgres`. The root Compose file starts Redis only. The example database password is for this loopback-only demo; it is not a shared account credential.

Edit the root `.env` using [.env.example](.env.example):

```dotenv
DATABASE_URL=postgresql://demo:demo-local-only@127.0.0.1:55433/logistics_demo
DIRECT_URL=postgresql://demo:demo-local-only@127.0.0.1:55433/logistics_demo
SHADOW_DATABASE_URL=
```

Generate a JWT secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and put it in `JWT_ACCESS_SECRET`. Keep `NODE_ENV=development`, email/routing/payment disabled, and the example localhost frontend/API URLs. For the strict demo, set `LINE_HAUL_ENFORCEMENT_FROM` to a fixed UTC time at or before starting the demo; retain that value for subsequent restarts. Never change an existing environment's cutover as part of setup.

```sh
docker exec logistics-demo-postgres pg_isready -U demo -d logistics_demo
npm run db:generate
node backend/scripts/migration-integrity.mjs
npm run db:migrate:deploy
npm run db:migrate:status
npm run infra:check
```

Use the existing **28 migrations** from the [manifest](backend/prisma/migrations.manifest.json). On a fresh local DB, deploy applies them; repeating is a no-op. Stop on a mismatch. Do not use reset, `db push`, edit applied SQL or rewrite migration history. Shared-environment preflight and credential separation are in the [deployment runbook](docs/DEPLOYMENT.md).

Start two terminals:

```sh
npm run dev:backend
```

```sh
npm run dev:frontend
```

Open [the app](http://localhost:5173), [Swagger](http://localhost:3000/api/docs) and [readiness](http://localhost:3000/api/v1/health/ready). Both backend and Vite read the root `.env`. Restart after changing configuration. PowerShell users can copy the example with `Copy-Item .env.example .env` only when `.env` is absent; run Linux-only checks inside WSL/container.

## Demo and screenshots

Follow the [demo guide](docs/DEMO.md) for first-Admin bootstrap, accounts for every role, warehouse/driver/fleet preparation, and a complete **Shipment → Warehouse → Line-haul → Delivery → COD** walkthrough. No shared passwords or automatic staging seeds are supplied.

Control Tower is available to Admin/Dispatcher. It calculates stage aging from operational timestamps/history. Default SLA budgets are 8h pickup, 12h origin dwell, 24h transit, 12h destination dwell and 8h delivery; at-risk begins at 80%. Aging attention starts at 6h independently. Missing/inconsistent evidence stays visible without a fabricated deadline. These are operational settings, not customer delivery promises. [Policy and API details](docs/CONTROL_TOWER_SLA_AGING_20261006.md).

The demo guide includes a [screenshot checklist](docs/DEMO.md#screenshots-and-demo-recording). Capture your own local demo and label fixture-based browser screenshots accurately; no public gallery or hosted demo evidence is claimed here.

## API and tests

REST base: `/api/v1`; development OpenAPI UI: `/api/docs`. Authentication endpoints are under `/auth`, business commands under `/dispatcher`, `/driver`, `/warehouses`, `/line-haul`, `/cod` and `/shipping-fees`. Swagger reflects current DTOs. A bearer token does not replace role, warehouse or owner checks. Notifications also use `/operations` Socket.IO; reconnecting clients reload authoritative HTTP state.

```sh
npm run lint
npm run typecheck
npm test
npm run test:browser:regression
# Override development localhost URLs when building production frontend artifacts.
VITE_API_URL=/api/v1 VITE_SOCKET_URL=/ VITE_API_DOCS_URL= VITE_LOCATION_MODE=REAL npm run build
```

Install Chromium once with `npx playwright install chromium` (`--with-deps` on a prepared Linux runner). The additional regression command exercises the real frontend with HTTP fixtures. Database-backed commands below **write/clean fixture data** and require a migrated disposable DB, separate Redis and the guard-compliant environment:

```sh
npm run test:e2e --workspace backend
npm run test:browser -- --retries=0
```

The [disposable DB guard](backend/test/disposable-database.ts) requires localhost:55432 and `p0_regression_<digits>`, or `CI=true` with `i1_e2e`, `i1_browser`, `i1_smoke` (optional numeric suffix). Connection overrides are rejected. The demo DB on 55433 is intentionally ineligible. Use the [existing Linux runner](deploy/ci/verify.sh) and [CI service configuration](.github/workflows/release.yml) to reproduce the complete environment; do not bypass the guard.

[F07/F08 local evidence](docs/F07_F08_HARDENING_20261009.md): 521 backend + 72 frontend unit tests, 28 E2E suites, 8 real browser journeys, 7 additional browser groups, migration parity, audits and production container lifecycle passed. These are dated results, not a live CI badge.

## CI, deployment and recovery

[Release gates](.github/workflows/release.yml) run on PRs and main/master pushes using Ubuntu/Node 22, disposable PostgreSQL/Redis, canonical verification and production-container smoke. `release-gate` fails closed. Image publication requires explicit manual `publish_images=true`; the workflow does not deploy.

Deploy reviewed SHA/digest artifacts using the [deployment runbook](docs/DEPLOYMENT.md) and [production environment example](deploy/.env.example). Keep routing/payment disabled, location mode REAL and one backend instance until distributed socket/rate-limit support is verified. Public SMTP, provider PITR/retention and exact-release staging acceptance require separate evidence. Local logical restore verification and its limits are in [backup/restore](docs/BACKUP_RESTORE.md).

## Repository map

| Path | Purpose |
| --- | --- |
| [backend/src/modules](backend/src/modules) | Domain services, command controllers, policies and response mappers |
| [backend/prisma](backend/prisma) | Relational schema, immutable migrations and checksum manifest |
| [backend/test](backend/test) | HTTP/database regressions and real browser journeys |
| [frontend/src/features](frontend/src/features) | Role workspaces and shared API contracts |
| [frontend/test](frontend/test) | Frontend unit and browser regression scripts |
| [deploy](deploy) | Container/migration entrypoints and CI gates |
| [PROJECT_STATE.md](PROJECT_STATE.md) | Dated progress, decisions and verification scope |

Start with the [demo](docs/DEMO.md), [domain](docs/DOMAIN.md), [testing guide](docs/TESTING.md) and [closure checklist](docs/FINAL_PROJECT_CLOSURE_20261009.md).
