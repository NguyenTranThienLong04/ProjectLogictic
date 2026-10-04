# Staging preparation — 2026-10-04

## Follow-up deployment gate — 23:19 ICT / 16:19 UTC

**DEPLOY WIRING MISMATCH — STOPPED at step 1 as explicitly requested. READY FOR CUTOVER: NO.** Expected backend and frontend SHA: `cade37c4e16b1f1c0cde8af8c735f9b0624c11aa` on `release/phase1-p0-20260928`.

Fresh public requests at `2026-10-04T16:19:09.278Z` used a unique `staging_verify` query plus `Cache-Control: no-cache, no-store` and `Pragma: no-cache`. Browser verification used a fresh Chrome context, blocked service workers, disabled network cache and `Page.reload({ignoreCache:true})`.

| Check | Fresh result |
|---|---|
| Backend `/api/v1/health` | 200, PostgreSQL/Redis up |
| Backend `/api/v1/health/version` | 404 `RESOURCE_NOT_FOUND`; Live SHA UNKNOWN; request ID `de76aaa8-7ee6-4001-a05f-2df96e2f4b87` |
| Frontend `/release.json` | 200 **text/html**, SPA fallback; Live SHA UNKNOWN; CDN cache MISS |
| Frontend entry after cache bust and hard reload | Old `/assets/index-BGj12pP4.js`; CDN cache MISS; SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`; expected commit absent from bundle |
| Notification / Vehicle / A→B / GPS / Legacy | BLOCKED / NOT RUN in this follow-up because the deployment gate did not pass |

The served content cannot be verified as the expected release. The exact Render configuration error is not established without dashboard/config access; old Live contents alone do not identify which repo/branch/build/publish setting is wrong. Both Render services must serve the exact expected commit before continuing.

No authenticated business APIs, DB reads/writes, product edits, migrations, reset/seed, resource changes or enforcement changes were performed in this follow-up. The earlier SG01_TX01 capability setup remains prior evidence, not a fresh eligibility claim. Notification issue remains open. No new local regression suite was needed for these public deployment reads.

Fresh evidence: ignored `test-results/staging-cutover-deployment/gate.json`, `live-entry.js`, `hard-reload.png`. First browser attempt hit sandbox EPERM; approved retry completed hard reload. Only this report, `PROJECT_STATE.md`, and ignored verification artifacts changed. C01/C04/C05/C08/C09 remain untouched by the read-only gate.

---

**READY FOR CUTOVER: NO.** Latest Live check: **2026-10-04 16:12:55–16:12:57 UTC (23:12 ICT)**. Notification issue remains open. No product-code edit, migration, reset, seed, direct SQL write, legacy rewrite, or enforcement change in this task.

## Release

- The user reported deployment. Independent reads of `https://logistics-staging-api.onrender.com` and `https://logistics-staging-web.onrender.com` still show the previous release contents.
- Existing notification fix was committed by the user during this task as **`cade37c4e16b1f1c0cde8af8c735f9b0624c11aa`**. The agent did not create or amend this commit.
- The release branch was five commits ahead of its remote. After checking/tests/build, the agent fast-forward pushed that exact SHA to **`release/phase1-p0-20260928`**. `git ls-remote` independently confirms it. No main update or force push.
- Remote `main` remains **`68869cbc30ce93574fa4e50fb228ed53c05f2b9d`**. Redeploying that branch does not include the notification fix.
- Backend `/api/v1/health`, `/health/live`, `/health/ready`: **200**, PostgreSQL and Redis up.
- Backend `/api/v1/health/version`: **404**, request ID `85aa7fdf-2a96-43cb-b7fa-428000f015bf`. **Backend Live SHA UNKNOWN**.
- Frontend `/release.json`: **200 text/html**, SPA fallback rather than release metadata. **Frontend Live SHA UNKNOWN**.
- Live entry remains `index-BGj12pP4.js`, SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`.
- Chrome cache was disabled and `Page.reload({ignoreCache:true})` executed. Shared Live bundle still binds the notification button only to mark-read, disables it during mutation, and has no pickup/delivery assignment mapping. The notification-center bundle also lacks the mapping.
- Render credentials/session are not available to this agent. No Render deployment API/hook was invoked. User was given the now-published exact SHA for both services. Hosted CI on this SHA has not been established; local checks below are not a hosted CI claim.

## Resources and the one business mutation

Inventory was read first through the authenticated ADMIN APIs, and separately through a `REPEATABLE READ READ ONLY` PostgreSQL transaction ending in `ROLLBACK`.

| Resource | Result |
|---|---|
| SG01, `94e6ee6d-3627-4bdb-b479-d73a0e13801c` | Active, one active staff with active WAREHOUSE_STAFF account |
| SG02, `db616144-574c-4730-92cf-2fe1738ba0c6` | Active, one active staff with active WAREHOUSE_STAFF account |
| Existing Driver `SG01_TX01`, `535ec2ab-e4bc-4928-bcb5-a9768d878ed5` | AVAILABLE at SG01; LINE_HAUL added through canonical Admin API, preserving PICKUP and DELIVERY |
| Driver eligibility | `GET /line-haul/trips/eligible-drivers?search=SG01_TX01` includes this driver, HTTP 200 |
| Vehicles | 0; no vehicle created without the requested plate/type/capacity information |
| Trips | 0; no manifest or completed A→B smoke |

Authorized mutation: `PATCH /api/v1/drivers/535ec2ab-e4bc-4928-bcb5-a9768d878ed5/capabilities`, HTTP **200**, request ID `334cd9d0-79a5-44b2-b3b4-403848a1e8d3`.

Append-only audit was verified through the Admin audit API: **`293a56ee-9f9c-4674-8586-3b93abcd53fc`**, `DRIVER_CAPABILITIES_SET`, **2026-10-04T16:04:42.685Z**, actor ADMIN **`39b75de9-30d8-4575-be94-4c477aa81b38`**. Before `[PICKUP, DELIVERY]`; after `[PICKUP, DELIVERY, LINE_HAUL]`. Verification did not repeat the PATCH.

Live management capabilities exist: `/admin/drivers` has “Bật tuyến liên kho”; `/admin/line-haul/vehicles` has a create form for code/plate/type/capacity; `/admin/staff/new` has account creation. **No missing management capability was found for these resources.** No DB workaround is needed.

## Remaining staging gates

| Gate | Result / blocker |
|---|---|
| Notification | **FAIL on served Live implementation; owned DRIVER browser matrix BLOCKED.** Both saved Driver profiles now refresh with 401 `AUTH_REFRESH_TOKEN_INVALID`. No impersonation, password reset, or token minting. No new pickup/delivery assignment created. |
| A→B Trip | **NOT RUN**: vehicle and Driver access missing; fixed release not verified. No smoke transfer/trip ID exists. |
| GPS | **NOT RUN**: no owned IN_TRANSIT trip/session/device. No synthetic location published. |
| Missing Driver/Vehicle depart, receive-before-ARRIVED, duplicate depart/receive | **NOT RUN on staging**; no operational test trip. Prior local evidence is not promoted to staging PASS. |
| Legacy compatibility | **NOT RUN on the fixed staging release**. Existing standalone transfer preserved; details below. |
| Release identity | **BLOCKED**: two Live SHAs unknown; local/published SHA is not Live evidence. |

Legacy transfer **`8715b031-2ac2-4d2c-b1e0-56e1712578c0` / `TRF-MUSKE729-PAEL`** is still standalone **IN_TRANSIT**, SG01 → **`df04d1f9-fdfe-4d0e-9887-937ba947bd36` / `P0-1790653217727-ORI`**, dispatched **2026-10-03T15:46:59.652Z** by **`6ec8bdef-cfd7-403d-bc3e-5c480db02cde`**. Destination has zero active staff. No receive was performed against the old Live release, no trip was attached, and departure history remains unchanged. Admin receive is a supported canonical API option when validating the correct release; any Warehouse Staff receipt additionally needs destination staff/session.

The separate readiness CLI returned **P2028** twice while starting its Prisma transaction; it is not a readiness PASS. The authenticated inventory, eligibility, audit, and PostgreSQL read-only evidence above succeeded independently. No product/tool policy change was made to mask the CLI failure.

## Verification of published source

All below ran on clean product source at `cade37c4e16b1f1c0cde8af8c735f9b0624c11aa`; no DB test setup or migrations were run.

- Backend focused unit tests: **43/43 PASS**, six assignment/delivery/notification/transfer/line-haul suites.
- Frontend unit tests: **70/70 PASS**.
- `frontend/test/ui-flow/check.mjs`: **PASS** at 375/768/1440, including slow/failed mark-read navigation. Local HTTP fixtures.
- `frontend/test/ui-flow/notification-reload.mjs`: **PASS** at 375/768/1440, both entry points, pickup/delivery, real App/router and F5. Local HTTP fixtures.
- Backend/frontend build: **PASS**. Baked SHA is identical in both local artifacts; provenance checker **PASS**. Backend build timestamp `2026-10-04T16:09:24.620Z`; frontend `2026-10-04T16:09:30.651Z`.
- `git diff --check`: PASS. Unpublished diff scan: zero high-confidence secret matches. Existing chunk-size warning retained. Windows Node 24 local results are not Node 22/Linux hosted CI evidence.

Evidence: ignored `test-results/staging-preparation/` contains `preflight.json`, `release-check.json`, `browser-inventory.json`, `driver-setup.json`, management screenshots and local test/build logs. The first capability PATCH request ID is retained above; a later read-only verification refreshed `driver-setup.json`. No auth token/password is printed or persisted in these reports.

Affected safeguards: C01/C04 role and ownership checks; C05 append-only history; C08 valid lifecycle; C09 audited business commands; integer capacity, source provenance and backend eligibility remain authoritative.

Next: deploy both services at the published SHA and verify their release endpoints; obtain an owned Driver session and real vehicle details; create the vehicle through Fleet; run notification and full A→B/GPS/negative/legacy checks. **Do not set `LINE_HAUL_ENFORCEMENT_FROM`. No cutover timestamp is proposed while gates remain open.**
