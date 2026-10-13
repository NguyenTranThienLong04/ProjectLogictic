# Control Tower — final staging verification, 2026-10-06

**CONTROL TOWER STAGING: BLOCKED** — release blocker resolved; available Admin/Driver checks pass. Dispatcher access and real AT_RISK / active-Trip cases remain unavailable. No product regression reproduced; no product code was changed.

This report supersedes the missing-release blocker in `CONTROL_TOWER_STAGING_20261006.md`. It does not convert untested cases into PASS.

## Release

| Check | Result |
|---|---|
| Backend Live SHA | `0f2d43c657248e3e9284dab016aa2d4fbc7b001a` |
| Frontend Live SHA | `0f2d43c657248e3e9284dab016aa2d4fbc7b001a` |
| Local `main` / `origin/main` | Same SHA; tree contains backend controller and frontend Control Tower page |
| `/api/v1/health/version` | PASS — HTTP 200 JSON; build `2026-10-05T18:55:18.508Z`; Node `v22.23.3` |
| `/release.json` | PASS — HTTP 200 JSON; build `2026-10-05T18:55:18.659Z` |
| Served code | PASS — entry `index-Ct5XjNtH.js` embeds the release SHA; both role bundles contain Control Tower; browser loads `control-tower-page-BugTghhZ.js` |
| `GET /api/v1/control-tower` | PASS — unauthenticated 401, authenticated Admin 200; no longer 404 |
| `GET /api/v1/control-tower/filters` | PASS — authenticated Admin 200; returns effective policy |

Targets: `https://logistics-staging-web.onrender.com` and `https://logistics-staging-api.onrender.com/api/v1`. Initial fresh release probe: 2026-10-06 01:57 ICT; identities were rechecked during the final UI run starting at **13:16 ICT** on the same date. Public reads used cache-busting/no-cache; browser checks disabled cache and used the actual served app and backend.

## Final acceptance matrix

| Requirement | Result | Evidence / limitation |
|---|---|---|
| Admin `/admin/control-tower` | **PASS** | Real restored ADMIN session; API, KPI and operational table render |
| Dispatcher `/dispatcher/control-tower` | **BLOCKED** | Bundle contains route, but no authenticated DISPATCHER session available. User selected an existing session; CDP port/profile location was not supplied |
| Negative RBAC | **PASS for anonymous + DRIVER** | 401 anonymous; DRIVER gets 403 `AUTH_FORBIDDEN` for dashboard and filters; both UI routes redirect Driver to `/driver/dashboard`. CUSTOMER / WAREHOUSE_STAFF not certified |
| Summary | **PASS — Admin** | IDs and stage counts independently reconciled against PostgreSQL in a READ ONLY transaction |
| Warehouse scope | **PASS — Admin** | Four real warehouse filters match independent origin/destination/current/return membership; unrelated UUID returns empty. SG02 UI selection returns five rows and survives F5 |
| SLA / Aging | **BLOCKED for full matrix** | ON_TIME, OVERDUE, aging, deadlines, at-risk thresholds and persisted stage-entry timestamps PASS. No live AT_RISK case available |
| Filters / pagination | **PASS — Admin** | 16 filter combinations; all seven IDs traversed once over four pages with limit 2; empty/out-of-range pages retain correct totals; bad inputs 400; all four explicit sort orders verified |
| Shipment / Transfer deep-link + F5 | **PASS — Admin** | Clicks from real Control Tower land on exact IDs; detail API and hard reload succeed |
| Trip deep-link + F5 | **BLOCKED for Control Tower click** | Existing ARRIVED Trip direct detail route + F5 PASS; no active Trip or linked active transfer exists in the dashboard to click |
| Responsive | **PASS — Admin 375 / 1440 px** | Mobile cards / desktop table, visible controls and KPI; document width equals viewport. Dispatcher responsive not independently tested |
| Loading / empty / error | **PASS — Admin** | Delayed real GET shows loading; unmatched real search returns empty; browser-aborted GET shows error, then retry restores real data |
| Regression smoke | **PASS within smoke scope below** | Shipment / transfer / Trip reads, owned Driver pickup/delivery details, notification navigation and strict standalone-dispatch rejection. No complete new lifecycle journey executed |

### Data and timing

Independent DB snapshot: `2026-10-06T05:55:19.554Z`, `transaction_read_only=on`. Main authenticated API snapshot: `2026-10-06T06:08:49.104Z` (**13:08:49 ICT**). IDs/status counts agreed across those reads.

| KPI | Value |
|---|---:|
| Active shipments | 7 |
| Pickup | 0 |
| Origin warehouse | 1 |
| Transfer / line-haul | 2 |
| Destination warehouse / awaiting delivery | 3 |
| Out for delivery | 0 |
| Exception | 1 |
| Overdue SLA | 5 |
| AT_RISK | 0 |
| Aging alert | 7 |
| Unavailable / not-applicable SLA | 1 |
| Active trips | 0 |

The earlier 01:58 ICT snapshot had two ON_TIME and four OVERDUE rows. At 13:08 ICT it had one ON_TIME and five OVERDUE: origin dwell for `SHP-20261005-50347EBC` passed its deadline `2026-10-06T05:28:09.108Z`. Its persisted stage start remained `2026-10-05T17:28:09.108Z`; no timestamp was edited. This is observed server-side time progression, not a count discrepancy.

- ON_TIME example: `SHP-20261005-F70CBB21`, transfer `TRF-MUVESILF-TZWZ`; start `2026-10-05T15:33:01.479Z`, deadline `2026-10-06T15:33:01.479Z`. At the main snapshot its age was 52,547 seconds, matching `floor((asOf - start) / 1000)`.
- OVERDUE example: `SHP-20261003-48FF366D`; start `2026-10-03T15:46:59.652Z`, deadline `2026-10-04T15:46:59.652Z`, age 224,509 seconds at that snapshot.
- Effective policy returned by Live: pickup 480 / origin 720 / transit 1440 / destination 720 / delivery 480 minutes; risk at 80%, aging alert at 360 minutes. Every available row's state/deadline/age matched persisted lifecycle/tracking and the backend snapshot clock.
- Three destination-dwell rows use stage entry after their historical IN_TRANSIT transition. This verifies the current projection against existing transition history; no new transition command was executed to test resetting aging in this task.
- `DELIVERY_FAILED` correctly has aging and no applicable SLA. It is **not** evidence for missing timestamps: all seven current timestamps were VALID. Missing/inconsistent timestamp handling remains UNVERIFIED on staging.
- No AT_RISK fixture was created and no timestamp/config/clock was altered. The current ON_TIME transfer would enter AT_RISK at `2026-10-06T10:45:01.479Z` (**17:45 ICT**) if its stage and policy remain unchanged; that future case has not been tested.

### UI and exact routes

- Shipment click + F5: `/admin/shipments/a4b56bd8-895d-4c14-9af4-f2296a73ba4c`.
- Transfer click + F5: `/admin/warehouses/94e6ee6d-3627-4bdb-b479-d73a0e13801c/transfers/8715b031-2ac2-4d2c-b1e0-56e1712578c0`.
- Existing ARRIVED Trip direct route + F5: `/admin/line-haul/trips/eb351ec9-893a-4dc4-a154-9889a1b0a2af`. This was not a click from Control Tower.
- UI SLA/search/warehouse/date/entity/sort controls exercised. Local input `2026-10-05T00:00` became `2026-10-04T17:00:00.000Z` in the URL/API query; real Trip filtering returned empty. Filters and page survived F5.
- Pagination uses `?limit=2` to exercise multiple real pages with the seven existing records. The normal UI offers 10/25/50/100; no records were seeded to reach a larger page size.
- Loading/error fault injection was confined to delaying/aborting GETs in the test browser. Success and empty responses came from Live, with no fabricated business data. Error retry restored real results.
- Screenshots: `test-results/control-tower-staging-final/admin-1440-settled.png` and `admin-375-settled.png`. Earlier desktop/mobile screenshots were visually inspected and also preserve the initial warehouse-catalog loading state. Zero browser JavaScript exceptions were observed.

## Regression smoke

| Area | Result / scope |
|---|---|
| Shipment | PASS — operational list and exact detail GET / UI / F5 |
| Pickup / delivery | PASS — real Driver notification navigation to owned assignment detail, detail GET and F5 |
| Warehouse transfer | PASS — exact detail GET / UI / F5; selected pending transfer unchanged by negative strict check |
| Line-haul strict | PASS — `409 LINE_HAUL_TRIP_REQUIRED` on post-cutover pending transfer with no Trip; independent before/after DB fingerprint equal |
| Notification deep-link | PASS — already-read Pickup and Delivery notifications from real center; correct assignment routes and F5; no mark-read write needed |

Strict negative test target: `TRF-MUVIX0HC-WFDA` / `063c4cbd-895e-45db-b0fd-b28add299d41`. Before the POST, Live reported `lineHaulRequired=true`, `canStandaloneDispatch=false`, `legacyStandalone=false`, enforcement from `2026-10-05T08:00:00.000Z`. The explicit standalone dispatch POST returned 409. Transfer detail before/after was identical; independent READ ONLY queries confirmed:

| Persisted value | Before | After |
|---|---|---|
| Transfer status / dispatchedAt | PENDING / null | PENDING / null |
| Shipment status / version | AT_ORIGIN_WAREHOUSE / 6 | AT_ORIGIN_WAREHOUSE / 6 |
| Tracking rows | 7 | 7 |
| Shipment + transfer audit rows | 6 | 6 |

Driver notification routes verified:

- Pickup `/driver/pickups/467ac8da-aef0-4bb9-a861-5f5ac9d1b62c`.
- Delivery `/driver/deliveries/d16502fd-a37a-43d2-8faf-42e6b1606b12`.

No new pickup completion, delivery completion, transfer receive or Trip departure/arrival journey was executed. Browser-generated GPS writes were blocked by the harness; no GPS was fabricated. The full lifecycle E2E is outside this smoke result.

## Test diagnostics and boundaries

- The initial fast API loop hit the existing Control Tower limit of 30 requests/minute. Invalid-input and sort groups initially recorded 429 failures. Both groups then PASS in `recheck.json` at a 2.3-second request interval. Original evidence is retained; no throttler or application setting was changed.
- The first browser rerun did not capture authentication in restored existing tabs; a fresh tab restored normal auth and completed the tests. No application fix was made. An initial observer SQL query used the wrong Trip-link ordering column; only the ignored validation script was corrected to `assignedAt`, then the READ ONLY transaction completed.
- Admin and the notification-test Driver profiles restored successfully. Other checked staging profiles returned `AUTH_REFRESH_TOKEN_INVALID`. No accessible Dispatcher CDP/profile was found. No role change, impersonation, new account, password reset or cookie/token export was used to bypass this blocker.
- Only one business-command request was sent: the explicitly tested negative strict dispatch, rejected with no persisted state/history change. Other accesses were GETs, ordinary session refresh and READ ONLY database transactions. No deployment, migration, reset, seed, config/policy change or direct database mutation occurred.
- Backend authority, RBAC, append-only history and unchanged historical data were preserved (C01/C04/C05/C08). No product-code change was justified by the observed results.
- No new CI claim is made. The previous Linux/Node 22 snapshot result is separate from this Live verification.

## Files and remaining evidence

Changed tracked documentation: this report and `PROJECT_STATE.md`. Product files are unchanged.

Ignored evidence directory: `test-results/control-tower-staging-final/`. Main artifacts: `release.json`, `sessions.json`, `verification-sessions.json`, `database.json`, `admin-verification.json`, `driver-verification.json`, `recheck.json`, `ui-extra.json`, `remaining-sessions.json`, settled desktop/mobile screenshots and Driver detail screenshots. Scripts in the same directory reproduce the scoped probes; sensitive session tokens remain only in memory.

To finish acceptance: provide the port/profile of the intended existing Dispatcher session, then execute its positive API/UI checks. Observe a real AT_RISK case and an active Trip/link from Control Tower; missing timestamp and a newly executed stage-reset case remain unverified if required. Existing historical and local tests do not substitute for those Live cases. No seed/reset is proposed.

**CONTROL TOWER STAGING: BLOCKED**
