# Staging notification and line-haul verification — 2026-10-05

Checked **00:15–00:21 ICT, 05/10/2026** (2026-10-04T17:15–17:21Z). **READY FOR CUTOVER: NO.** This task created one staging test Vehicle through the authenticated Admin Fleet API. No product-code changes, deployment, env changes, migration/reset/seed, SQL writes, shipment/history rewrites or notification backfill.

## Live release and notification

Targets: `https://logistics-staging-web.onrender.com` and `https://logistics-staging-api.onrender.com/api/v1`.

| Evidence | Fresh result |
|---|---|
| Frontend commit SHA | **UNKNOWN**: `/release.json` returns 200 `text/html` SPA fallback |
| Frontend entry | `/assets/index-BGj12pP4.js` |
| Entry SHA-256 | `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4` |
| Shared notification/dropdown module | `empty-state-De-z7GFy.js`, SHA-256 `0ab565931ca99601b260adebb8b6655d0dde712f19d1d3a6544673c06ca410ce` |
| Notification center module | `notifications-page-hwCzdxUT.js`, SHA-256 `cbd91dd40b5f7748e5482bfb23c93a7662480edee7fde6ece3ed750ad1f7166d` |
| Backend commit SHA | **UNKNOWN**: `/health/version` 404 `RESOURCE_NOT_FOUND`, request `163ea277-b1cf-47a4-8cc4-50aca2a56e4f` |
| Health/live/ready | 200; PostgreSQL and Redis up |
| Cache verification | Unique query strings, cache MISS, no-cache headers; fresh Chrome with cache disabled and `Page.reload({ignoreCache:true})` loads the same entry |

**Root cause: old deployed frontend contents; notification requirement FAIL.** The Live dropdown handler is `onClick:()=>!e.readAt&&a.mutate(e.id)` and has `disabled:a.isPending`. The center exposes only mark-read/read-all actions. Both downloaded modules lack `assignmentId`, `PICKUP_ASSIGNMENT_CREATED` and `DELIVERY_ASSIGNMENT_CREATED` mapping. They do not contain the shared deep-link implementation already committed in **`cade37c4e16b1f1c0cde8af8c735f9b0624c11aa`** on `release/phase1-p0-20260928`. Workspace HEAD `16b21d4` adds only prior verification documentation after that fix.

This establishes an exact served-artifact/content mismatch with the fixed source. It does **not** identify the Live Git commit, Render deploy ID, or which Render repo/branch/build/publish setting is incorrect. Those require deployment metadata access. No regression fix or redeploy was attempted, as requested for an old deploy.

Fresh read-only staging PostgreSQL verification: **22/22** Driver assignment notifications have `data.assignmentId` matching the persisted assignment, recipient Driver, shipment and type (12 pickup, 10 delivery; zero missing). Sample pickup `fdd69d75-5846-49e1-aee4-2a7e3ee4e16e`; delivery `f445249b-7b49-4615-8b94-4800a1282b7f`. No metadata was rewritten. This is persisted-data evidence; an owned Driver HTTP payload has not been freshly verified.

| Requested real-DRIVER check | Result |
|---|---|
| Dropdown pickup | **BLOCKED / NOT RUN**; served handler lacks navigation |
| Dropdown delivery | **BLOCKED / NOT RUN**; served handler lacks navigation |
| All-notifications page | **BLOCKED / NOT RUN**; served center lacks task links |
| Slow/failed mark-read still navigates | **BLOCKED / NOT RUN** on staging |
| F5 retains the correct owned detail | **BLOCKED / NOT RUN** on staging |

Both saved profiles `auth-staging-driver` and `staging-driver-browser` return 401 `AUTH_REFRESH_TOKEN_INVALID`. Admin refresh is valid. No impersonation, token minting, password reset or mocked staging API response was used. A normal Driver session/credential source was requested; none was supplied during this verification. Prior local browser tests are not counted as staging PASS.

## Enforcement and canonical A→B

**Raw Live `LINE_HAUL_ENFORCEMENT_FROM`: UNKNOWN.** All four local env files have no nonempty cutover value, but local files do not prove Render runtime configuration. There is no available Render credential/session. Fresh Live transfer responses lack the newer `workflow.enforcementFrom` and `workflow.lineHaulRequired` fields, so no runtime value can be read from them.

Observed enforcement behavior is **OFF / compatibility-like**: a standalone SG01→SG02 transfer `ce98884a-0584-425a-b47e-b89ad4e7990e` / `TRF-MUU2VWR4-FTED` departed at `2026-10-04T17:12:00.075Z` and was received at `17:12:20.175Z`, with zero trips/vehicles at the initial read. These commands occurred before this verification and were not performed by this task. Standalone movement without a Vehicle is allowed in compatibility mode; it is not classified as a strict-flow bug. Runtime env OFF/ON still requires Render confirmation, especially because Live lacks the newer contract.

### Resource created and verified

| Field | Value |
|---|---|
| Vehicle ID | `e05f9179-0914-4ae5-ad87-06b2378e219d` |
| Code | `STG-SG01-SG02-20261005` |
| Plate / type | `STG-20261005-01` / `STAGING_TEST_TRUCK` (explicit staging test identity, not a verified physical fleet asset) |
| Capacity | **2,000,000 integer grams** |
| Status | **AVAILABLE**; canonical eligible-vehicles API includes it |
| Create | `POST /api/v1/line-haul/vehicles` → **201**, request `7e7cbcfb-61f2-4260-9833-49059ae7837f` |
| Audit | `fb1674d2-e66c-44af-8469-273a7c797825`, `LINE_HAUL_VEHICLE_CREATED`, `2026-10-04T17:20:05.718Z` |
| Actor | ADMIN `39b75de9-30d8-4575-be94-4c477aa81b38` via normal restored session |
| Verification | Admin GET detail, eligibility, audit, Fleet UI reload, and independent read-only DB check PASS |

SG01 and SG02 are active and each has one active warehouse staff account. Existing **SG01_TX01** (`535ec2ab-e4bc-4928-bcb5-a9768d878ed5`) remains ACTIVE/AVAILABLE, has PICKUP+DELIVERY+LINE_HAUL, has zero active last-mile assignments, and passes the eligible-drivers API. This task did not change that Driver.

**Canonical A→B: BLOCKED / NOT RUN, not PASS.** Fresh Admin inventory and independent read-only DB show **zero `PICKED_UP` or `AT_ORIGIN_WAREHOUSE` shipments**, zero pending transfers, and zero trips. The four shipments currently at SG01 are already DELIVERED. The latest SG01→SG02 shipment has already arrived at SG02 through standalone flow. None can be rewritten/reused as a new origin shipment.

A new shipment must reach SG01 through the normal Customer → confirm → owned Driver pickup → warehouse check-in/sort flow before creating a fresh Transfer, Trip/manifest, schedule, READY, dispatch, ARRIVED and SG02 receive. A valid Driver session is needed to progress that preparation. No empty Trip was created and no existing history was altered merely to manufacture a passing smoke.

### Cutover status

No timestamp is proposed because canonical A→B has not passed. No env was set. All requested **post-cutover** checks remain **NOT RUN**:

- A new transfer without a Trip cannot standalone-dispatch.
- Missing Vehicle or Driver cannot depart. Current canonical API requires both at Trip creation; use API rejection tests, not SQL-created malformed trips.
- Destination cannot receive before Trip ARRIVED.
- A pre-cutover standalone IN_TRANSIT transfer remains receivable.

Legacy candidate `8715b031-2ac2-4d2c-b1e0-56e1712578c0` / `TRF-MUSKE729-PAEL` remains standalone IN_TRANSIT with original departure `2026-10-03T15:46:59.652Z`. Its destination is `P0-1790653217727-ORI`, which has no active warehouse staff. Preserve it for post-cutover legacy verification; supported Admin receive or operational staffing is needed. It was not received or associated with a fabricated trip.

## Evidence, validation and next input

Ignored artifacts under `test-results/staging-verify-20261005/`: `gate.json`, downloaded entry/modules, `notification-trace.json`, `browser-inventory.json`, `operations.json`, `staging-database.json`, `hard-reload.png`, `vehicle-created.png`. Reports do not persist access tokens/passwords. SQL sessions used `REPEATABLE READ READ ONLY` and `ROLLBACK` only.

Live checks: public release/health/asset reads, cache-disabled browser hard reload, normal Admin and Driver session probes, notification metadata/ownership joins, resource/inventory API reads, one canonical Fleet create plus UI/API/audit/DB verification. Initial Chrome sandbox EPERM was retried through approved escalation. One inventory GET raced the script's second auth reload and returned 401; sequential normal auth followed by fresh inventory GET returned 200. No product tests/builds were rerun because product source did not change. `git diff --check` passed.

Files changed: this report and `PROJECT_STATE.md`; ignored verification scripts/artifacts only. Safeguards enforced: C01/C03/C04 backend lifecycle/ownership, C05/C06 append-only audit/history, C08 historical snapshots, C09 idempotent resource reuse, C18 honest staging test status. Integer capacity stays backend-validated.

Resume needs: deployment metadata/fixed frontend release; Render cutover-value confirmation; normal Driver access plus a new origin shipment. Complete canonical smoke before choosing a stable future UTC cutover; setting that env remains outside this task's authorization.
