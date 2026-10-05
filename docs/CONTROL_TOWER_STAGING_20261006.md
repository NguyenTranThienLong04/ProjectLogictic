# Control Tower staging validation — 2026-10-06

**CONTROL TOWER STAGING: BLOCKED**

Scope: validation only. No feature/refactor, deployment, migration, reset, seed, direct database write, or staging business mutation in this task. Local implementation results in `CONTROL_TOWER_SLA_AGING_20261006.md` are not staging evidence.

## Release gate

Fresh public HTTP reads at **2026-10-06 01:45:50 ICT** (`2026-10-05T18:45:50.555Z`) used unique cache-busting query parameters and `Cache-Control: no-cache, no-store`.

| Check | Result | Evidence |
|---|---|---|
| Live backend SHA | VERIFIED | `6354dc6b157438ce9176499c4b24fa70e9f6f017` |
| Live frontend SHA | VERIFIED | `6354dc6b157438ce9176499c4b24fa70e9f6f017` |
| `/api/v1/health` | PASS | HTTP 200; database and Redis up |
| `/api/v1/health/version` | PASS | HTTP 200 JSON; backend build `2026-10-05T16:34:00.506Z`; runtime Node `v22.23.3` |
| `/release.json` | PASS | HTTP 200 JSON; frontend build `2026-10-05T16:33:59.460Z`; embedded entry-bundle SHA agrees |
| Correct new Control Tower release | **FAIL** | This commit does not contain Control Tower; its implementation is still uncommitted in the local workspace |
| `/api/v1/control-tower` | **FAIL — route absent** | HTTP 404, `RESOURCE_NOT_FOUND`, `Cannot GET /api/v1/control-tower?...` |
| Served Admin/Dispatcher route bundles | **FAIL — feature absent** | Neither route bundle contains `control-tower` / `Control Tower` |

Targets: `https://logistics-staging-api.onrender.com/api/v1` and `https://logistics-staging-web.onrender.com`.

`git ls-tree -r --name-only 6354dc6b157438ce9176499c4b24fa70e9f6f017 -- backend/src/modules/dashboards frontend/src/features/control-tower` confirms the commit has only the existing dashboard files, with no Control Tower implementation. Matching frontend/backend SHAs establishes provenance, but does not establish that the requested feature was released.

The endpoint probe was unauthenticated. Its 404, together with source and served-bundle evidence, establishes the release blocker; it does **not** establish correct 401/403 behavior. No role permission PASS is inferred.

Public artifacts:

| Asset | SHA-256 |
|---|---|
| `index-BG5ekRf9.js` | `2768be0fd5f8c1eb31cc59347accde81dc7135034b54950562e2f1c93962a8e7` |
| `admin-routes-Bhki1V3E.js` | `56dbe4faec7e7a34407ba7383f5f73145803b2aada514eac98bb2b6c3b1bc70d` |
| `dispatcher-routes-1kWmGWW6.js` | `89a8b2677e28a833456378ac95e0b2b19ea504c11dc4ce2cbb7cadac5fd5429c` |

Request IDs: version `d707f009-b08d-44ac-a420-5b8b61a2c0f6`; health `2a1f8349-f7ce-452c-9bb3-07a118f28f12`; missing Control Tower endpoint `08a18eb6-ceb9-4b11-b284-699401b66b4f`.

## Acceptance matrix

| Requested verification | Status | Scope / blocker |
|---|---|---|
| Admin `/admin/control-tower` | BLOCKED | Feature is absent from Live release; authenticated acceptance not run |
| Dispatcher `/dispatcher/control-tower` | BLOCKED | Feature is absent from Live release; authenticated acceptance not run |
| Reject other roles | BLOCKED | No Live Control Tower route to exercise; no RBAC conclusion from 404 |
| Summary vs real data | BLOCKED | Required read model endpoint absent; no independent totals reconciliation |
| Filters / pagination / no missing or duplicate rows | BLOCKED | Endpoint absent; no Live result set to enumerate |
| Warehouse scope | BLOCKED | No authenticated Live Control Tower queries |
| ON_TIME / AT_RISK / OVERDUE | BLOCKED | No Live backend SLA projection; no test data created or timestamps edited |
| Aging / stage transition reset / missing timestamp | BLOCKED | No Live projection; no transition or data alteration performed |
| Shipment / Transfer / Trip exact deep links + F5 | BLOCKED | Control Tower entry points absent |
| Desktop / mobile KPI, priority, filters, pagination | BLOCKED | Requested UI absent; local screenshots are not Live screenshots |
| Loading / empty / error UI | BLOCKED | Requested UI absent; no mocked response presented as staging evidence |
| Shipment regression | BLOCKED / UNVERIFIED | No business smoke of the new release |
| Pickup / delivery regression | BLOCKED / UNVERIFIED | No business smoke of the new release |
| Warehouse transfer regression | BLOCKED / UNVERIFIED | No business smoke of the new release |
| Strict line-haul regression | BLOCKED / UNVERIFIED | No new-release smoke or effective enforcement verification |
| Notification deep-link regression | BLOCKED / UNVERIFIED | Prior build evidence is not a fresh regression of the Control Tower release |
| Full CI Linux / Node 22 | BLOCKED | See isolated verification scope below |

The release gate blocks feature acceptance before business test actions. Session discovery additionally found no staging Admin/Dispatcher tab on the previously used CDP ports: 9222 contained only an unrelated widget; 9223–9226 were unavailable. This does not establish that saved profiles or user sessions elsewhere are expired.

## Linux / Node 22 evidence

Docker Linux is available. An isolated, network-disabled container ran a clean Git checkout of a disposable snapshot of existing tracked and non-ignored untracked workspace files. Local environment files, credentials, host Git metadata, node_modules, and generated outputs were not copied. The runner has no staging or database connection. `db:generate` only generates the Prisma client from the schema; it does not execute migrations.

Source archive SHA-256: `01f3f4c326412108cbde85fc87dd9e95e857d4b529be5106271f3bceb1ec52f1`; 655 files. Host HEAD remains `6354dc6b157438ce9176499c4b24fa70e9f6f017`. Disposable snapshot SHA: `b1e5a184a48632b4cf759d17e48ee0e799eefcfd`; this is **not** a published or deployed commit. Runtime: Linux, Node `v22.23.2`, npm `11.18.0`.

The isolated run completed at **2026-10-06 01:51:46 ICT**, exit code 0:

| Isolated clean-checkout gate | Result |
|---|---|
| Offline `npm ci`, pinned npm, Node 22, Linux | PASS |
| Prisma client generation | PASS |
| Backend + frontend lint | PASS |
| Backend + frontend typecheck | PASS |
| Backend unit tests | PASS — 511/511, 60 suites |
| Frontend unit tests | PASS — 72/72 |
| Backend + frontend production build | PASS |
| Paired release provenance | PASS — both artifacts carry disposable snapshot `b1e5a184a48632b4cf759d17e48ee0e799eefcfd` |
| `git diff --check` and checkout remains clean | PASS |

Non-failing output includes dependency deprecation/install-script notices, expected negative-case test logs and the existing Vite large-chunk warning. No dependency or product change was made to suppress them.

Full CI remains BLOCKED / UNVERIFIED. The existing `.github/workflows/release.yml` → `deploy/ci/verify.sh` includes database creation, migration replay/deploy and integration fixtures. It was not invoked under this task's no migration/reset/seed restriction. No hosted CI result for a committed Control Tower release was available. Live Node 22 runtime and partial local checks do not substitute for the full CI gate.

## Evidence and changes

- `test-results/control-tower-staging/release.json`: sanitized HTTP status, identity, request ID and public-asset evidence.
- `test-results/control-tower-staging/live-entry.js`, `admin-routes-Bhki1V3E.js`, `dispatcher-routes-1kWmGWW6.js`: served public assets.
- `test-results/control-tower-staging/probe.mjs`: read-only staging probe.
- `test-results/control-tower-staging/source-manifest.json`, `source-paths.txt`, `source.tar`, `prepare-snapshot.ps1`, `ci-readonly.sh`, `ci-readonly.log`: isolated Linux validation inputs and output. These local evidence files are ignored by Git.
- Documentation changed in this task: this report and a short `PROJECT_STATE.md` update. Existing product changes and unrelated documentation deletions were preserved.
- No Live Control Tower screenshots: the feature was not served. Routes awaiting verification: `/admin/control-tower` and `/dispatcher/control-tower`.

Enforced boundaries: backend authority and role checks are not simulated or bypassed; business history/data remain unchanged; local test success is not reported as staging success. No new migration is needed for the local implementation, and no migration was executed in this validation task.

## Unblock conditions

1. A release containing the existing Control Tower implementation must be committed and deployed through the release process; record its intended SHA. This validation-only task does not authorize that deployment.
2. Confirm both Live identities and the actual served bundles match that release, then use authenticated Admin/Dispatcher and negative-role sessions for the acceptance matrix.
3. Compare existing real SLA/aging cases with lifecycle timestamps. Any missing test case remains UNVERIFIED unless it can be exercised within the authorized normal workflow; do not seed or rewrite timestamps.
4. Obtain full clean-checkout CI evidence for the same committed release, with CI scope reconciled with the restriction on migrations/fixtures.

**CONTROL TOWER STAGING: BLOCKED**
