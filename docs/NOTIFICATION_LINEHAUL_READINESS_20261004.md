# Driver notification + canonical Line-haul A → B — 2026-10-04

Local implementation/verification complete; **staging BLOCKED, READY FOR CUTOVER: NO**. No deploy, enforcement change, staging migration/reset/seed or business-data mutation. No new dependency/module/schema/migration. Staging DB reads used `REPEATABLE READ READ ONLY` and `ROLLBACK`; browser used existing normal auth refresh and GET only.

## A. Notification

### Root cause and evidence

1. **Staging serves the old frontend.** At 18:18–18:26 ICT, entry remained `index-BGj12pP4.js`, SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`. Live shared layout `empty-state-De-z7GFy.js` contains `onClick:()=>!e.readAt&&a.mutate(e.id)`; it has neither assignment notification type mapping. `notifications-page-hwCzdxUT.js` likewise has no task navigation. Driver detail routes themselves exist. This is a release/content mismatch, not missing detail routes.
2. **Local source had a remaining sequencing bug:** `useOpenNotification` awaited `markNotificationRead`, and navigated only from `onSuccess`. A slow/failed PATCH blocked opening the task. Bell and notification-center title buttons were also disabled while read mutations were pending.
3. **No evidence of a backend metadata defect.** Read-only staging DB at 18:18:50 ICT: all 12 pickup and 10 delivery notifications for DRIVER recipients contained assignment IDs matching the real assignment, shipment, recipient ownership and task type. Newest pickup was 18:02:30 ICT; newest delivery 18:06:17 ICT. No missing assignment IDs among these 22 rows. Local real-API regression confirms the notification list serializes the same `data` field.

### Trace and payload before/after

`AssignmentsService.assignPickup` / `DeliveryService.assign` → transactional `NotificationsService.createIdempotent` → PostgreSQL Notification → `GET /api/v1/notifications` → `response.data.data.items[]` → `notification.type` + `notification.data.assignmentId` → shared click hook → shared `notificationTarget` → React Router `navigate`.

The payload is **unchanged before/after**; no history rewrite or metadata backfill:

```json
{
  "type": "PICKUP_ASSIGNMENT_CREATED",
  "data": {
    "shipmentId": "34dbf7d7-dd46-48ae-b305-680871ed0afa",
    "assignmentId": "fdd69d75-5846-49e1-aee4-2a7e3ee4e16e"
  }
}
```

The matching newest delivery has type `DELIVERY_ASSIGNMENT_CREATED`, the same shipment ID and assignment ID `f445249b-7b49-4615-8b94-4800a1282b7f`. Metadata is named **`data`**, not `metadata`; shipment ID is not a detail-route parameter.

| Type, DRIVER role | Valid assignment ID | Missing/malformed assignment ID |
|---|---|---|
| `PICKUP_ASSIGNMENT_CREATED` | `/driver/pickups/:assignmentId` | `/driver/assignments` |
| `DELIVERY_ASSIGNMENT_CREATED` | `/driver/deliveries/:assignmentId` | `/driver/deliveries` |
| Other notification | `/driver/assignments` | `/driver/assignments` |

Other roles never receive a Driver route from the resolver. UUID validation rejects malformed/path/URL values. Detail pages still refetch ownership-scoped backend endpoints from the URL: `/driver/assignments/:id` and `/driver/delivery-assignments/:id`.

**After fix:** clicking starts the read mutation, closes the dropdown and navigates immediately, independently of the request result. Only a successful read invalidates notification queries; failure never fabricates a read timestamp. Latest open/read failure is visible across page unmounts via the existing TanStack mutation cache scoped to user ID. A non-focusing status message tells the user to reopen the unread notification to retry. Already-read notifications still navigate without another PATCH. Separate mark-read/read-all actions remain intact.

### Files changed this task

| File | Change |
|---|---|
| `frontend/src/features/notifications/use-open-notification.ts` | Decouple navigation from read completion; preserve error feedback across navigation |
| `frontend/src/features/notifications/notification-bell.tsx` | Keep navigation enabled; show retry feedback outside the closed dropdown without moving focus |
| `frontend/src/features/notifications/notifications-page.tsx` | Keep task title navigation enabled during read operations; reuse Bell feedback |
| `frontend/test/ui-flow/check.mjs` | Pending/503 mark-read, retry, legacy pickup/delivery, malformed ID, already-read cases for both entry points |
| `frontend/test/ui-flow/notification-reload.mjs` | Actual App/BrowserRouter/AuthProvider/lazy Driver routes, click → F5 → same owned detail API |
| `backend/test/operational-flow.e2e-spec.ts` | Assert real assignment-created notification API metadata, repeat mark-read timestamp and reject another Driver's mark-read |

`notification-target.ts`, backend producers/list serializer and Driver detail routes were audited and reused unchanged.

### Results

| Notification check | Local result |
|---|---|
| Pickup deep-link | PASS |
| Delivery deep-link | PASS |
| Dropdown + all-notifications page | PASS |
| Missing pickup/delivery ID, malformed ID, general notification fallback | PASS |
| Mark-read success and already-read navigation | PASS |
| Mark-read pending does not block pickup/delivery navigation | PASS |
| Mark-read 503 still opens task, remains unread, shows feedback; retry succeeds | PASS |
| F5 on pickup/delivery detail restores auth and refetches correct assignment ID | PASS |
| Backend metadata + mark-read ownership/idempotency | PASS |
| Mobile/tablet/desktop, no runtime crash or horizontal overflow in reload matrix | PASS 375/768/1440 px |

Browser HTTP is mocked; App/router/auth/components are real. Real PostgreSQL/API persistence is tested separately. No authenticated staging Driver click/reload PASS is claimed: the available profile named `auth-staging-driver` restored **CUSTOMER**, not DRIVER. Existing Admin session GET succeeded; no impersonation/token minting. Staging notification status: **BLOCKED** (Live handler still fails requirement, corrected code not deployed).

## B. Line-haul

### Canonical flow, reused unchanged

Warehouse A check-in/sort → create PENDING Transfer (Shipment remains at A) → Dispatcher/Admin creates Trip with LINE_HAUL Driver + positive-capacity AVAILABLE Vehicle → matching-route manifest + valid schedule → READY with immutable load/capacity/route snapshot → trip dispatch atomically moves Trip + Transfers + Shipments to IN_TRANSIT and Vehicle to IN_USE → owned trip GPS through Redis/Socket → destination staff/Admin arrive → Trip ARRIVED and Vehicle released → destination staff receive each Transfer → COMPLETED, Shipment at destination → explicit ready-for-delivery command.

Relevant existing sources: `line-haul-trips.service.ts`, `line-haul.policy.ts`, `warehouse-transfer-lifecycle.service.ts`, `warehouse-transfer-flow.policy.ts`, `warehouse.response.ts`, `warehouse-workspace-page.tsx`, `transfer-trip-summary.tsx`. **No line-haul product files changed this task:** the requested guards and cutover compatibility already exist and the real PostgreSQL tests pass. No alternate module/API was introduced.

Trip actor evidence is append-only `AuditLog` (`LINE_HAUL_TRIP_READY`, `LINE_HAUL_TRIP_DISPATCHED`, `LINE_HAUL_TRIP_ARRIVED`) with actor/role/time/context; Trip also stores departure/arrival times. Transfer retains its dispatch/receive actor/time fields and per-transfer tracking/audit. Row locks, conditional updates, schedule exclusion constraints and one-active-manifest uniqueness remain authoritative.

Warehouse UX regression confirms pending transfer displays the “Chờ xếp chuyến” action state and waiting-for-dispatcher explanation, assigned trip shows trip/vehicle/driver/departure schedule, strict mode hides standalone Dispatch, IN_TRANSIT trip cannot receive, ARRIVED and eligible legacy can receive. Planning remains Dispatcher/Admin responsibility; Warehouse B receives. Existing copy/status enum mapping is retained.

### Positive/negative tests

| Case | Result and evidence |
|---|---|
| A → Transfer → Driver + Vehicle + Trip/manifest/schedule → READY → depart → IN_TRANSIT → ARRIVED B → receive → COMPLETED | PASS, G2 real PostgreSQL/Nest API |
| No Driver / no Vehicle | PASS, create returns 400 |
| Empty manifest / standalone dispatch in strict | PASS, 409 |
| Wrong route | PASS, READY rejects inconsistent manifest |
| Over capacity / capacity becomes insufficient before READY or dispatch | PASS, no partial movement |
| Missing/overlapping schedule; suspended Driver; maintenance Vehicle | PASS, G3C2 |
| Receive before ARRIVED / wrong destination | PASS, rejected |
| Concurrent duplicate READY/depart/arrive/receive | PASS, idempotent; one transition/audit/tracking result |
| Concurrent manifest adds and schedule/reschedule reservations | PASS, locks/constraints preserve one valid winner |
| Owned trip GPS + authorized room/read scope; arrival ends visibility | PASS, real local Redis/Socket.IO (synthetic test GPS, not physical-device staging GPS) |
| Legacy standalone IN_TRANSIT before cutover | PASS, concurrent receive returns 200 twice, single receive audit, unchanged departure actor/time, zero TripTransfer rows |

`LINE_HAUL_ENFORCEMENT_FROM` remains unchanged. Empty means compatibility mode. At/after the configured future cutover, standalone dispatch is rejected; standalone receive requires `dispatchedAt < cutover`. No fabricated legacy Trip/Driver, migration or historical update.

### Fresh staging resource inventory

Source: operator-confirmed root-env Neon `ep-royal-dust-axv3itmx…/neondb`, read-only transaction at **18:18:50 ICT, 04/10/2026**.

| Resource | Observed | Readiness |
|---|---|---|
| SG01 / `94e6ee6d-3627-4bdb-b479-d73a0e13801c` | Active; 1 active staff with active WAREHOUSE_STAFF user | PASS A |
| SG02 / `db616144-574c-4730-92cf-2fe1738ba0c6` | Active; 1 active staff with active WAREHOUSE_STAFF user | PASS B |
| `P0-1790653217727-ORI` and `…-DST` | Active; **0 active staff each** | Missing staff for those routes |
| Active managers | 1 Admin, 2 Dispatchers | PASS |
| Driver with LINE_HAUL capability | **0** | MISSING |
| LineHaulVehicle | **0** | MISSING; capacity cannot be validated |
| LineHaulTrip | **0** | MISSING route-configured trip and schedule |
| Manifest / completed canonical smoke | **0 trips**, hence no associated manifest or A→B smoke | MISSING |
| Transfers | 7: 6 COMPLETED, 1 standalone IN_TRANSIT | Compatibility currently in use |

SG01 → SG02 is a valid active warehouse pair; the existing module defines the operational route on the Trip, with route snapshots at READY. There is no missing new route-master module to build. An actual configured Trip/manifest/schedule has not been created.

Legacy `TRF-MUSKE729-PAEL` remains IN_TRANSIT SG01 → `P0-1790653217727-ORI`, departed `2026-10-03T15:46:59.652Z`, no trip. Its destination lacks active staff. It was **not received or rewritten** by this task. Resolve destination staffing operationally before requiring Warehouse Staff receive; preserve the existing departure evidence for the future cutover.

### Cutover gates

| Gate | Staging status |
|---|---|
| Canonical A→B complete | BLOCKED: missing resources; local PASS is not staging smoke |
| Notification deep-link | BLOCKED: Live frontend still old; no valid Driver browser session |
| Resources for operational routes | BLOCKED: missing resources above |
| Legacy compatibility | Local PASS; staging receive under deployed cutover code NOT RUN |
| Release SHA verified | BLOCKED: backend `/api/v1/health/version` 404; frontend `/release.json` HTML fallback |

Workspace base HEAD was `ef14f1f2f2946e057ee598caead5b0f3d377260a`; new changes are uncommitted. This is not a deployed/CI release identity. Builds honestly record SHA `unknown` without a verified build source.

**Migration: NO. READY FOR CUTOVER: NO.** Next work requires a verifiable compatibility release (backend then frontend, config empty), normal Admin/Dispatcher resource setup, an owned Driver session, real staging A→B/GPS/notification/legacy smoke, and then a single explicit stable cutover across API instances. No timestamp was chosen or set.

## Validation and limits

| Command / suite | Final result |
|---|---|
| Backend focused unit: assignment, delivery, notification, transfer lifecycle/enforcement, line-haul policy | 43/43 PASS |
| `node backend/test/p0-local.mjs test/phase-g2.e2e-spec.ts test/phase-g3a.e2e-spec.ts test/phase-g3c2.e2e-spec.ts` | 22/22 PASS (11 + 4 + 7) |
| `node backend/test/p0-local.mjs test/operational-flow.e2e-spec.ts` | 24/24 PASS, includes new notification assertions |
| `npm run test --workspace frontend` | 70/70 PASS |
| `node frontend/test/ui-flow/check.mjs` | PASS 375/768/1440 |
| `node frontend/test/ui-flow/notification-reload.mjs` | PASS 375/768/1440, both entry points × both tasks × F5 |
| `node frontend/test/ui-flow/canonical-flow.mjs` | PASS 375/768/1440 |
| Backend/frontend typecheck, lint and build | PASS |
| `git diff --check` | PASS |

Test runner creates isolated localhost PostgreSQL databases and uses localhost Redis; schema setup there never targets staging. Docker Desktop was started for these tests. Initial Windows sandbox EPERM errors were rerun through approved escalation. The new API assertion initially referenced a fixture Driver without a logged-in token; corrected to the other logged-in Driver, then 24/24 passed. Formatting-only lint errors were corrected. Existing chunk-size/SHA-unknown build warnings remain. Node runtime here is v24.13.1; no new hosted Node 22/Linux CI or deployment is claimed.

Invariants preserved/verified: C01/C03/C04, C05/C06/C08, C09/C10, C11/C12/C13, C16/C18. UI review used `.agents/skills/ui-ux-pro-max/SKILL.md`; no design-system/dependency changes.

Local ignored evidence: `test-results/notification-linehaul/staging-database.json`, `live-shared-layout.js`, `*-375.png`/`*-768.png`/`*-1440.png`; `test-results/ui-flow-staging-verification/public.json`, `browser-preflight.json` and downloaded Live modules; `test-results/ui-flow/` and `test-results/canonical-flow/` screenshots. Reports contain no credentials/access tokens.
