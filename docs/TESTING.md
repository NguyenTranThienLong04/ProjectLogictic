# TESTING — Cases, Definition of Done, Bugfix Rule

## PRIORITY
Unit > Integration > E2E critical flows. Business-critical feature chưa test = chưa DONE. Không sửa/xoá test chỉ để build pass.

## REQUIRED TEST CASES
```
PENDING → CONFIRMED succeeds
PENDING → DELIVERED rejected
DELIVERED → PENDING rejected
Customer A cannot access Customer B shipment
Suspended driver cannot be assigned
Customer cannot cancel after PICKED_UP
Driver cannot deliver another driver's shipment
Wrong warehouse cannot receive transfer
Wrong origin warehouse cannot look up/check in a picked-up shipment
Transfer create stays PENDING and keeps currentWarehouseId at origin
Transfer dispatch moves Shipment to IN_TRANSIT and clears currentWarehouseId
Transfer create/dispatch/receive retries do not duplicate transfer/tracking/audit
Duplicate delivery does not duplicate POD/COD/event
Failed delivery creates separate attempt
Pricing is recalculated by backend
Pickup driver outside operating-warehouse city is not eligible
Pickup candidates call route only after eligibility and rank ROAD_ROUTE ahead of Haversine fallback
Delivery candidates target the exact destination warehouse and rank by road metric when available
Missing/stale GPS is ineligible without HTTP 500
Route provider success, timeout, malformed response and upstream error are classified safely
Route cache hit avoids provider call; cache miss calls provider; Redis/provider failure falls back to Haversine
Haversine fallback never fabricates duration/ETA and is labeled HAVERSINE_FALLBACK
No public arbitrary-coordinate route proxy exists and provider secret/error detail is not exposed
Concurrent assignment commands produce one winner
Create Shipment requires SENDER or RECEIVER shipping-fee payer
Shipping fee payer does not change quote or total fee
Shipping fee payer persists as an immutable historical snapshot
Receiver-paid shipping fee is not added to CODTransaction amounts
Shipment creation snapshots one independent PENDING ShippingFeeTransaction from payer + totalFee
SENDER fee is collected only by the owning pickup Driver at successful pickup
RECEIVER fee is collected only by the owning delivery Driver at successful delivery
Shipping-fee collection rejects missing, fractional or mismatched integer-VND amount
Customer, Dispatcher and wrong Driver cannot collect shipping fee
Duplicate and retry collection never creates a second ShippingFeeTransaction or audit record
Failed delivery leaves RECEIVER shipping fee PENDING and creates no COD transaction
Shipping-fee collection never changes COD expected/collected amount or status
Shipment cancellation changes only a PENDING shipping fee to CANCELLED with audit
Valid line-haul vehicle can be created; duplicate vehicleCode/licensePlate is rejected
MAINTENANCE/INACTIVE vehicle is not eligible for a line-haul trip
Driver without LINE_HAUL capability, suspended profile, or inactive User is not eligible
Line-haul trip rejects identical origin/destination and inactive warehouses
Wrong-route WarehouseTransfer cannot be associated with a trip
One WarehouseTransfer cannot belong to two active trips
Driver and vehicle reject overlapping scheduled trips but allow unscheduled, non-overlapping and adjacent PLANNED trips
Line-haul RBAC rejects unauthorized Customer/Driver/Warehouse Staff access
Phase G1 migration preserves existing DriverProfile/WarehouseTransfer/assignment/audit rows and enforces partial unique/check constraints
READY without an active transfer or with a wrong-route transfer is rejected
READY locks manifest; add/remove/cancel-after-departure mutations are rejected
Dispatch from PLANNED, with unavailable vehicle, or with ineligible Driver is rejected
Concurrent/retried Mark Ready and Dispatch produce one transition and no duplicate tracking/audit
Trip dispatch atomically sets Trip IN_TRANSIT, Vehicle IN_USE, every transfer IN_TRANSIT, every Shipment IN_TRANSIT and currentWarehouseId null
Driver executing a READY/IN_TRANSIT line-haul trip cannot receive a pickup/delivery assignment and vice versa
Arrival requires Admin or active Warehouse Staff at the exact destination; Dispatcher/wrong warehouse is rejected
Arrival does not receive Shipments; receive before ARRIVED is rejected for trip-associated transfers
Concurrent/retried Arrival releases Vehicle once; concurrent/retried Receive completes transfer/shipment once
G2 integration continues through AT_DESTINATION_WAREHOUSE to AWAITING_DELIVERY_ASSIGNMENT with manifest history preserved
Phase G2 migration enforces departed/arrived timestamp consistency and does not introduce a trip COMPLETED status
Owned active LINE_HAUL Driver can write trip GPS; other/no-capability/suspended Drivers are rejected
Line-haul GPS rejects PLANNED, READY and ARRIVED trips without Redis write or Socket broadcast
Redis line-haul current location uses `linehaul:trip:location:{tripId}` with TTL 20 seconds
Redis write failure returns service unavailable and emits no `linehaul.location.updated`
Redis read failure returns `UNAVAILABLE` map state without HTTP 500
Line-haul location at or beyond 20 seconds is `STALE` and never renders as current marker
Customer, unrelated Driver and unrelated Warehouse Staff cannot read/subscribe to trip location
Admin/Dispatcher and origin/destination Warehouse Staff receive only their authorized trip event
Arrival deletes current key best-effort, emits `linehaul.trip.ended`, evicts room and rejects later GPS
Last-mile `OUT_FOR_DELIVERY` customer GPS room/event behavior remains unchanged
REAL and development SIMULATION both traverse authenticated API → Redis → Socket → Map
Line-haul READY snapshots origin → destination planned route metric once with nullable legacy fields
Line-haul provider failure cannot corrupt READY transition; dispatch/retry preserves planned snapshot
IN_TRANSIT trip detail uses only current authorized line-haul GPS for remaining distance/ETA
Valid provider geometry is normalized to latitude/longitude points; malformed, missing, invalid and excessive geometry is rejected
READY creates exactly one planned route v1; retry/dispatch never duplicate or overwrite it
Disabled/unavailable provider keeps READY functional with null geometry and no invented road polyline
On-route and GPS-noise samples follow the configured threshold plus 3-consecutive-sample policy
Stale GPS or missing geometry returns deviation UNKNOWN; deviation Socket events emit only on state change
Only Admin/Dispatcher can reroute; Customer, Driver and unrelated Warehouse actors are rejected by backend authorization
Reroute provider failure or ARRIVED status leaves the current route unchanged
Concurrent reroutes commit one next route version; original planned v1 remains append-only history
Route update Socket invalidates authorized clients; Customer cannot view or subscribe to route operational data
PostgreSQL + Redis + Socket E2E covers ON_ROUTE → DEVIATED → reroute v2 → ON_ROUTE → ARRIVED and rejects later reroute
Playwright verifies route polyline, realtime marker, deviation warning, confirmed reroute/polyline update, Warehouse scope and mobile Driver layout
Vehicle capacity create/update requires a positive integer; zero, negative and missing values are rejected
Legacy vehicle without capacity is excluded from eligibility and cannot create an operational trip
Capacity cannot be reduced below an active manifest and cannot change while vehicle is IN_USE
Manifest below capacity and exactly at capacity succeeds; over by one gram rejects without association or success audit
Inactive association is excluded and remove lowers current manifest weight correctly
Concurrent adds serialize on the trip row so at most one request commits when both would overload
READY and dispatch revalidate integer weight capacity; overload leaves lifecycle/snapshots untouched and READY retry is idempotent
READY snapshots preserve prepared manifest/capacity after a completed trip's Fleet capacity changes
Wrong-role actors cannot mutate Fleet capacity or a trip manifest
Playwright verifies capacity/transfer weights, add/remove utilization, disabled overload candidate, stale-submit backend error, exactly-full READY lock and responsive Dispatcher/Warehouse views
Schedule rejects missing/reversed/zero-length windows and only accepts a PLANNED trip
Driver and Vehicle overlap use `newStart < existingEnd && newEnd > existingStart`; non-overlap and exact adjacency succeed
Concurrent schedule reservations for the same Driver/Vehicle produce exactly one winner at PostgreSQL constraint level
Concurrent reschedule of one trip produces one expectedVersion winner; losing request cannot overwrite the committed window
Unschedule releases only the reservation, preserves trip/manifest, is audited, and retry does not duplicate audit
Future reservation leaves Vehicle AVAILABLE; only Dispatch changes it to IN_USE
READY requires a schedule and READY/reschedule races cannot create an invalid overlap
READY and Dispatch reject a Driver suspended/capability-removed or Vehicle maintenance/inactive after scheduling
Schedule availability returns AVAILABLE/BUSY/UNAVAILABLE with conflicts, while command validation remains backend-authoritative
Customer/Driver/Warehouse Staff cannot mutate schedules; Admin/Dispatcher can; Warehouse list/board stays origin/destination-scoped and Admin sees the network
Playwright verifies busy resources, adjacent-window scheduling, schedule board, reschedule, unschedule and responsive layout without manual UUID input
G3C3 scoring is deterministic across input order and exposes a stable point breakdown/tie-break order
Planning excludes wrong-route, non-pending, already-associated or not-at-origin WarehouseTransfers
Planning excludes suspended/inactive/no-capability/active-last-mile/executing-trip Drivers and unavailable/invalid-capacity Vehicles
Every recommendation is conflict-free for its half-open window and manifest weight never exceeds Vehicle capacity
ROAD_ROUTE duration drives the suggested window when available; provider disabled/missing ETA uses the documented 180-minute fallback without fabricating ETA
Planning recommendation endpoint is Admin/Dispatcher-only; Customer/Driver/Warehouse Staff are rejected
Create Trip from a reviewed recommendation atomically revalidates route, resources, window, transfer ownership/state/location and capacity; stale data rolls back without a partial trip
Playwright verifies recommendation reasons/metrics → prefilled Create Trip → explicit Dispatcher confirmation → PLANNED trip with schedule and manifest; no automatic dispatch
Playwright verifies SENDER pickup and RECEIVER successful-delivery collection, inline exact-amount validation, role-visible payer/status and visually separate Shipping Fee/COD surfaces
Collected shipping fee remits only by its collector with the exact positive integer VND amount
Shipping-fee remittance rejects wrong actor, wrong amount and invalid state without mutation/audit
Duplicate remittance and settlement retries return committed state without duplicate audit
Only Admin can reconcile; settlement accepts only `REMITTED` with exact collected/remitted amounts
Shipping-fee dispute requires a reason, preserves append-only source-state history and blocks direct settlement
Resolve command requires a resolution note and restores exactly `COLLECTED` or `REMITTED` before lifecycle continues
Reconciliation search/payer/status filters and PostgreSQL aggregates return correct counts/totals
Driver ledger exposes only fees collected by that Driver; Customer payload never exposes financial actors/dispute/audit
Shipping-fee remittance/dispute/settlement never changes COD amount or status
Playwright verifies Driver remittance, Admin filter/dispute/resolve/settle, Customer privacy/RBAC and distinct Shipping Fee/COD surfaces
Owned payer can create one shipping-fee payment with an idempotent client request key
SENDER payment is eligible only at pickup payment lifecycle; RECEIVER only at delivery payment lifecycle
Valid signed webhook with exact amount/reference atomically marks payment succeeded and shipping fee PAID
Invalid signature, wrong amount, wrong provider reference and wrong shipment/payment ownership never mutate payment or fee
Duplicate callback is idempotent; reused event ID with different payload is rejected as replay conflict
Browser payment return/result GET never mutates payment or shipping-fee state
Provider timeout preserves Shipment and durable payment state; retry with the same key creates no duplicate active payment
Signed provider failure returns the fee to PENDING for a safe second attempt
PAID shipping fee satisfies pickup/delivery without cash collection; a supplied cash amount is rejected as duplicate
SENDER/RECEIVER online payment never changes COD amount/status or combines the two ledgers
Playwright verifies CTA → pending result → signed webhook → success → paid Shipment detail while COD remains unchanged
```

---

## DEFINITION OF DONE
Feature chỉ DONE nếu tất cả mục áp dụng được đều pass:
```
business rule correct · authorization correct · validation correct
database migration correct · audit/tracking created · UI completed
responsive checked · loading/error/empty handled · tests passed
typecheck passed · build passed · Swagger updated
```

---

## BUGFIX RULE
Khi sửa bug, xác định rõ 4 mục:
```
Root Cause
Broken Invariant
Correct Fix
Regression Test
```
Nếu bug liên quan business rule → fix backend (source of truth) trước. Không patch UI để che lỗi backend.

## Phase I1 audit verification

- Replay **all 25 SQL files as migration scripts**, not by splitting on semicolons: H2/H3 must commit enum additions before constraints reference the new values. `backend/scripts/audit-migration-replay.mjs` accepts two empty disposable localhost `i1_*` databases via `AUDIT_DATABASE_URL` and `AUDIT_SHADOW_DATABASE_URL`, refuses reset, and compares the resulting catalog. This is additional evidence, not a substitute for Prisma deploy/status/schema drift checks.
- `backend/scripts/audit-migration-history.mjs` performs a READ ONLY transaction against configured development and reports successful migration/checksum differences without printing connection secrets. It never repairs history.
- `backend/scripts/audit-e2e.mjs` runs every `backend/test/*.e2e-spec.ts` sequentially against a disposable localhost `i1_*` PostgreSQL database and dedicated Redis port 56379. It clears only that audit Redis's rate-limit keys between suites; production throttles are unchanged.
- Full Playwright uses a separate audit PostgreSQL database and Redis `127.0.0.1:56379/1`; `I1_AUDIT=true` enables guarded test-only rate-budget reset. Test fixtures include H1 shipping-fee ledgers and send exact collection amounts; route assertions match the explicitly configured OSRM test server. GPS is refreshed through the real API before reroute when UI assertions exceed its 20-second TTL.
- Regression coverage: revoked/suspended Socket sessions fail closed at subscribe and publish; changed warehouse scope leaves old rooms; DB auth failure drops delivery; API refresh/cookies across tabs share only transient session state. G3A's multiple pages exercise refresh + Socket continuity and assert no map page errors.
- `backend/scripts/audit-production-smoke.mjs` starts actual `dist/main.js` on localhost:3101 with production validation, REAL infrastructure and both providers DISABLED. It verifies health, protected APIs/RBAC, secure cookies, trusted-origin enforcement, disabled payments/webhooks, socket revocation, spoofed proxy IP rejection, rate-limit seconds and absence of request secrets in captured logs. Set only dedicated `AUDIT_DATABASE_URL`/`AUDIT_REDIS_URL`; it refuses external targets. Windows termination does not prove target-platform graceful shutdown.
- `backend/scripts/audit-secrets.mjs` scans workspace product files and all reachable Git revisions for tracked env/private keys/high-confidence token/Neon credential patterns; output contains paths only. It is a heuristic scan, not a proof that every possible secret format is absent.
- Release evidence and unresolved external checks are recorded in [PRODUCTION_READINESS_I1.md](PRODUCTION_READINESS_I1.md). Never claim a skipped/blocked Prisma engine, production SMTP connection, reverse proxy or deployment artifact was verified.
