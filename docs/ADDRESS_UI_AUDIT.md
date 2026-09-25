# Canonical address UI audit — 2026-09-22 (final verification 2026-09-25)

## Inventory and changes

Full frontend/backend source search covered `address`, `streetAddress`, `street`, `city`, `province`, `ward`, `district`, `latitude`, `longitude`, `lat`, `lng` (98 matching source files excluding the vendored JSON). Follow-up inspection covered production TSX forms, API mappers, DTOs, browser fixtures and operational readers.

| Surface | Before | Result |
| --- | --- | --- |
| Customer Saved Address create/edit | Shared selectors/search/map already present | Retained and regression tested; legacy contact-only edits preserve address |
| Create Shipment delivery address | Shared selectors/search/map already present | Retained; pickup comes from selected Saved Address and backend immutable snapshot |
| Edit Shipment | No production address editor | Historical snapshots remain read-only |
| Quote | Reuses Shipment form fields | Same selectors/search/map; optional delivery coordinate contract retained |
| Admin Warehouse create | Free-text city/ward/district and editable latitude/longitude | Shared administrative selectors + LocationPicker; explicit confirmation required for new warehouse |
| Admin Warehouse edit | PATCH API existed, no UI | Added Sửa kho/Lưu thay đổi/Hủy sửa using the same form and helpers; loaded pin is bound to original fingerprint |
| Warehouse workspace, check-in, sorting, destination routing, transfers | Select existing warehouses or display shipment snapshots | No address creation/free-text administrative editor |
| Admin Driver operating warehouse | Select existing Warehouse | No arbitrary administrative input |
| Line-haul create/planning/schedule/manifest/receive | Select existing origin/destination Warehouse | No address editor or new warehouse snapshot form |
| Profile, registration, login, Admin User/Staff | Identity/contact fields | No postal address fields |
| Tracking, driver/dispatcher maps, shipment details | Read-only coordinates/address; browser GPS | No editable address coordinate fields |

## Canonical rules and reuse

- Administrative locality = select from canonical dataset. All four address surfaces reuse `AdministrativeAddressFields`, `SearchableSelect`, `administrative-model.ts`, and the existing 34/3,321 vendored dataset. Code-valued selector options resolve to existing API name fields. No new dataset/provider/dependency.
- Street/house = explicit geocode search + selected result/manual pin. Typing sends zero requests; Search sends one request. Results create a draft; only Confirm commits. Provider text cannot overwrite administrative selection.
- Coordinate = map/provider generated, never manually typed. Reuses `LocationPicker`, `AddressSearch`, `LocationMap`, viewport resolver, `getAddressFingerprint` and `getConfirmedCoordinate`.
- New Warehouse uses `district = ''` in payload; existing Warehouse service stores empty optional locality as null. Legacy district is read-only and cleared when choosing a new hierarchy. Name-only edits retain legacy address/coordinate; address changes require canonical selection and a fresh confirmation.
- `warehouse-form.ts` is a Warehouse API adapter/validation boundary, not a duplicate selector/geocoder/fingerprint implementation. It validates again before serialization and never sends fingerprint metadata to the API.

## Backend and invariants

- Warehouse create/update DTO coordinate pairs now require JSON numbers, finite values, latitude [-90,90], longitude [-180,180], max six decimals; partial/null pairs are rejected. Omission remains supported for the existing optional legacy contract.
- Warehouse address PATCH without a supplied coordinate pair is rejected before update/audit, under the existing optimistic transaction/version mechanism. Name-only edits remain compatible.
- Existing address-search endpoint permits ADMIN as well as CUSTOMER so the Admin Warehouse flow can reuse it. JWT/session/role guards, throttling, backend-only key, Vietnam restriction, normalization and provider remain unchanged; other roles still cannot search.
- C01 backend validation, C04 scoped authority, C08 immutable Shipment snapshots and C16 single-source helpers remain enforced. No migration, lifecycle, ranking, auth mechanism, pricing or COD change.

## Exceptions and limits

- **No production free-text city/province/ward/district editor or editable address lat/lng remains.** SearchableSelect has a search text box but only commits a dataset option. Street input is a search query/manual-pin description, not an administrative unit.
- Legacy locality strings can still display and survive metadata-only edits. Internal map fixtures deliberately accept arbitrary coordinates to exercise invalid/stale cases; operational GPS is device-generated, not an address editor.
- Existing Saved Address coordinates and delivery coordinates retain their optional backend contract. Warehouse UI requires confirmation for create/address edits; unchanged legacy warehouses without a pin may still receive a name-only edit. Missing geo continues to fail existing distance eligibility safely.
- Fingerprints prevent reuse of an old pin after changing the address. They do **not** prove a manually chosen pin lies inside an administrative boundary, nor certify old stored pins. The vendored dataset contains approximate points, not administrative polygons. No guessed distance radius or new geographic business policy was introduced; operators must verify the pin.
- Local browser tests intercept API/provider responses and abort OSM tiles. They do not prove live LocationIQ accuracy or staging deployment.

## Verification

| Check | Result and scope |
| --- | --- |
| Backend focused unit/HTTP | **118/118**, eight suites: Warehouse DTO/service, address search HTTP/provider, Saved Address, Shipment, assignment candidates, Quote DTO |
| Frontend unit | **51/51**, includes new Warehouse canonical/fingerprint/legacy adapter tests |
| PostgreSQL E2E Phase 2/3/4 | **8/8**, three suites; isolated local `warehouse_verify_1790061997605`, canonical migrations replayed only into disposable local DB; Redis/GPS mocked |
| Browser `--search` | **PASS** at 375×812, 812×375, 768×1024, 1440×900; all four form surfaces, explicit search/draft/drag/confirm, stale rules, payloads, fallback, no overflow |
| Browser `--direct-search` | **PASS** at the same four sizes, includes Warehouse; provider numeric coordinate submitted without map adjustment, metadata-only edit, reload, street/ward stale blocking, province reset |
| Workspace lint/typecheck/build | **PASS**; backend `dist/main.js` and frontend production bundle built |
| Final source search/diff check | **PASS**; no production manually editable locality/coordinate fields; capacityWeightKg search hit is unrelated cargo weight |
| Staging route smoke | `/admin/warehouses`, `/addresses`, `/shipments/new`, `/quote`: HTTP 200 on 2026-09-22. Only SPA route availability; changes not deployed and authenticated business smoke **NOT VERIFIED** |

Browser commands: `node frontend/test/address-location/check.mjs --search` and `--direct-search`. Screenshots: ignored local `frontend/.vite/address-location/warehouse-375.png` and `warehouse-1440.png`. Browser API/provider interception is explicitly separate from real PostgreSQL E2E evidence; no live-provider/map accuracy claim.

Unit coverage: `frontend/test/warehouse-address.test.mjs`, backend `warehouse-coordinate.dto.spec.ts`, `warehouses.service.spec.ts`, and Admin search HTTP coverage. Phase 4 E2E verifies changed-address rejection, numeric update/GET/database reload before continuing existing operating-warehouse/assignment/warehouse workflow. Phase 2/3 preserve Saved Address persistence, immutable pickup geo snapshot and candidate ranking coverage.

Initial runs hit sandbox spawn EPERM and were retried with approval. Local Docker was started for isolated E2E. Initial new fixture label encoding and lint formatting failures were corrected before the passing runs. No deployment or remote database write was performed.
