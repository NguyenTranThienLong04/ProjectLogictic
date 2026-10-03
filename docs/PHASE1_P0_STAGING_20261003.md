# PHASE 1 P0 — staging verification

Report date: 2026-10-03 (Asia/Saigon). Business regressions ran on 2026-09-29; the latest infrastructure, schema and release checks ran on 2026-10-02. **Overall: STAGING BLOCKED.** Functional passes below do not waive the failed release gates.

Scope: the five verified P0 issues and the requested staging smoke. No new feature, performance work, dependency upgrade, staging migration/reset or historical rewrite. The user explicitly permitted disposable CI databases and prohibited migration/reset on staging. Synthetic business fixtures were created through normal authenticated staging APIs; direct staging database checks were read-only.

## Release identity and runtime

| Evidence | Value / status |
|---|---|
| Backend | https://logistics-staging-api.onrender.com |
| Frontend | https://logistics-staging-web.onrender.com |
| Main commit when the user reported both Render services auto-deployed | `68869cbc30ce93574fa4e50fb228ed53c05f2b9d`; still remote main at the 2026-10-02 check |
| Independently verified exact Live backend/frontend SHA | **UNVERIFIED**. Supplied Live logs do not contain both commit identities; GitHub exposes no Render deployment records, and no authenticated Render management session/API access was available. Do not treat the main SHA as proof of the running backend. |
| CI source | `9b0ad498fa2364593472fabf714a36f8c7660549`, branch `release/phase1-p0-20260928` |
| Source difference between main and CI source | Five test/verification files only, listed below. Runtime application source, dependencies and schema are identical. This does not make the two commits identical. |
| CI runtime | Ubuntu 24.04, Node **22.23.2**, PostgreSQL 17, Redis 7.4 |
| Render frontend build runtime | Node **22.23.3**, from user-supplied Render build log; static site reported Live |
| Render backend runtime | Nest production process reported Live, listening on `0.0.0.0:10000`; exact Node version absent from supplied backend logs |
| Live frontend fingerprint | `/assets/index-BGj12pP4.js`, 203,774 bytes, SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`; unchanged at the 2026-10-02 check |

The user performed the Render auto-deploy. The agent did not promote the later CI branch, change Render configuration or push it to main.

## Release gates

[GitHub Actions run 36518532003](https://github.com/NguyenTranThienLong04/ProjectLogictic/actions/runs/36518532003) ran the repository's Linux release workflow on the exact CI SHA above, with image publication disabled.

| Gate | Result | Evidence / limit |
|---|---|---|
| Backend + frontend lint | **PASS** | Canonical CI commands |
| Backend + frontend typecheck | **PASS** | Canonical CI commands |
| Backend unit | **PASS** | 479 tests, 55 suites |
| Frontend regression | **PASS** | 64 tests |
| PostgreSQL/Nest/Redis E2E | **PASS** | 105 tests, all 22 suites, including operational journeys and deterministic auth races |
| Migration integrity unit tests | **PASS** | 2 tests |
| Backend + frontend production build | **PASS** | Runnable backend artifact and frontend assets |
| Disposable CI migration gates | **PASS** | Canonical 26-migration inventory/checksums and baseline comparison; deploy, repeat no-op deploy, status, schema drift, independent SQL/shadow replay |
| Browser regression | **PASS** | 8/8 Playwright tests, retries disabled |
| Production-artifact smoke | **PASS** | Health, auth/RBAC, refresh cookies/origin checks, socket revocation, rate/proxy checks and log redaction |
| Dependency audit | **FAIL** | `npm audit --audit-level=low`: three moderate package findings; workflow stopped with exit 1 |
| Later production-only audit, secret scan, container/proxy gates | **NOT RUN** | Skipped after the failed audit; not credited as passes |
| Overall canonical CI | **FAIL** | No release-gate waiver or dependency changes |

The recorded npm audit findings concern `multer` and its parent `@nestjs/platform-express` (GHSA-3pph-fpjx-jg34), and `nodemailer` (GHSA-6vj9-mwq6-2f5v). This is the result captured by the CI run, not a fresh vulnerability assessment. The suggested dependency changes exceed the pinned ranges and this verified-P0 scope; `npm audit fix --force` was not run.

The first Linux runs exposed test/tool assumptions, then passed after the narrow evidence-based corrections below. No rate limit, business rule, assertion of financial integrity or security gate was disabled.

## Staging health and database

At 2026-10-02 12:34 Asia/Saigon, liveness, readiness and frontend returned **HTTP 200**. Readiness reported database and Redis up. An earlier liveness request timed out; its successful follow-up is recorded separately, not erased.

Read-only checks against the operator-confirmed runtime Neon database found:

- **Migration pending: NO** — 26 successful canonical names, no unknown migration or unresolved failure.
- **Schema drift: NO** — Prisma `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` returned 0, `No difference detected`, in Linux/Node 22.23.2. The session used `default_transaction_read_only=on` and TLS verification. Container and workspace schema SHA-256 both equal `71efe07c210129ba6e3ef302f71b7a32346e5f7fbf2b7c7c96b14f2ac5e94389`.
- **Strict migration history integrity: FAIL** — two historical applied checksums differ from the repository. Schema equivalence does not remove this failure.

| Migration | Applied checksum | Repository checksum |
|---|---|---|
| `20260907170000_phase_h2_shipping_fee_reconciliation` | `b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f` | `4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb` |
| `20260907210000_phase_h3_shipping_fee_online_payment` | `f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386` | `8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228` |

These are the previously documented historical byte differences, now confirmed on the database actually bound to Render. Older notes about a separate clean staging database do not describe this runtime target. No ledger checksum, migration SQL, schema or business history was repaired during this task.

**Migration required by P0: NO. Migration/reset executed on staging: NO.**

## P0 staging matrix

| Scenario | Result | Observed behavior |
|---|---|---|
| Pickup collect → COLLECTED → delivery | **PASS** | Delivery 200; original collection retained |
| Pickup collect → driver remit → REMITTED → delivery | **PASS** | Delivery 200; no second collection |
| Pickup collect → remit → Admin settle → SETTLED → delivery | **PASS** | Delivery 200; settled ledger retained |
| Unpaid / invalid fee | **PASS** | Missing and wrong receiver amounts both return 400 `SHIPPING_FEE_AMOUNT_MISMATCH`; fee remains PENDING, with no delivery success or financial mutation |
| Delivery retry | **PASS** | Repeats return 200; fee ledger and attempt/proof/COD/audit counts remain unchanged |
| Customer/Driver login; Admin session restore; F5/deep routes | **PASS** | Real staging browser flows; Admin fresh password login was not separately exercised |
| Multi-tab | **PASS** | Customer three-tab concurrent restore and F5 |
| Concurrent login vs password change | **PASS, bounded evidence** | Four concurrent old-password logins returned 200 before revocation; after change, every captured access token and refresh cookie was rejected with 401, including the baseline session |
| Forced stale-credential login interleaving | **PASS in PostgreSQL CI; not forced on staging** | Deterministic barriers cover both commit orders. Network concurrency alone cannot prove the exact read-before-change ordering |
| Normal login/refresh after change; refresh after logout | **PASS** | New password and refresh work; revoked session access/refresh return 401 |
| Password reset through email and login/reset race | **BLOCKED on staging** | The user confirmed the Customer email is fictitious. Forgot-password 200 only proves request acceptance; no real reset completed. Deterministic reset races pass in PostgreSQL CI |
| New transfer internal notes | **PASS** | Admin staff transfer API retains dispatch note; receipt note remains in Admin audit. Neither public nor owning-customer tracking exposes either marker, including repeated cache reads |
| Pre-release note-bearing tracking history | **NOT AVAILABLE on staging** | Zero matching old transfer rows. No fabricated historical rows were inserted. CI verifies old DB and pre-fix cache projection without rewriting original rows |
| Complete/fail audit by shipment ID | **PASS** | New records use `entityType=Shipment`, `entityId=shipmentId`; metadata retains attempt/assignment references |
| Legacy delivery audit lookup | **PASS** | All three existing attempt-ID delivery-complete records found through shipment-ID search, without rewriting records |
| Zero-fee config | **PASS** | Admin baseFee=0 rejected with 400 `VALIDATION_FAILED`; active config unchanged |
| Positive quote and normal create | **PASS** | Quote 32,070 VND; normal Customer shipment creation succeeds. CI additionally covers discount-to-zero and invalid legacy totals |

The cash-state policy also checks amount, collection actor/time, remittance actor/amount and settlement actor/time. Corrupt persisted-evidence combinations are covered in unit/isolated PostgreSQL tests; staging records were not corrupted to manufacture those cases.

## Core smoke and retained fixtures

Run identifier: `P0-1790653217727`. Two clearly named synthetic warehouses and dedicated Customer/Dispatcher/pickup/driver accounts were created through normal APIs. Warehouse actions used authorized Admin access. Shipment, transfer, fee and audit records are retained for inspection.

| Journey | Shipment ID | Final result |
|---|---|---|
| COLLECTED | `4666ea99-68fd-4c22-bef2-82f1a798d19e` | DELIVERED; fee COLLECTED |
| REMITTED | `f03c9bf3-e3f8-4293-a462-a9d6ae7d0099` | DELIVERED; fee REMITTED |
| SETTLED | `30de8ca7-3874-412f-8007-71652673aaeb` | DELIVERED; fee SETTLED |
| Unpaid/invalid, then legitimate failure | `ff32d597-ca02-43c4-9f33-e1dc128c34af` | DELIVERY_FAILED, recipient unavailable; fee PENDING |

| Core area | Result / coverage |
|---|---|
| Customer create | **PASS**, four real API-created shipments |
| Dispatcher confirm/assign | **PASS**, actual Dispatcher role and candidate selection |
| Driver pickup | **PASS**, accept/pickup and sender collection |
| Warehouse | **PASS**, check-in, route, transfer dispatch/receive and ready-for-delivery |
| Delivery | **PASS**, assignment/start, three completions, blocked invalid amounts and one failure |
| COD | **PASS for collection smoke**, one 450,000 VND COD transaction per successful delivery, zero for failed delivery; retry does not duplicate. COD remittance/settlement/customer payout were not exercised on staging in this run |
| Shipping fee | **PASS**, collection, driver remittance, Admin settlement and retry |
| GPS | **PASS for authenticated write/read, candidates and customer-scoped location**, using synthetic fixture coordinates. Physical device positioning is not claimed |
| Dashboard | **PASS**, Admin/operations/COD API reads; Admin, Customer and Driver browser dashboard/deep-route/F5 checks |

The financial assertions found one delivery attempt, one pickup proof plus one delivery proof, and one COD row for each delivered shipment. The failed journey has one attempt, one pickup proof, no COD collection and no shipping-fee collection. Original Admin credentials were not changed.

## Root causes, changes and compatibility

The full P0 source/test inventory and exact before/after analysis remain in [the fix report](PHASE1_P0_FIX_20260928.md). Its initial “no staging deployment” statement describes the 2026-09-28 local-only milestone; this report records the subsequent deployment evidence.

| P0 | Root cause → corrected behavior |
|---|---|
| Shipping | Delivery/retry equated paid obligation with the `COLLECTED` enum, ignoring later remittance/settlement. One backend evidence policy now accepts proven COLLECTED/REMITTED/SETTLED and valid online PAID, while rejecting unpaid/inconsistent evidence |
| Auth | Old credentials were verified before an unguarded session insert, allowing insertion after revoke-all. User-row locking and credential/tokenVersion/status validation now serialize session creation/refresh with credential mutations |
| Public notes | Dispatch/receive copied operational free text into PUBLIC tracking descriptions, including cached payloads. Backend lifecycle projection masks affected old/new public/customer reads; scoped operational/audit APIs preserve internal notes |
| Audit identity | A Shipment audit helper accepted attempt/assignment IDs as entityId. New writes always use shipmentId with references in metadata; legacy search follows proven relations |
| Zero-fee | Pricing allowed zero while shipping-fee persistence required positive money. After the user's explicit decision to prohibit zero, config/quote/create reject invalid totals consistently |

API response, cookie and JWT formats remain compatible. Fee ownership, evidence and original amounts remain mandatory. Intentional changes are rejection of invalid/stale credentials and nonpositive prices, privacy masking, and correct audit identity. Historical shipment prices, notes and audit rows are preserved. No history backfill is needed for these fixes.

Evidence-based release-verification changes:

| Files | Reason |
|---|---|
| `.gitattributes`; `backend/src/common/addresses/data/SOURCE.json` (already in main `68869cbc…`) | Dataset checksum was computed from Windows CRLF bytes; Git/Linux supplies LF bytes. Enforce LF and record the canonical LF hash after proving identical JSON content |
| `backend/test/p0-auth-races.e2e-spec.ts` | Permit only the exact disposable localhost CI database in addition to the existing isolated local P0 target |
| `backend/test/operational-flow.e2e-spec.ts` | Reset test rate-limit keys only under the guarded disposable CI/local target; four journeys otherwise consumed one shared login quota |
| `backend/test/phase7.e2e-spec.ts` | Replace obsolete attempt-ID audit expectations with shipment ID and metadata assertions, retaining duplicate prevention |
| `backend/scripts/audit-migration-replay.mjs` | Compare the exact inventory with the canonical manifest; obsolete hardcoded 25 rejected the valid 26-migration repository |
| `backend/test/browser/support/journey-helpers.ts` | Follow the current province/ward controls and explicit coordinate confirmation instead of removed free-text district/latitude inputs |
| `PROJECT_STATE.md`; this report | Record latest evidence and unresolved gates |

Verification-only commits: `d69b2441105e0ab833bf21d84a2fdf0c7685219d`, `9ac238baeeb00d8cf82f840654fc19dd0f244b15`, `9b0ad498fa2364593472fabf714a36f8c7660549`. No production application code was changed after main `68869cbc…` for these test corrections. Invariants C01/C04–C10/C12/C15/C16/C18 remain the basis of validation.

The ignored staging harness retained intermediate failures: a read-only UUID/varchar query cast, an incorrect expected 409 instead of the actual contract's 400, and stale harness session handling. Subsequent checks corrected those test assumptions and verified the stored state. These diagnostics are not deleted or counted as application regressions, and the raw report is not described as an uninterrupted all-green run.

## Remaining release plan

1. Address the dependency audit through a separately scoped, reviewed dependency change; retain the existing fail-closed CI gate. Do not silently expand this P0 task or force-upgrade dependencies.
2. Review the H2/H3 history discrepancy using the recorded checksums and now-passing schema comparison. Any remediation needs an explicit data-preserving plan; this task provides no authority to update migration history or run migration/reset on staging.
3. Supply a real test mailbox or an authenticated test account with a working reset delivery path, then run actual reset → old access/refresh rejection → new login/refresh and the concurrent login test. Do not substitute forgot-password 200 for reset evidence.
4. Obtain Render deployment metadata for both services, including exact Live commit and backend Node version. The paired-release gate stays unverified until both identities are proved.
5. After gates pass, freeze and promote the same tested SHA to backend and frontend. Recheck health, read-only migration status/schema and the requested P0/core matrix; document any unavailable historical dataset explicitly. No staging migration/reset is part of this plan.

## Local evidence index

Ignored artifacts under `test-results/p0-staging/` are retained locally and contain request IDs, fixture references and assertions, without passwords or token values in the reports:

- `post-ops.json`: final financial/audit checks, legacy lookup, browser and auth checks; includes earlier diagnostic entries.
- `live-regression.json`: original operational requests and per-journey assertions.
- `manual-reset.json`: request accepted but reset not observed; not a reset pass.
- `preflight.json`: 2026-10-02 read-only migration inventory/checksums and database checks.
- `schema-diff.json`: 2026-10-02 Linux read-only schema comparison.
- `final-health.json`: 2026-10-02 health/readiness and frontend fingerprint.
- `release-9b0ad498fa2364593472fabf714a36f8c7660549.json`: release/CI metadata.
- `ci-36518532003/1_verify.txt`: downloaded canonical CI log.

Browser profiles and temporary credential-bearing material are ignored and must not be published as report artifacts. Documentation edits after the tested commit are not represented as deployed code.
