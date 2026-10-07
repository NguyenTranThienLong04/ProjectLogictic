# F01 — startReturn ownership and response privacy

Date: 2026-10-07 (Asia/Saigon). **F01 STATUS: CLOSED — locally verified.**

Scope: `POST /api/v1/driver/delivery-assignments/:shipmentId/start-return` only. No F02/F03/P1/P2 changes, deployment, migration, reset or seed. Existing local PostgreSQL test database reused; E2E suites created and cleaned only their own test fixtures.

## Root cause and fix

The `RETURN_IN_TRANSIT` early return preceded failed-attempt ownership, active User/Driver and superseding-assignment validation. It returned `current` with `deliveryAttempts.driver.user: true`, exposing the raw User including `passwordHash` and `tokenVersion`. The controller passed it through; the global interceptor only wrapped it in `{ data, meta }`.

`DeliveryService.startReturn` now performs all existing ownership checks before either success branch. Non-owners receive the existing `404 RETURN_ATTEMPT_NOT_FOUND`; a superseding active assignment still produces `409 RETURN_OWNERSHIP_SUPERSEDED`, including on retry. The existing lifecycle policy and conditional transition remain unchanged.

The authorization query selects only the Shipment/attempt/Driver fields it needs and User `status`. Both success branches read the same explicit Shipment scalar allowlist. No Driver/User/session relation is selected into the response; no password/token/session denylist is relied on in production code.

Invariants: C01 backend authority, C04 resource scope, C09 idempotency, C15 response privacy, C18 regression tests. Existing history and concurrency logic are preserved.

## Behavior and compatibility

| Request | Before | After |
|---|---|---|
| Owner first start | 200; transitions to RETURN_IN_TRANSIT | Same |
| Owner retry | 200; raw nested attempt/Driver/User | 200; same explicit Shipment shape as first start |
| Non-owner before transition | 404 | 404 RETURN_ATTEMPT_NOT_FOUND |
| Non-owner after transition | 200 with shipment/User snapshot | 404 RETURN_ATTEMPT_NOT_FOUND; no snapshot |
| Retry after assignment ownership superseded | Bypassed ownership conflict | 409 RETURN_OWNERSHIP_SUPERSEDED |

URL, method, envelope and all Shipment scalar fields returned by the previous first-call success are preserved. The accidental nested `deliveryAttempts.driver.user` expansion on retries is intentionally removed. Authorized owner retries create no additional tracking, audit or notification records. Migration required: **NO**.

## Files changed

- `backend/src/modules/assignments/delivery.service.ts`: ownership ordering and explicit query/response selection.
- `backend/src/modules/assignments/driver-deliveries.controller.ts`: Swagger description for safe idempotent responses.
- `backend/src/modules/assignments/delivery.service.spec.ts`: non-owner before/after, safe owner start/retry, superseded owner before/after.
- `backend/test/phase5.e2e-spec.ts`: A–E real HTTP/PostgreSQL assertions, recursive sensitive-key check, no snapshot on rejection, equal retry data, unchanged persisted state and one tracking/audit/notification record.
- `PROJECT_STATE.md` and this report: F01 status and verification evidence. Earlier workspace edits were retained.

`api-response.interceptor.ts` was inspected and left unchanged: it is an envelope wrapper; privacy is enforced at the service query/response boundary.

## Verification

| Check | Result |
|---|---|
| Regression against old implementation | Expected FAIL: 3 newly covered cases reproduce unauthorized retry, raw secret-bearing response and superseded-owner bypass |
| Delivery/assignment/candidate/transition unit suites | PASS 47/47 |
| Phase 5 E2E, including A–E | PASS 1/1 workflow |
| Phase 3 assignment E2E | PASS 1/1 workflow |
| Phase H1 delivery/collection E2E | PASS 4/4 |
| Operational assignment/delivery regression | PASS 24/24 across four scenario runs |
| Workspace lint | PASS |
| Workspace typecheck | PASS |
| Backend + frontend build | PASS |
| `git diff --check` | PASS |

The first combined operational run passed 6 cases and failed 18 at fixture login with HTTP 429. Rerunning each of the four existing scenarios in its own Redis logical namespace passed 6/6 each, covering all 24 cases; application throttling, tests and business logic were not weakened. No Redis flush/reset was used.

Commands: `npm run test --workspace backend -- --runTestsByPath` with `delivery.service.spec.ts`, `assignments.service.spec.ts`, `assignment.policy.spec.ts`, `assignment-candidates.service.spec.ts`, `shipment-transition.policy.spec.ts` under `src/modules/assignments/`; `npm run lint`; `npm run typecheck`; `npm run build`. Local guarded E2E runner/evidence: ignored `test-results/f01/run-e2e.mjs`, `e2e-results.json`, `operational-split-results.json` (rerun mode `--operational-split`).

Environment: Windows, Node 24.13.1, existing PostgreSQL 17 on localhost:55432 and dedicated local Redis on port 56379. This is local verification, not Node 22 CI or staging/deployment verification. Build emitted existing non-blocking unknown release-SHA and frontend chunk-size warnings.

## Nearby privacy audit

Inspected delivery list/detail, assign, start, complete, fail (including retry/recovery paths), requestReturn/redeliver, their controller delegation and the API envelope interceptor. The delivery assignment query still loads User internally, but these assignment responses all pass through the existing explicit `response()` mapper. Neighboring return/redelivery queries return Shipment scalars without User relations. No additional equivalent raw nested-User leak was found in this scoped review; no global privacy audit is claimed and no unrelated endpoints were changed.
