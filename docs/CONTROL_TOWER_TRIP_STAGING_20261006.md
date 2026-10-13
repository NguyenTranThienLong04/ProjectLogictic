# Control Tower — approved Trip verification, 2026-10-06

**Superseded Admin blocker:** a later explicitly authorized Trip completed the real Admin Tower click → exact detail/API → F5 and was cancelled only afterward. See [Admin Trip closure PASS](CONTROL_TOWER_ADMIN_TRIP_PASS_20261006.md). The remainder preserves the two earlier runs and their harness failures as historical evidence.

**CONTROL TOWER STAGING: BLOCKED.** Dispatcher Tower → Trip Detail → F5 passed. Admin direct Trip Detail and F5 passed after cancellation, but an actual Admin Tower → Trip Detail click remains unverified because of two errors in the verification script. These are agent test-harness errors; no product regression was reproduced. No product code was changed.

## Trips and authorization

Both Trips used existing active warehouses **SG01 → SG02**, eligible Driver **SG01_TX01** (`535ec2ab-e4bc-4928-bcb5-a9768d878ed5`, includes LINE_HAUL), and AVAILABLE Vehicle **STG-SG01-SG02-20261005** (`e05f9179-0914-4ae5-ad87-06b2378e219d`, capacity 2,000,000 g). Eligibility and warehouse activity were rechecked through authenticated APIs before each create.

| Run | Trip code | Trip ID | Created / cancelled, ICT | Final status |
|---|---|---|---|---|
| Initial explicit approval | LHT-20261006-EDBAB2 | `9b3fda7c-c552-4e51-8e55-8c310235a890` | 21:21:27 / 21:22:15 | CANCELLED |
| Separately approved additional Trip | LHT-20261006-21C579 | `1ec5d4d4-1a41-4b60-9175-7b72c5f96153` | 21:26:31 / 21:26:54 | CANCELLED |

The user explicitly approved the second Trip after the first run failed to execute the Admin click. No third Trip was created. Each create used one distinct idempotency key and `POST /api/v1/line-haul/trips`, returning HTTP 201. Both had an empty manifest, no schedule, no departure and no arrival; **PLANNED** was the status used for Control Tower verification.

## Observed results

Backend `/health/version` and frontend `/release.json` both identify `0f2d43c657248e3e9284dab016aa2d4fbc7b001a`. Health returned database/Redis up. Real saved Admin and Dispatcher sessions refreshed normally; `/users/me` confirmed the expected roles. Tokens remained in memory.

| Check | Result | Evidence and limitation |
|---|---|---|
| Control Tower API, Admin + Dispatcher | PASS | Both Trips returned with exact ID/code, PLANNED status, SG01/SG02 warehouse IDs/codes and activeTrips=1 while active |
| Control Tower UI, first Trip | PASS | First run found the actual Trip link for both roles; Dispatcher screenshot shows its code, PLANNED badge and SG01 → SG02 |
| Dispatcher actual Tower click | PASS | First Trip navigated to `/dispatcher/line-haul/9b3fda7c-c552-4e51-8e55-8c310235a890`; real detail GET 200; exact heading, warehouses, Driver and Vehicle asserted |
| Dispatcher F5 | PASS | Cache-disabled full page reload retained that exact route, returned detail GET 200 and the same PLANNED Trip data |
| Admin actual Tower click | **FAIL — verification incomplete** | First runner expected the wrong Admin route shape; second runner referenced `link` before initialization. Neither completed an Admin click. No application navigation failure was demonstrated |
| Admin direct Detail + F5 | PASS, limited scope | Follow-up GET/navigation and cache-disabled reload at `/admin/line-haul/trips/9b3fda7c-c552-4e51-8e55-8c310235a890` retained exact ID/code/route and correct CANCELLED data; this does not replace a click from Tower while PLANNED |
| Cleanup | PASS, both Trips | Dedicated cancel API returned 200/CANCELLED/version 1; detail GET confirmed persistence; neither appeared in either role's active Tower afterward; Driver and Vehicle remained eligible/AVAILABLE |
| Product regression | NO reproduced | No browser JavaScript exceptions recorded; incomplete Admin click coverage remains explicit |

Dispatcher detail click request ID: `e21e8ca2-c145-4ec1-9cfb-8907343d66cb`; F5 detail request ID: `d806a0fb-5d9a-4b10-b67a-a3c8764db226`. Admin direct cancelled-detail request ID: `0dd7b9f2-93a8-4b9f-afcb-2f63b3b6290e`; F5: `f775928b-2a2a-4452-8393-32cdc11443d4`.

## Cleanup and history

Only the normal `POST /api/v1/line-haul/trips/{id}/cancel` command changed the created Trips to CANCELLED. Cancellation request IDs were `4f53429a-daa6-4f02-838e-1f42549780f9` and `f5dda821-29c7-4e85-a5f2-67132a23b2b5` respectively. Both terminal business records remain queryable; no hard delete occurred.

For the second Trip, the Admin audit API independently returned exactly one create (`05381e5e-1487-4803-bb81-8e29dd5c4cad`) and one cancellation (`02b33237-e04d-4510-923a-60e5b3862f01`), actor role DISPATCHER, PLANNED → CANCELLED. The first run verified cancel persistence but did not separately query its audit rows.

The cancellation reason was prewritten for the planned verification flow; it is not evidence that all UI checks completed. The case results above are authoritative for test coverage.

## Harness failures and remaining work

1. First run incorrectly reused the Dispatcher URL pattern for Admin. The existing application model/router correctly use `/admin/line-haul/trips/:id`; the test stopped on its wrong expected href. Its `finally` block then safely cancelled the Trip after Dispatcher checks.
2. The separately authorized retry corrected the route but added an href observation before initializing its `link` variable. Both role checks stopped in the Node runner before clicking; cleanup still completed normally.
3. The ignored runner now initializes the locator first and uses each role's actual route. `node --check` and ESLint `no-use-before-define` pass. No further staging mutation rerun was performed, so these fixes do not establish an Admin Tower click PASS.

The outstanding case is a real Admin click from an active Trip's Tower row followed by exact detail/F5. No third creation is authorized by this session's two one-Trip approvals. Existing cancelled Trips must not be restored via direct DB or arbitrary status writes. The earlier AT_RISK fallback remains isolated-local evidence and was not rerun or reclassified here.

Initial browser startup was blocked by sandbox `spawn EPERM`; the approved external browser run then encountered a transient auth-refresh timeout. Public health checks and a subsequent normal refresh resolved those environment failures before any business write.

## Files, rules and evidence

Tracked documentation: this report, the supersession note in `CONTROL_TOWER_CLOSURE_20261006.md`, and `PROJECT_STATE.md`. No application source, dependency, deployment, migration, seed/reset or direct database write changed. C01/C02/C04/C05/C09/C10 were retained through normal role-checked business APIs; C18 prevents claiming the missing Admin click as complete.

Ignored evidence under `test-results/control-tower-closure/`:

- `trip-final.json`: first create, Dispatcher click/F5, Admin harness mismatch, cleanup and request IDs.
- `trip-admin-existing-1791296680079.json`: read-only Admin CANCELLED detail/F5.
- `trip-admin-retry.json`: separately authorized second create, runner errors, cleanup and audit IDs.
- `trip-dispatcher-tower.png`, `trip-dispatcher-detail-f5.png`, `trip-admin-cancelled-detail-f5.png`: real staging screenshots.
- `trip-proposal.json`, `trip-admin-retry-proposal.json`, `trip-final.mjs`: exact proposals and validation runner; original run evidence is preserved.

**CONTROL TOWER STAGING: BLOCKED**
