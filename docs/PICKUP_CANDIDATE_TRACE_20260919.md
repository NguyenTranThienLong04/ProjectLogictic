# SHP-20260918-36AC6EF3 candidate trace

## Final verified result — 2026-09-19 12:30 UTC; report finalized 2026-09-20

**Shipment `SHP-20260918-36AC6EF3`: DELIVERED, version 12. Business E2E through delivery completed on staging.** This section supersedes every historical status/blocker below. No workflow, GPS policy, provider or staging DB/Redis direct write was used to obtain this result. On 2026-09-20 the three previous CDP sessions were unavailable; these are persisted 2026-09-19 observations, not fresh live reads.

| Stage | Result | Evidence |
|---|---|---|
| Pickup assignment | PASS | `4849e9e1-28f6-410f-804a-9a97e88a9fef`, COMPLETED; verified without repeating pickup |
| Pickup proof | PASS | `4d80f2aa-0281-4bfc-913c-21ead66b02b0` |
| Origin check-in | PASS (functional) | HTTP 200 `772cbe56-b34b-473c-bc8c-fe8927c91a61`, correct origin staff |
| Sorting | PASS | HTTP 201; audit `dda4f1d7-9174-4af3-8eb0-8f696e86ecf9` |
| Transfer create | PASS | HTTP 201 `d6950abf-c1ed-48fd-b526-764053abd78f`, `TRF-MU82IMF8-AER4` |
| Transfer dispatch | PASS | HTTP 200 `a5a65c29-d67f-4423-ab82-ab7a750738eb`, IN_TRANSIT |
| Destination receive | PASS | HTTP 200 `12ba27e7-7202-4846-b58e-de066db42987`, transfer COMPLETED |
| Ready | PASS | HTTP 201 `ee240380-65c4-4abe-a763-eb24abac4516` |
| Delivery ranking | PASS | HTTP 200 `356be6fb-cc96-4a34-9861-323f8868fad3`; matching driver/warehouse, 14218 m HAVERSINE_FALLBACK, ETA null |
| Delivery assignment | PASS | Actual DISPATCHER UI HTTP 201 `4651b611-8703-42a5-adbe-9625a76a1376`; assignment `c57cf35f-8ea7-43b0-8440-25a6214e3ff5` |
| OUT_FOR_DELIVERY | PASS | Driver start HTTP 200 `533012cb-ec70-4d2e-9d1b-0cf9a6e887d6`; canonical command accepts assignment and starts attempt atomically |
| DELIVERED | PASS | Complete HTTP 200 `856e7c5b-6159-4dd7-a9cb-426dea9f5681`; assignment COMPLETED, attempt `cb024554-be8f-48e5-85a9-2fb66decdb7d` DELIVERED; POD `84d7bc9b-0388-49a7-a7f9-ff9213649d5b` |
| LocationIQ real | PASS | Search HTTP 200 `dd3288a0-6fd8-42b2-9f83-d1cac8d3a655`; explicit Confirm/save HTTP 201 and GET persistence; detailed checks below |
| Driver OSM map | BLOCKED_NETWORK | Actual tile requests below fail `net::ERR_CONNECTION_REFUSED`, no HTTP status |

Real browser GPS became available at 12:25:31.048Z (request `0c1d49cc-f453-4898-a3e7-e86a5c3bf538`) and 12:26:01.621Z (`05269fcd-afd5-42de-a43d-cab5635a30b2`). An initial assignment attempt was correctly rejected after GPS expired; no assignment committed. A later current point at 12:26:59.987Z passed candidate calculation at 12:27:17.024Z and assignment. No coordinates were injected/emulated, no TTL/ranking rule changed. Redis PTTL was not directly measured. Earlier real-GPS blocker is resolved.

Independent final operational GET 200 `12e88a60-bef5-4864-ade7-79f92ef7f918` confirms DELIVERED/version 12. Public tracking GET 200 `9b8a3d87-726f-4038-8a44-dc899079c587` preserves all 13 timeline events. COD dashboard GET 200 `1eb0511f-a40b-46fd-ba3c-d68c9dd91268` returns one target COD `247271de-d170-4b9f-b2ab-2b16fd768fde`, COLLECTED with expected=collected=500000 and the correct Driver. Shipping fee remains COLLECTED 32500 since pickup; no second collection. COD remit/settle not performed. Warehouse measurement and POD notes explicitly describe staging test actions, not physical measurement/handover.

Exact actual Driver-map Request URLs observed before code changes:

- `https://a.tile.openstreetmap.org/14/13052/7693.png`
- `https://b.tile.openstreetmap.org/14/13053/7693.png`
- `https://c.tile.openstreetmap.org/14/13053/7694.png`

All fail `net::ERR_CONNECTION_REFUSED` without an HTTP response. Canonical-host probes also failed. Connectivity blocker remains; no provider, pickup/GPS or Leaflet lifecycle change.

Two local security fixes remain **NOT DEPLOYED**: Warehouse nested User credential disclosure (restrict Prisma select and explicit response allowlist), and cross-account QueryClient reuse (clear/cancel before identity change, preserve same-user refresh). Files and test details are recorded below. Backend focused 34/34, isolated PostgreSQL Phase 4 6/6, frontend 49/49, production-built local browser cache regression, workspace lint/typecheck/build and diff checks PASS. Local browser APIs were intercepted; these tests do not prove deployed fixes.

Observed staging frontend asset `index-BgAZIHmF.js`, SHA-256 `505f3b644ddfe744bf8718267a00df484185d37b9972b63a0f50a1cba5943997`; exact deployed frontend/backend commits remain unknown. Local HEAD `c6db718855e930a764aa62d04eb6c17b3a57d6d0` plus uncommitted fixes is not the deployed identity.

Remaining: provision deployment access, deploy fixes and rerun staging security regressions; establish deployed commits; restore OSM connectivity. **Business E2E to DELIVERED achieved; overall staging release PASS not achieved.** Sanitized final evidence: `test-results/staging-final-ledger.json`, `test-results/staging-final-summary.json` and per-action `staging-*.json` (ignored local artifacts).

## Historical checkpoint — 2026-09-19 12:22 UTC (superseded above)

**Current shipment: `AWAITING_DELIVERY_ASSIGNMENT`, version 9, at destination `6e532c07-0c6d-497d-b68c-d4f0041a53d3`. Warehouse flow completed on the actual staging UI/API. Delivery remains `BLOCKED_REAL_GPS`; no fake GPS or direct staging DB/Redis writes.** This section supersedes all earlier blockers/status summaries below.

### Business evidence

| Stage | Result | Evidence |
|---|---|---|
| Pickup assignment | PASS | Driver assignment `4849e9e1-28f6-410f-804a-9a97e88a9fef`, PICKUP/COMPLETED, completed `06:52:40.125Z`; authenticated Driver GET 200, request `f6601fc8-4e32-42cf-8908-88dae03c7dd6` |
| Pickup proof | PASS | Existing PICKUP proof `4d80f2aa-0281-4bfc-913c-21ead66b02b0`; same Driver API response. No repeat pickup command |
| Origin check-in | PASS (functional) | Origin staff `6e466c1e-b213-4fad-a8d7-e80da9094f73`, warehouse `093a9a5c-7f23-4a67-b68c-b7d3065118e8` / `G3A-ORG-0ED67A782B72`; UI scan and explicit verification, POST 200 `772cbe56-b34b-473c-bc8c-fe8927c91a61` → AT_ORIGIN_WAREHOUSE |
| Sorting | PASS | Chosen active HCMC hub `6e532c07-0c6d-497d-b68c-d4f0041a53d3` / `G3A-ORG-B8225AFFD8A8`, matching delivery city. Route command HTTP 201; audit `dda4f1d7-9174-4af3-8eb0-8f696e86ecf9` records exact destination, shipment remains AT_ORIGIN_WAREHOUSE |
| Transfer create | PASS | `f0fadf58-dca0-4279-9737-c50465972232` / `TRF-MU82IMF8-AER4`, HTTP 201 `d6950abf-c1ed-48fd-b526-764053abd78f`, PENDING, shipment still at origin, lineHaulTrip=null |
| Transfer dispatch | PASS | HTTP 200 `a5a65c29-d67f-4423-ab82-ab7a750738eb`, transfer/shipment IN_TRANSIT; audit `ab4a1285-2f81-422b-b04c-4513cc48cc98` confirms currentWarehouseId=null |
| Destination receive | PASS | Authenticated destination staff `70304f2a-8ffc-4b2b-a7e2-232bed9d137c`; HTTP 200 `12ba27e7-7202-4846-b58e-de066db42987`, transfer COMPLETED and shipment AT_DESTINATION_WAREHOUSE |
| Ready for delivery | PASS | HTTP 201 `ee240380-65c4-4abe-a763-eb24abac4516` → AWAITING_DELIVERY_ASSIGNMENT; destination/current warehouse match |
| Delivery candidate ranking | BLOCKED_REAL_GPS | HTTP 200 with candidates=[], noCurrentLocation=1, noOperatingWarehouse=5; latest request `1be394f8-db5d-4033-9c54-9d60c9f002a6` |
| Delivery assignment / OUT_FOR_DELIVERY / DELIVERED | BLOCKED_REAL_GPS | No commands attempted without an eligible candidate |

Check-in test inputs are declared package values: 1000 g, 20×15×10 cm. The command note explicitly says these are staging test values, not a physical measurement. Shipment snapshots, pricing and pickup history were not backfilled. SENDER shipping fee remains COLLECTED for 32,500 VND; COD remains 500,000 VND, not yet collected.

Independent final reads: operational shipment GET 200 `bdc1ed79-7dcf-402b-b717-f2919f665459`, public tracking GET 200 `2a018c8d-0d8b-47c1-af1b-099a3b771d55`. Admin audit reads 200 `030bf42d-877b-4374-871b-465cc5838394` (shipment) and `33375164-45ff-465f-b84d-864209707548` (transfer) show separate check-in/sorting/ready and create/dispatch/receive actions by the correct WAREHOUSE_STAFF actors, with preserved before/after state. No direct staging database connection was used.

### GPS and map

Actual pickup-detail tile capture (not only a diagnostic probe): `https://a.tile.openstreetmap.org/14/13052/7693.png`, `https://b.tile.openstreetmap.org/14/13053/7693.png`, `https://c.tile.openstreetmap.org/14/13053/7694.png` all fail `net::ERR_CONNECTION_REFUSED`, with no HTTP response. All four a/b/c/canonical OSM probes below also fail. Reproduced again on the address picker at 12:19 UTC. **BLOCKED_NETWORK**; no provider, canonical-host, Leaflet/container, GPS or pickup code change.

Admin prepared the existing AVAILABLE/online PICKUP+DELIVERY Driver for the chosen destination using only `PATCH /drivers/9f42eec6-5bba-45e5-8999-e3bb1d2d2f99` operatingWarehouseId, HTTP 200 `883d129c-87a9-4fe5-995a-625bf6906e7c`. Snapshot origin remains the original warehouse. Driver GET confirms destination scope and availability, request `903b26f3-99fd-4797-93e4-788b12cfa4a7`.

After restarting closed browsers and manual Driver/Customer login at 12:15 UTC, native `navigator.geolocation.getCurrentPosition` with granted permission/no coordinate override returned code 3 `Timeout expired` (15s). Authenticated current-location GET remains null, latest HTTP 200 `da3151ca-70ae-4f18-8d8d-c903b0e4103b`. Redis PTTL was not read because a matching deployed Redis binding is not provisioned locally; no current GPS/TTL PASS is claimed. User was asked only for a real GPS-capable device. Earlier 07:21 UI displayed current location, but that sample is no longer valid and cannot authorize delivery now.

### Staging geo and real LocationIQ

- Original Customer address `31ffa1a5-21cf-4141-9539-3ad2fac8e857` GET 200 `46cec171-c877-4bd4-b27a-bdc2ae19208a`: lat/lng `10.878105,106.810129`, exactly matching the target shipment pickup snapshot. Historical pickup assignment is verified; a fresh pickup candidate ranking on this already-picked-up shipment was not repeated or fabricated.
- Editing the original street immediately invalidated the confirmed coordinate. Clicking Save displayed the stale-coordinate error with **zero address writes and zero provider searches**; cancelled the draft, preserving the original address.
- Created a separate non-default QA address through the real UI. Typing/selecting street+ward+city made zero searches; one Search click made exactly one authenticated `POST /locations/address-search`, HTTP 200 `dd3288a0-6fd8-42b2-9f83-d1cac8d3a655`. Real response: LocationIQ result `257111377`, Tân Lập / Đông Hòa, normalized numeric `10.878105,106.810129`. No key logged, no API interception/mocks.
- Result selection rendered one draft marker with zero writes before Confirm. Confirm → Save made exactly one POST, HTTP 201 `7a4f1656-af66-4dd8-8ac7-a9feefbbc120`. Payload latitude/longitude are numbers with ≤6 decimals. New address `d0347bf6-8bae-4fb5-a6a5-47aa5ef8fe32`, label `Staging E2E LocationIQ 20260919`, isDefault=false. GET 200 `97e16320-9af5-4d88-a928-a26fde586604` confirms persistence; original default address unchanged. **LocationIQ staging real PASS**, not a claim of house-number precision from a street-level provider result.

### Reproduced defects and local fixes

1. **C15 credential disclosure in Warehouse responses.** Staging lookup/check-in/inventory response includes `driverAssignments[].driver.user.passwordHash` and authentication metadata. Root cause: `warehouseShipmentInclude` loaded `user:true`, and `serializeShipment` returned raw driverAssignments. Local fix restricts user selection and explicitly serializes permitted assignment/driver/user fields. Evidence artifacts sanitized; sensitive values must not be copied into reports. Baseline regression failed on synthetic canaries; after fix 34/34 focused backend tests pass. Phase 4 PostgreSQL E2E 6/6 passes including response-leak assertions on lookup/check-in/retry/inventory.
2. **Cross-account Warehouse cache reuse.** Immediate logout/login as destination staff displayed the previous origin staff/warehouse while GET staff/me confirmed destination ownership. Root cause: application-wide QueryClient with 30s staleTime survived identity changes. Local fix clears query/mutation caches and cancels pending queries before publishing a different account/role/logout; same-account token rotation preserves cache. This changes cache ownership, not authentication/refresh rules. Frontend 49/49 tests pass; production-built browser regression with real AuthProvider/Warehouse UI and intercepted local API passes. That browser regression is not staging evidence.

Both fixes remain **local, NOT DEPLOYED**. No Render CLI, API/deploy-hook credential or deployment session is provisioned in the inspected project environment. Therefore neither security fix is claimed PASS on staging. Original Admin/Driver sessions also expired and returned to login during the run; refresh failure root cause has not been isolated and no authentication change was made for it.

Validation: focused backend test command (Warehouse + transition policy) 34/34; `node test-results/warehouse-db.mjs --run` replayed canonical migrations only into isolated local `warehouse_verify_1789803084802`, Phase 4 E2E 6/6; `npm run test --workspace frontend` 49/49; `node frontend/test/auth-cache/check.mjs` browser PASS; workspace lint/typecheck/build PASS; git diff --check PASS. Docker/Node/Vite sandbox EPERM were retried with approval; stopped local Docker/test containers were started, no remote DB used. Harness assumptions corrected for cached scan lookup and route command HTTP 201; invalid audit limit 100 was corrected to supported 50. These were verification-harness errors, not production defects.

### Build identity and remaining work

Observed deployed frontend asset `/assets/index-BgAZIHmF.js`, 265107 bytes, SHA-256 `505f3b644ddfe744bf8718267a00df484185d37b9972b63a0f50a1cba5943997`. Exact deployed frontend/backend commit is **unverified**; local base HEAD `c6db718855e930a764aa62d04eb6c17b3a57d6d0` plus uncommitted fixes is not a deployed commit.

Ignored, sanitized evidence: `test-results/staging-*.json`; temporary browser helpers keep authorization only in process memory. Production files changed: Warehouse response/service, frontend AuthProvider and auth-query-cache helper. Tests: Warehouse service spec, Phase 4 E2E, frontend auth-query-cache tests and auth-cache browser fixture/check. No DOMAIN/UI/TESTING contract changes.

Remaining: real current Driver GPS → delivery candidate/assignment/accept/start/complete with receiver POD and exact 500,000 VND COD; deploy the reviewed fixes with provisioned deployment access and rerun staging regressions; establish exact deployed commits. **Full E2E is NOT achieved.**

## Staging continuation — 2026-09-19 07:19 UTC

This section supersedes historical pickup blockers below. Public staging API `GET /api/v1/tracking/SHP-20260918-36AC6EF3` returned HTTP 200, status `PICKED_UP`, request ID `816701ed-6395-4fa1-a27d-42077c1d4bc4`. Timeline records assignment at `06:49:33.990Z`, pickup start at `06:50:58.859Z`, pickup completion at `06:52:40.125Z`. Private assignment completion, proof and origin snapshot still require authenticated verification; public tracking alone does not prove those fields.

Dedicated Chrome profiles launched and staging login pages verified at CDP 9224 (Driver), 9225 (Warehouse Staff), 9226 (Admin). No valid login session observed yet; manual Admin/Driver login requested without requesting secrets in chat. Warehouse account will be resolved through authenticated origin/staff API reads. No business mutation performed.

Browser image diagnostics at `2026-09-19T07:18:43.640Z`:

| Exact Request URL | Browser error | HTTP status |
|---|---|---|
| `https://a.tile.openstreetmap.org/12/3263/1923.png` | `net::ERR_CONNECTION_REFUSED` | No response |
| `https://b.tile.openstreetmap.org/12/3263/1923.png` | `net::ERR_CONNECTION_REFUSED` | No response |
| `https://c.tile.openstreetmap.org/12/3263/1923.png` | `net::ERR_CONNECTION_REFUSED` | No response |
| `https://tile.openstreetmap.org/12/3263/1923.png` | `net::ERR_CONNECTION_REFUSED` | No response |

These are independent image requests from the staging origin in the dedicated Driver browser, not a capture of the original pickup-detail requests. Current browser connectivity is blocked on all four hosts; no justification to switch provider/canonical host or change Leaflet lifecycle. Actual Driver-map request capture remains pending login.

Staging readiness HTTP 200 reports database/Redis up, request ID `f3f49121-6fdf-4780-a652-a2ce58ad9bc0`. Frontend entry asset observed: `/assets/index-BgAZIHmF.js`. Exact deployed commit is not established; local HEAD `c6db718855e930a764aa62d04eb6c17b3a57d6d0` must not be represented as deployed. Warehouse/delivery/LocationIQ verification remains pending authenticated access. No production/test code changed.

Read-only investigation on 2026-09-19. **Provisioning and authenticated staging assignment remain blocked by target/API credentials.** No service, policy, database row or Redis key changed.

## Latest execution: driver configured through staging API

Admin subsequently logged in again successfully (ADMIN/HTTP 200). Opened the Dispatcher pickup UI using its existing session without reload: target shipment visible with `0 ứng viên phù hợp khu vực có GPS hiện tại · 1 thiếu hoặc stale GPS · 5 không phù hợp khu vực`. Candidate API HTTP 200 still returns [] with noOperatingWarehouse=5/noCurrentLocation=1 (request `2065c2c1-f184-4fd6-a184-7a3e8ead9527`); latest Driver location read remains null (`a2861562-3e52-47cd-970e-3e589e99f0d3`). Admin access is no longer blocked. User acknowledged switching to a device/browser with working positioning; a successful GPS publish has not yet been observed. Do not interpret that acknowledgement as a location sample or a successful assignment.

Latest Driver login follow-up: manual login returned HTTP 200 with DRIVER role. `/drivers/me` HTTP 200 confirms the intended `9f42eec6-5bba-45e5-8999-e3bb1d2d2f99`, assigned HCMC warehouse, PICKUP+DELIVERY and AVAILABLE/online/available. `/driver/line-haul/active-trip` HTTP 200 returned null. Driver dashboard has zero pending/executing tasks. Browser geolocation permission is `granted`; Windows `lfsvc` is Running and both HKCU/HKLM location consent values are Allow. A native `navigator.geolocation.getCurrentPosition` diagnostic (no override) returned error code 3 / `Timeout expired` after 15 seconds. No frontend GPS POST was observed; `/driver/location` HTTP 200 returned null (request `bb203a59-51e0-4184-9924-f48b64083f63`), and Driver Map displays no current GPS. Thus actual device positioning is the current blocker, not capability/warehouse/availability. No TTL/ranking/assignment success claimed. Asked user to keep the driver logged in on a real location-capable device; reopened the Admin login tab at CDP 9222 after its previous tab disappeared. No geolocation emulation, manual location POST, Redis write or production fix performed.

This section supersedes the earlier read-only/provisioning-blocked status. Using the user's manually authenticated Admin browser session, the verified staging API returned the same target shipment/driver/warehouse identifiers. No development DB connection was used for writes.

- Before: actual candidate GET HTTP 200, candidates=[], missingCapability=0, noOperatingWarehouse=6, outsideOperatingArea=0, noCurrentLocation=0; request `f4ee9300-6884-4aef-ad0c-12676ac36b2a`.
- Selected `DRV_TEST_20260830`, `driver@test.com`, DriverProfile `9f42eec6-5bba-45e5-8999-e3bb1d2d2f99`, User `1fa91480-ed3e-4056-8dc6-7c1d770bd5bc`. User API confirmed ACTIVE/DRIVER; profile AVAILABLE/online/available with PICKUP+DELIVERY. Driver-filtered operational shipment list empty.
- Admin `PATCH /drivers/9f42eec6-5bba-45e5-8999-e3bb1d2d2f99` with only operatingWarehouseId committed HTTP 200 at `2026-09-19T03:27:42.717Z`; request `0ad55ba5-4cd8-4a81-affa-5cc533b9231c`. Warehouse `093a9a5c-7f23-4a67-b68c-b7d3065118e8`, `G3A-ORG-0ED67A782B72`, active=true, city `Ho Chi Minh City` (canonical match with pickup Hồ Chí Minh). No capabilities, availability, User or shipment fields mutated.
- After warehouse setup: actual candidate GET HTTP 200, candidates=[], noOperatingWarehouse=5, outsideOperatingArea=0, noCurrentLocation=1, missingCapability=0; request `402d3615-3332-469f-bf35-7acb03f5d556`. This proves the configured driver passed capability/warehouse/area and now needs current GPS.
- Opened a separate interactive Chromium browser at CDP 9223, staged at `/login`, granted geolocation permission without overriding coordinates. User prompted to manually log in as driver@test.com. No browser GPS POST or current Redis TTL observed yet; assignment not attempted and PICKUP_ASSIGNED remains NOT RUN.
- Admin reload encountered auth/refresh 401; after manual re-login, reused its in-memory session without reload for the API actions above. Later CDP 9222 no longer contained the staging tab; Admin browser session must be restored for UI assignment. No auth fix attempted. Temporary local CDP helper keeps authorization only in process memory and suppresses secrets from output; no credential file created.

## Environment evidence

- Latest CDP follow-up: successfully attached to user-specified `127.0.0.1:9222`. Initially no staging tab existed; opened the verified staging web app in that browser and requested manual Admin login. Latest page check remained at the public `/` landing page; no authenticated Admin session has yet been verified. This supersedes the earlier no-CDP blocker. No credential requested and no business mutation performed. Driver login will use a separate browser context to avoid replacing the Admin refresh-cookie session.

- Follow-up browser verification: launched a separate, unauthenticated Chromium context against the repository-documented staging web app. Browser Network observed frontend `POST https://logistics-staging-api.onrender.com/api/v1/auth/refresh`. Thus observed API base is `https://logistics-staging-api.onrender.com/api/v1`, not an inferred hostname. No response body, cookie, authorization header or secret was logged. This is not the user's authenticated browser session.
- Existing Chrome/Edge processes expose no `--remote-debugging-port`; no browser connector is available in this session. Local staging env files have no Admin/Driver credentials, Redis binding or browser storage-state reference; no matching provisioned session file was found in the project/evidence paths searched. The user was asked for the provisioned secret-file/store location and browser connection. Runtime DB/Redis binding remains unverified. Root development `.env` was not used for any mutation.
- Follow-up execution status: no driver selected/modified, no browser GPS publication, no current staging Redis TTL verified, no authenticated candidate-before/after, no distance result and no assignment executed. `PICKUP_ASSIGNED`: **BLOCKED / NOT RUN**, not PASS and not a demonstrated business failure. Browser/process probes required approved escalation after sandbox denials; the probes then succeeded.

- `.env.staging.runtime.local`: connected successfully; requested shipment absent and DriverProfile table empty. No Redis binding in this file.
- Root `.env`: requested shipment present; 15 DriverProfiles, of which exactly six pass the candidate service's initial availability/User/line-haul filter. Redis reads below use this same file. This connection is documented as development and its frontend setting is localhost; binding to the deployed staging API has not been established. Do not silently provision this database as staging.
- No authenticated deployed candidate response or browser session was available. Counts below are traced from live read-only SQL and repository policy, not claimed as a staging API response.

## Shipment and area

- ID: `95a4fe1e-d18c-456f-9863-1d0840f899d3`.
- Status: `AWAITING_PICKUP_ASSIGNMENT`.
- Pickup snapshot: street `69 tan lap`, ward `Đông Hòa`, district empty, city `Hồ Chí Minh`, latitude `10.878105`, longitude `106.810129`.
- `originWarehouseId = null`, `destinationWarehouseId = null`.
- Pickup target uses snapshot city and coordinates, with target warehouseId null. Each driver's active operating warehouse city is compared after the existing normalization. Neither shipment warehouse defines pickup eligibility.
- Existing active warehouses with city `Ho Chi Minh City` normalize to `ho chi minh`, matching the snapshot. Example: `G3A-ORG-0ED67A782B72`, ID `093a9a5c-7f23-4a67-b68c-b7d3065118e8`, coordinate `10.776900,106.700900`. No warehouse has been assigned to a driver during this investigation.
- No demonstrated city inconsistency: Đông Hòa is included in HCMC's 2025 administrative arrangement, item 79 of [Resolution 1685](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-1685-nq-ubtvqh15-sap-xep-cac-dvhc-cap-xa-cua-thanh-pho-ho-chi-minh-nam-2025-119250616211341304.htm). Exact house-number/pin correspondence remains unverified. Do not relabel the snapshot as Bình Dương based on old boundaries or overwrite historical snapshots (C08).

## The six drivers

All six: User role `DRIVER`, User status `ACTIVE`, capabilities `[PICKUP, DELIVERY]`, DriverProfile status `AVAILABLE`, `isOnline = true`, `isAvailable = true`, no executing READY/IN_TRANSIT line-haul trip. All have **null operatingWarehouseId, null operating warehouse and null warehouse city**.

| Employee code | DriverProfile ID | First exclusion | Additional failed condition |
|---|---|---|---|
| 123 | c1e581fd-4fb6-44a9-a5f7-0725f8241e67 | DRIVER_OPERATING_WAREHOUSE_REQUIRED | Current GPS missing |
| D1-17872391 | 6ff8519b-027e-49ed-8021-84e115b55b4d | DRIVER_OPERATING_WAREHOUSE_REQUIRED | Current GPS missing |
| D1-17872427 | ade24e55-5841-4114-9595-8946ceb93e30 | DRIVER_OPERATING_WAREHOUSE_REQUIRED | Current GPS missing |
| D2-17872427 | 1fa7f52f-d2fb-4cd6-a184-66ad7da54ff0 | DRIVER_OPERATING_WAREHOUSE_REQUIRED | Current GPS missing |
| DRV-P6-O-6DDC7D77C8 | dfad0b0e-789d-4c2b-8fc3-62d59c2e4622 | DRIVER_OPERATING_WAREHOUSE_REQUIRED | Current GPS missing |
| DRV_TEST_20260830 | 9f42eec6-5bba-45e5-8999-e3bb1d2d2f99 | DRIVER_OPERATING_WAREHOUSE_REQUIRED | Current GPS missing |

Redis read batch started `2026-09-19T00:04:56.731Z`: every `driver:location:{id}` above returned GET null and PTTL -2 (key absent). Coordinates, timestamp and age are unavailable; absence cannot distinguish never published from already expired. Last-mile payload uses `updatedAt`, not `capturedAt` (the latter belongs to line-haul). Current location TTL is 20 seconds; timestamps age >=20 seconds fail current-location parsing.

Remaining nine profiles are outside the initial candidate query: D2-17872391, DRV-P6-6DDC7D77C872, DRV-P7-8B43B5D30A51, G3A-LH-0ED67A782B72 and G3A-LH-B8225AFFD8A8 are BUSY/isAvailable false; the last two also execute line-haul trips and only have LINE_HAUL capability. G3A-NO-CAP-0ED67A782B72, G3A-NO-CAP-B8225AFFD8A8, G3A-OTHER-0ED67A782B72 and G3A-OTHER-B8225AFFD8A8 are OFFLINE/isOnline false/isAvailable false. All nine Users are ACTIVE. Their current GPS keys were also absent.

## Why the UI says six outside the area

`assignment-candidate-select.tsx` displays `noOperatingWarehouse + outsideOperatingArea` under the same Vietnamese area label. For the observed rows, repository policy yields noOperatingWarehouse=6, outsideOperatingArea=0, missingCapability=0, noCurrentLocation=0, candidates=0. The last GPS counter is zero because policy returns the earlier missing-warehouse exclusion. It does not mean GPS exists.

## Concrete remaining execution

1. Establish deployed API binding and authorized Admin plus driver login/session using a secret local file. User was asked for missing access; no forged JWT or direct lifecycle write is permitted.
2. Re-read target data and use Admin `PATCH /api/v1/drivers/:id` to attach one of the six drivers to an active HCMC operating warehouse. Existing capability/User/availability already pass in the observed database; revalidate concurrency and active work before setup.
3. Authenticated driver publishes valid GPS via `POST /api/v1/driver/location`, continuing at the existing 5-second cadence during assignment. Redis SET alone is not acceptable verification.
4. Authenticated `GET /api/v1/dispatcher/shipments/95a4fe1e-d18c-456f-9863-1d0840f899d3/pickup-candidates` must return at least one candidate; choose that returned driver in the UI and submit Phân công tài xế (pickup-assignments command).
5. Verify committed PICKUP_ASSIGNED, preserved DriverAssignment/tracking/audit and no duplicate command result. None of steps 2–5 has been claimed complete.

Validation performed: live PostgreSQL READ ONLY transactions, Redis GET/PTTL, source trace and official administrative reference. No application code change, no test fixture writes, no eligibility relaxation. Preserved C01/C02/C03/C04/C05/C08/C10/C12/C16.
