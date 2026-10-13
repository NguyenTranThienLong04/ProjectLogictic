# Control Tower — remaining-case verification, 2026-10-06

Follow-up: the Trip approvals below were subsequently granted. Earlier runs established Dispatcher Trip click/F5 and preserved their [execution/cleanup evidence](CONTROL_TOWER_TRIP_STAGING_20261006.md). A later explicitly authorized Trip also closed the real Admin Tower click/detail/F5 and cleanup: [Admin Trip closure PASS](CONTROL_TOWER_ADMIN_TRIP_PASS_20261006.md). The following sections preserve the earlier evidence state.

**Control Tower Staging: PARTIAL.** This follow-up is restricted to Dispatcher, AT_RISK, and the Trip link. No product regression was reproduced and no product code was changed.

| Case | Result | Evidence scope |
|---|---|---|
| Dispatcher | **PASS — staging** | Real Dispatcher login, dashboard/API, filters, warehouse scope, pagination, Shipment/Transfer deep links and F5 |
| AT_RISK | **PASS — isolated local; staging UNVERIFIED** | Eight boundary cases execute the real backend query against existing local PostgreSQL fixtures; Live currently has zero AT_RISK rows |
| Trip deep-link from Tower | **BLOCKED pending requested approval** | No active Trip exists; concrete create/verify/cancel proposal is ready; no Trip has been created in this follow-up |

Source under test: `0f2d43c657248e3e9284dab016aa2d4fbc7b001a`. Earlier release and Admin/Driver regression results remain in `CONTROL_TOWER_STAGING_FINAL_20261006.md`; they were not broadly rerun.

## Dispatcher — Live PASS

The user selected a dedicated Dispatcher login window and logged in normally. Backend `/auth/login` returned role DISPATCHER, and `/users/me` independently confirmed that role in the verification session. No role impersonation, token fabrication, password reset or RBAC bypass was used. Browser profile: `test-results/control-tower-closure/dispatcher-profile`, CDP port 9340; tokens stayed in memory.

Snapshot: `2026-10-06T06:28:55.962Z` (**13:28:55 ICT**), seven active shipments, zero active Trips, zero AT_RISK rows.

- `/dispatcher/control-tower` and its authenticated GET API render KPI and operational rows.
- ON_TIME/AT_RISK/OVERDUE filters match baseline IDs. Pagination at two rows/page traverses all seven IDs once.
- SG02 warehouse scope returns the expected five related records. UI warehouse + SLA filters survive hard reload.
- Shipment link clicks into `/dispatcher/shipments/a4b56bd8-895d-4c14-9af4-f2296a73ba4c`; detail and F5 succeed.
- Transfer link clicks into `/dispatcher/warehouses/94e6ee6d-3627-4bdb-b479-d73a0e13801c/transfers/8715b031-2ac2-4d2c-b1e0-56e1712578c0`; detail and F5 succeed.
- Desktop/mobile at configured 1440/375 px render without document horizontal overflow; screenshots were visually inspected. No browser JavaScript exception was observed.

Evidence: `test-results/control-tower-closure/dispatcher.json`, `dispatcher-1440.png`, `dispatcher-375.png`, `inventory.json`.

## AT_RISK — isolated local PASS

Live still has no AT_RISK case. Its returned policy has **atRiskPercent=80**, origin dwell **720 minutes**, and transit **1440 minutes**. The allowed isolated fallback reused existing local fixtures in `127.0.0.1:55432/p0_regression_1791224446659`; no database, fixture, migration or seed was created for this follow-up.

The current backend was built successfully, and the real `controlTowerQuery()` was executed with its existing test-clock argument in a PostgreSQL `REPEATABLE READ READ ONLY` transaction (`transaction_read_only=on`). The transaction was rolled back. The test used Live's returned policy, without changing policy or timestamps. It asserted state, deadline, atRiskAt, unchanged stage start, exact aging seconds and the AT_RISK filter result at each boundary.

| Clock relative to threshold | Origin dwell 12 h | Transit 24 h |
|---|---|---|
| 1 ms before 80% | ON_TIME; risk filter empty | ON_TIME; risk filter empty |
| Exactly 80% | AT_RISK; risk filter 1 | AT_RISK; risk filter 1 |
| 1 ms before deadline | AT_RISK; risk filter 1 | AT_RISK; risk filter 1 |
| Exactly deadline | OVERDUE; risk filter empty | OVERDUE; risk filter empty |

**8/8 PASS.** The rule is inclusive at 80% and exclusive at deadline. This is real PostgreSQL/query execution with a local test clock, not a mocked result or a frontend-clock decision. It is not a Live AT_RISK observation.

Fixture `CT5eb622d5-risk`: start `2026-10-06T02:24:00Z`, threshold `12:00:00Z`, deadline `14:24:00Z`. Fixture `CT5eb622d5-transit`: start `2026-10-05T11:50:00Z`, threshold `2026-10-06T07:02:00Z`, deadline `11:50:00Z`.

Evidence: `test-results/control-tower-closure/at-risk-local.json` and `at-risk-local.mjs`. Source SHA recorded by the runner: `0f2d43c657248e3e9284dab016aa2d4fbc7b001a`; query artifact SHA-256 `d7d469d93a3e0ed025248d34dd84f9b510099f04009906982ca6a41fef7373ed`. Local build metadata itself reported `unknown` because Git subprocess access was unavailable in that build sandbox; it was not deployed or presented as a release artifact.

Docker Desktop and the existing local PostgreSQL container were initially stopped; they were started to run this read-only check. Those environment failures were not application regressions.

## Trip deep-link — concrete staging proposal awaiting approval

Fresh Live inventory contains only `LHT-20261005-ED4148`, status ARRIVED. Control Tower includes PLANNED/READY/IN_TRANSIT Trips, so the existing Trip cannot provide a click from the Tower list.

Eligible resources were confirmed by the real Dispatcher API. Proposal in `test-results/control-tower-closure/trip-proposal.json`:

- Route **SG01 → SG02**.
- Driver **SG01_TX01**, ID `535ec2ab-e4bc-4928-bcb5-a9768d878ed5`.
- Vehicle **STG-SG01-SG02-20261005**, ID `e05f9179-0914-4ae5-ad87-06b2378e219d`, AVAILABLE, capacity 2,000,000 g.
- One `POST /api/v1/line-haul/trips`, idempotency key `656bccac-40bb-47a1-827c-156883205ba1`, empty manifest, no schedule or departure.
- Verify the returned PLANNED Trip appears in Tower; click its real code to `/dispatcher/line-haul/{returnedId}`; verify detail GET and F5.
- Then `POST /api/v1/line-haul/trips/{returnedId}/cancel` through the normal audited workflow, preserving the CANCELLED Trip/audit and restoring resource eligibility. No shipment/transfer association or departure is proposed.

The guarded runner is prepared and syntax-checked: `trip-approved.mjs`. It rechecks Dispatcher identity, expected Live backend SHA and the exact approved resource IDs before creating; it does not substitute resources. A user approval question covers both creation and cancellation, because the user explicitly required permission before staging writes. **No approval has been inferred from elapsed time; no create/cancel request has run at this report state.**

## Boundaries and remaining work

- Root cause of remaining gap: absent active Trip data and pending write authorization, not a reproduced product defect. AT_RISK is locally verified via the fallback allowed by the user, but not observed Live.
- No product code, role, business timestamp, production data, SLA configuration or state machine was changed. No migration/reset/seed ran. Staging activity in this follow-up is ordinary authentication and GETs only so far.
- Tracked documentation changed: this report and `PROJECT_STATE.md`. Validation scripts, screenshots, proposal and JSON evidence are under ignored `test-results/control-tower-closure/`.
- Next: run only the approved Trip create/click/F5/cancel sequence after explicit approval; retain the local/staging distinction for AT_RISK in the final result.

**Control Tower Staging: PARTIAL**
