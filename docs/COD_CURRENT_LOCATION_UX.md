# COD and current location UX — 2026-09-27

## Implementation and audit

- Delivery already creates one `COLLECTED` COD row atomically for a positive shipment COD amount. `PENDING` is the conceptual pre-collection stage; no COD row is created at shipment creation. Zero COD has no workflow.
- Driver had a remit command but no UI. Added `/driver/cod` and ownership-scoped `GET /cod/mine`, reusing the COD table, canonical badges and confirmation dialog. Only collected entries offer exact-amount handover; existing backend ownership, conditional updates and amount/dispute rules remain authoritative.
- Admin settlement remains `REMITTED → SETTLED`. Fixed the success handler: the actual command response has no `shipment` relation. Both commands invalidate relevant local queries. Customer dashboard/detail refetch every 30 seconds while open; normal focus/refetch also applies.
- Dashboard SQL already sums expected amounts where COD status is not SETTLED. Remit preserves outstanding COD; settle reduces it. Customer detail now reads current COD status with the ownership check, even on a shipment cache hit. Existing fee ledger remains separate.
- Added the requested Customer explanation and readable COD badges. SETTLED is “Đã quyết toán”; there is no Customer payout claim or payout implementation.

## Current location

- Shared LocationPicker covers Saved Address, Shipment delivery, Quote and Warehouse create/edit. Current Location appears beside Search and remains usable after empty/error search.
- Extracted Driver's unchanged `locateBrowserPosition` into `browser-location.ts`: fresh, high-accuracy browser acquisition, maximumAge 0, timeout 15 seconds, device timestamp retained. Driver publisher keeps its 5-second interval, 20-second freshness and authenticated publication logic.
- Customer/Admin import only device acquisition. No Driver location endpoint, simulation source, reverse geocoding, administrative selector write or guessed address.
- GPS sets a draft marker, centers at zoom 16, rounds to six decimals and requires Confirm before form state/persistence changes. Existing address fingerprint rules invalidate coordinates after street/ward/province changes. Late callbacks after edits, cancellation, alternate selection, disabling or unmount are discarded.
- Denied permission explains browser/device settings. Timeout/unavailable offer retry/search/manual pin. Loading is announced and repeated clicks are disabled. Search/manual pin remain available.
- Area mismatch is advisory: distance from canonical ward point >20 km, or province point >200 km when no ward point exists. Dataset has points, not boundaries; this is deliberately a warning, never proof of containment, selector mutation or save prohibition.

## Validation

- Backend unit: **433/433 PASS**, including COD commands, delivery collection, ownership-scoped list and current COD over cached shipment detail.
- Frontend unit: **64/64 PASS**, including browser acquisition/options/errors, area warning, address fingerprint/serialization and Driver GPS publisher regressions.
- Real PostgreSQL/Nest integration: **4/4 PASS** via `node backend/test/cod-location-local.mjs`. A new isolated localhost database was created and existing migrations replayed only there. Redis mocked. Delivery retry creates one COD; remit leaves outstanding 275,000 VND; Admin settle reduces it to 0; fee remains collected at 30,000 VND. Role restrictions, concurrent transitions/audit, amount mismatch, and six-decimal Saved Address API save/reload are checked.
- COD browser: **PASS** at 375×812, 812×375, 768×1024 and 1440×900. Driver confirmation/remit, Admin error/retry/settle using actual response shape, Customer dashboard/detail and no page errors.
- Driver GPS browser lifecycle: **PASS** at the same four viewports (login, online/offline, route persistence, cadence, no duplicate loop, stale/recovery, denial/retry, suspension, logout).
- Current-location browser: **PASS** at all four viewports; shared forms, empty-search GPS placement, exact coordinate draft/confirmation, map center/zoom, unchanged selectors, save/reload, stale invalidation, error and callback scenarios. Run `node frontend/test/address-location/check.mjs --current-location`.
- Workspace lint/typecheck and production builds **PASS**. Existing Vite large-chunk warning remains. Initial fixture-only failures (missing route parameter/payment response and Decimal comparison) were corrected before passing runs.

## Scope and staging

Primary changed files: backend COD controller/service and shipment response/read; frontend COD API/page/routes/navigation, Customer dashboard/detail/badges, browser-location helper, Driver provider, LocationPicker/AddressSearch/viewport; regression fixtures/tests; DOMAIN/UI/PROJECT_STATE documentation.

Preserved C01/C04/C08/C09/C10/C16: backend authority/ownership, independent integer money ledgers, append-only business history, atomic transitions and concurrency checks, shared policy/component reuse. No new dependency, schema migration, production write or deployment.

**Staging BLOCKED / NOT VERIFIED:** this working-tree change has not been deployed or authenticated on staging. Browser tests use explicit device GPS and HTTP fixtures; isolated PostgreSQL verifies persistence separately. Real-device GPS, permission UX and the multi-account COD journey on deployed staging remain release checks.
