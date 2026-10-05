# Control Tower + SLA / Aging — 2026-10-06

Implemented locally for Admin / Dispatcher. No deployment, remote business-data mutation, new dependency, state-machine change, or schema change. **Migration required: NO.** Existing migrations were replayed only into new disposable localhost test databases by the existing `backend/test/p0-local.mjs` runner.

## Architecture and data source

- Reuses the NestJS monolith's `DashboardsModule`, PostgreSQL/Prisma, global auth/session/RBAC guards and the existing Shipment / WarehouseTransfer / LineHaulTrip lifecycle. This feature is a read model; no new status-update or exception-resolution command.
- One parameterized PostgreSQL statement returns the summary, filtered total, priority page and database `statement_timestamp()` as `asOf`. Summary and rows use the same snapshot and filters. No per-item application queries or loading all shipments into Node memory. Item limit is 100; warehouse names are joined after pagination.
- Existing indexes serve Shipment scope, TrackingEvent `(shipmentId, createdAt)`, active transfers, manifest associations, and Trip audit lookups. Only operational columns are projected; no contact/package/financial snapshots are returned by Control Tower.
- Backend calculates `stageStartedAt`, `timestampSource`, `timestampQuality`, `agingSeconds`, `isAging`, `deadline`, `atRiskAt`, `slaState`, exception and priority. Browser displays these values and can refresh every 60 seconds; browser time never determines SLA state or aging.
- Active shipments exclude DELIVERED, CANCELLED, RETURNED. DAMAGED / LOST and current delivery/return exceptions remain visible. Trip scope is PLANNED / READY / IN_TRANSIT. Shipment KPIs and Trip counts are separate, so a manifest does not double-count active shipments.
- Enforced invariants: C01 backend authority, C04 RBAC/resource scope, C05 append-only history, C06 tracking/audit separation, C08 historical data unchanged, C16 one SLA policy source, C18 tests. Existing transition, ownership and concurrency rules remain authoritative.

## SLA policy and assumptions

No business SLA was specified in the inspected domain documentation/configuration. These are explicit **operational defaults**, not contractual delivery promises. Policy defaults/validation live in `backend/src/config/control-tower.ts`; lifecycle-to-stage projection and effective policy live in `control-tower.policy.ts`.

| Stage | Included shipment states / start | Default | Override |
|---|---|---:|---|
| PICKUP | CONFIRMED through PICKED_UP, ending at origin check-in; `confirmedAt`, otherwise stage-entry tracking | 8 h | `SLA_PICKUP_MINUTES=480` |
| ORIGIN_DWELL | AT_ORIGIN_WAREHOUSE; current tracking stage entry | 12 h | `SLA_ORIGIN_DWELL_MINUTES=720` |
| TRANSIT | IN_TRANSIT; active transfer `dispatchedAt`, otherwise stage-entry tracking; Trip uses `departedAt` | 24 h | `SLA_TRANSIT_MINUTES=1440` |
| DESTINATION_DWELL | AT_DESTINATION_WAREHOUSE / AWAITING_DELIVERY_ASSIGNMENT / DELIVERY_ASSIGNED; current tracking stage entry | 12 h | `SLA_DESTINATION_DWELL_MINUTES=720` |
| DELIVERY | OUT_FOR_DELIVERY; current active attempt `startedAt`, otherwise stage-entry tracking | 8 h | `SLA_DELIVERY_MINUTES=480` |

- Continuous elapsed time, 24/7. No calendars, holidays, per-customer contracts, distance-based policy or inferred ETA.
- `deadline = stageStartedAt + duration`; `atRiskAt = stageStartedAt + duration × SLA_AT_RISK_PERCENT / 100`.
- ON_TIME: `asOf < atRiskAt`; AT_RISK: `atRiskAt <= asOf < deadline`; OVERDUE: `asOf >= deadline`. Default at-risk percentage: **80**; valid 1–99.
- Aging attention starts at **360 minutes / 6 h** (`CONTROL_TOWER_AGING_MINUTES`), independently of SLA. Durations must be integer minutes 1–525600; invalid config fails startup validation.
- Pickup includes waiting for origin check-in after collection. Destination dwell includes waiting for assignment/start of delivery; same-city origin-to-ready-for-delivery enters this stage too. Assignment/reassignment within a stage does not restart its SLA.
- PENDING, exception/return stages, and Trip PLANNED/READY have aging but **no SLA policy**. Their `slaState`/deadline are null, never a fabricated ON_TIME. Query-only `UNAVAILABLE` selects null SLA; it is not a fourth SLA state.
- Config changes affect the current read model; this feature does not persist contractual SLA snapshots or rewrite historical records.

## Aging and exceptions

- `agingSeconds = floor(asOf - stageStartedAt)` in seconds. Entry is the earliest tracking timestamp in the current contiguous stage, after the last event from another stage. Multiple status/assignment changes within the stage do not reset aging. Re-entry after delivery failure starts a new delivery stage.
- Canonical lifecycle timestamps take precedence where available, as specified above. Shipment PENDING / Trip PLANNED use `createdAt`; Trip READY uses its PLANNED → READY AuditLog timestamp. `updatedAt` is never used.
- Missing timestamps return `MISSING`; future timestamps, timestamps before creation, a latest tracking state conflicting with the current state, or an unorderable stage-entry history return `INCONSISTENT`. Those rows have null aging/deadline/SLA and remain visible as data-quality exceptions. No zero-age fallback, history backfill or guessed timestamp.
- Operational exceptions derive from the **current** DELIVERY_FAILED / RETURN_REQUESTED / RETURN_IN_TRANSIT / DAMAGED / LOST state, missing active transfer for IN_TRANSIT, or timestamp quality. They clear from this projection when the underlying state/data is resolved through existing workflows. There is no new acknowledgement/resolution ledger. If a lifecycle exception and timestamp issue coexist, UI shows both via `exception` and `timestampQuality`.
- Default priority: overdue (earliest deadline), at-risk (earliest deadline), aging alerts (oldest), unresolved exceptions, remaining tasks. Entity type + ID provides a stable tie-break. Optional sorts: aging descending, deadline ascending, creation descending, code ascending. Null aging/deadline sorts last.

## API contract

All paths have existing `/api/v1` prefix. Both Control Tower endpoints allow only active authenticated ADMIN / DISPATCHER sessions.

| Method / path | Purpose |
|---|---|
| `GET /control-tower` | Combined summary + priority/overdue list + pagination in one database snapshot |
| `GET /control-tower/filters` | Allowed statuses/stages/SLA filter values and effective policy |
| `GET /warehouses` | Reused searchable, paginated warehouse catalogue |
| `GET /warehouses/:id/transfers/:transferId` | New exact transfer detail; reuses existing transfer response and warehouse scope validation. ADMIN / DISPATCHER / correctly scoped WAREHOUSE_STAFF only. |

Dashboard query fields:

- `warehouseId`: UUID matching origin/destination/current/return warehouse, not just physical current inventory.
- `entityType`: ALL (default), SHIPMENT, TRIP; `status`; `stage`; `slaState`: ON_TIME / AT_RISK / OVERDUE / UNAVAILABLE; `exceptionsOnly=true`.
- `search`: bounded case-insensitive literal substring of shipment/trip code or active linked transfer/trip code; no user SQL interpolation.
- `from`, `to`: ISO timestamps with timezone; filter entity creation time `[from, to)`. Invalid/reversed ranges return 400. UI converts device-local datetime inputs to explicit UTC instants.
- `sort`: PRIORITY (default), AGING_DESC, DEADLINE_ASC, CREATED_DESC, CODE_ASC; `page`: 1–100000; `limit`: 1–100, default 25.
- Response: `asOf`, effective `policy`, `summary`, `items`, `pagination` (`page`, `limit`, `total`, `totalPages`). Out-of-range pages return empty items with correct totals.

Example: `GET /api/v1/control-tower?entityType=SHIPMENT&slaState=OVERDUE&page=1&limit=25`.

## UI, routes and screenshots

- `/admin/control-tower`, `/dispatcher/control-tower`; role navigation links and lazy page loading.
- Eight KPI cards, separate Trip counters, status + text/color, backend aging/deadline, filter state in URL, server sorting and pagination, auto-refresh toggle, snapshot timestamp, policy disclosure, loading/error/retry/empty states. Responsive shared DataTable switches to cards on smaller screens; sort headers expose `aria-sort`.
- Exact Shipment: `/admin/shipments/:id`, `/dispatcher/shipments/:id`.
- Exact Transfer: `/{admin|dispatcher}/warehouses/:warehouseId/transfers/:id` (new read-only detail).
- Exact Trip: `/admin/line-haul/trips/:id`, `/dispatcher/line-haul/:id`.
- Screenshots (local fixture data, actual production components): [Admin desktop](../test-results/control-tower/admin-1440.png), [Admin tablet](../test-results/control-tower/admin-768.png), [Admin mobile](../test-results/control-tower/admin-375.png), [Dispatcher desktop](../test-results/control-tower/dispatcher-1440.png), [Dispatcher tablet](../test-results/control-tower/dispatcher-768.png), [Dispatcher mobile](../test-results/control-tower/dispatcher-375.png).

## Verification

| Check | Result |
|---|---|
| Backend unit regression | PASS 511/511, 60 suites |
| Frontend unit regression | PASS 72/72 |
| Control Tower real PostgreSQL/HTTP | PASS 7/7: exact inclusive SLA boundaries; all five stages; aging/reassignment/redelivery; missing/future/conflicting timestamps; filters; deterministic pagination/totals; real auth/RBAC; transfer detail scope; real warehouse command resets stage; dashboard reads preserve history |
| Existing backend regression | PASS 65/65 across split runs: auth and auth races, shipment, pickup, warehouse/transfer, delivery, line-haul G2/G3A/G3C2, operational flow and notifications |
| New browser matrix | PASS Admin + Dispatcher × 375/768/1440px: rendering, filters/timezone/F5, sort/page, exact Shipment/Transfer/Trip navigation and detail refetch on F5, loading/empty/error/retry, no page overflow or JS exceptions |
| Notification browser regression | PASS 375/768/1440px: dropdown/center Pickup + Delivery deep links and F5 |
| Canonical-flow browser regression | PASS 375/768/1440px: warehouse strict/compatibility controls, resources, arrived/legacy receive, delivery map/reload/no-GPS/legacy behavior |
| Lint / backend + frontend typecheck / builds | PASS; final backend rebuilt after query projection refinement |

The first combined PostgreSQL run was **67 PASS / 4 FAIL** because G3A fixture logins hit shared localhost Redis rate limiting (429), followed by its cleanup receiving an empty fixture UUID. G3A alone subsequently passed 4/4; auth/rate-limit code was not weakened. Control Tower was then extended and rerun at 7/7. Sandbox spawn/Chromium restrictions were resolved through approved local execution.

Commands/evidence: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; `node backend/test/p0-local.mjs test/control-tower.e2e-spec.ts`; existing regression suites through that same isolated runner; `node frontend/test/control-tower/check.mjs`; `node frontend/test/ui-flow/notification-reload.mjs`; `node frontend/test/ui-flow/canonical-flow.mjs`. Logs/screenshots: `test-results/control-tower/` (gitignored).

Environment: local Windows / Node 24.13.1. Repository engine remains Node 22; no stack/dependency changes. Linux/Node 22 hosted CI and staging UI/API verification were not run. Browser matrix uses mocked HTTP; backend tests use actual PostgreSQL/Redis/HTTP. Production build records unknown release SHA for this uncommitted local workspace; no release identity/deploy claim. Existing location-map chunk-size warning remains.

## Files changed by this task

- Configuration: `.env.example`, `backend/src/config/control-tower.ts`, `backend/src/config/env.validation.ts`.
- Read model: `backend/src/modules/dashboards/control-tower-query.dto.ts`, `control-tower.controller.ts`, `control-tower.policy.ts`, `control-tower.query.ts`, `control-tower.response.ts`, `control-tower.service.ts`, `control-tower.spec.ts`; `dashboards.module.ts` registration.
- Exact transfer read: `backend/src/modules/warehouses/warehouses.controller.ts`, `warehouses.service.ts`.
- UI: `frontend/src/features/control-tower/control-tower-api.ts`, `control-tower-filters.tsx`, `control-tower-model.ts`, `control-tower-page.tsx`, `control-tower-types.ts`; `frontend/src/features/warehouses/pages/transfer-detail-page.tsx`, `warehouses-api.ts`.
- Shared wiring: `frontend/src/app/role-routes/admin-routes.tsx`, `dispatcher-routes.tsx`, `frontend/src/features/auth/components/account-layout.tsx`; small optional DataTable row-class/aria-sort extension in `frontend/src/components/ui/data-table.tsx`.
- Tests: `backend/test/control-tower.e2e-spec.ts`, `frontend/test/control-tower.test.mjs`, `frontend/test/control-tower/check.mjs`.
- Evidence/state: this report and short additions to `PROJECT_STATE.md`. Other workspace documentation deletions/edits are outside this task and were preserved.

## Known limitations / next validation

- Confirm the default thresholds with operations before treating them as business commitments. No pre-departure, return/exception-resolution or end-to-end customer SLA has been invented.
- Exceptions are a current-state projection; no new workflow to close DAMAGED/LOST or acknowledge alerts. Trip-specific exceptions currently cover timestamp quality; shipment exceptions are visible on their own rows with Trip links.
- Snapshot refresh is polling, not a new queue/socket stream. Offset pages can shift between requests as live state changes; each response itself is internally consistent.
- Summary/sorting still require database work over matching active entities/history. No production-volume benchmark or additional index/materialized-view migration was performed. Node payload is page-bounded.
- Validate on the supported Node 22/Linux CI environment and, in a separate authorized task, staging with real operational data. **No production deploy. Migration required NO.**
