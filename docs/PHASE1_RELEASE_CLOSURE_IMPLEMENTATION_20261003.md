# Phase 1 release closure implementation — 2026-10-03

**PHASE 1 FUNCTIONAL: PASS within the verified scope below. RELEASE INTEGRITY: BLOCKED. READY FOR STAGING DEPLOY: NO.** Dependency, controlled migration integrity, build provenance and local Node 22/Linux gates now pass. Staging email intent/configuration remains **UNKNOWN**, as explicitly confirmed by the user; this does not qualify for the intentionally-disabled-email path or a waiver. No staging deployment was performed.

This report supersedes the implementation gaps in [the earlier closure audit](PHASE1_RELEASE_CLOSURE_20261003.md), while retaining its historical evidence. It does not claim a hosted GitHub run or current Render Live verification of these changes.

## A. Dependency security — PASS

| Gate | Before | After |
|---|---|---|
| Full exact-lock online audit | 9 package findings: 4 HIGH / 5 moderate | **0** |
| Production inventory online audit | 8 package findings: 3 HIGH / 5 moderate | **0** |
| Reachable runtime HIGH remaining | YES, Engine.IO among the exposures | **NO** |
| Waivers | No approved waiver | **None needed or granted** |

The [dependency report](PHASE1_DEPENDENCY_REMEDIATION_20261003.md) and [machine-readable inventory](PHASE1_DEPENDENCY_REMEDIATION_20261003.json) enumerate every original package/version, advisory/CVE, direct/transitive status, runtime/dev path, affected code path, fixed version, semver impact and breaking risk. The nine package findings aggregate 24 distinct advisories, including inherited parent findings.

Minimum changes: Engine.IO **6.6.9 → 6.6.10** under unchanged Socket.IO 4.8.3; Nest platform-express **11.2.1 → 11.2.6** with Multer **2.4.0**; Axios **1.19.0 → 1.20.0**; scoped Swagger YAML **5.3.0 → 5.4.1** without upgrading Swagger; fast-uri and affected brace-expansion lines receive safe patches. Nodemailer **9.1.1 → 10.0.9** is the necessary application major and is covered by the real SMTP adapter E2E below. No forced audit fix or unrelated bulk upgrade was used.

The root package manager is pinned to **npm 11.18.0**, also installed in Docker and GitHub CI. Earlier npm versions failed to apply the workspace security overrides correctly; the fixed resolver is required to reproduce the lock. This also enforces the already-existing TypeScript 6 override in the Nest CLI subtree. Future native Render builds must install the pinned resolver before `npm ci`; the exact build instructions are in [release provenance](RELEASE_PROVENANCE.md).

Final lock SHA-256: `5b6aaf0778322e8780c53c07283b7438f1c20546fff98dea4ae618a80d13a0ae`. Both audits were rerun online after the complete canonical test/build sequence and reported zero. The regression against the actual installed Engine.IO rejects mismatched or omitted EIO upgrade revisions, keeps the process/session usable, and permits valid polling → WebSocket upgrades.

## B. Migration integrity — PASS with explicit legacy exception

| Check | Result |
|---|---|
| Exact H2/H3 historical/current checksum pairs on the audited target | **PASS_WITH_LEGACY_EXCEPTION** |
| Wrong H2, wrong H3, swapped/reused hashes, altered expected current checksum | Rejected; regression **PASS** |
| Other edited migration / new migration drift | Rejected; strict regression **PASS** |
| Current SQL bytes, manifest coverage and provider lock | **PASS**, all 26 migrations |
| Disposable CI applied history, Git baseline, replay and schema diff | **PASS**, strict mode |
| Actual staging history, read-only check | **26/26**, only H2 and H3 listed as exceptions |

The exception is opt-in through `--legacy-staging-h2-h3`, with exact migration IDs, historical hashes, current canonical hashes and the audited staging target pinned. It requires verified TLS and the expected connected database. [The policy and provenance](PHASE1_LEGACY_CHECKSUM_EXCEPTION.md) record all four hashes and explain the transaction-boundary repair; reconstruction from current SQL reproduces both applied hashes exactly. The original-at-apply Git artifact is not available and is not claimed recovered.

The fresh staging check used only a read-only transaction, SELECTs and ROLLBACK. `sslmode=verify-full` was supplied in memory; no private env file or database record was changed. Its retained output is `test-results/release-closure/staging-history.log`. There are no changes to migration SQL, the migration manifest or the database ledger. All 14 integrity tests pass.

The separate `deploy/migrate.sh` mutation job remains strict and does not opt into this read-only exception. Do not run that job against the legacy staging ledger expecting this flag to be inherited. This closure neither requires nor authorizes a staging migration; a later migration-job policy change would need its own review. The read-only release check now recognizes the documented historical pairs without bypassing other integrity rules.

## C. Release provenance — implementation and local verification PASS

| Artifact / endpoint | SHA available | Verified value |
|---|---|---|
| Local immutable CI snapshot | YES | `644f3174ec0073e5fe42c540f3edc77cdda4219c` |
| Production backend startup and `/api/v1/health/version` | **YES** | Same snapshot SHA; runtime Node **v22.23.2** |
| Production frontend bundle and `/release.json` | **YES** | Same snapshot SHA |
| Current Render backend Live | UNKNOWN | Not deployed or identified by this task |
| Current Render frontend Live | UNKNOWN | Not deployed or identified by this task |

Both local production images recorded build time **2026-10-03T07:48:31.000Z**. The earlier direct CI builds recorded their own real times separately: backend `2026-10-03T07:46:52.111Z`, frontend `2026-10-03T07:46:58.728Z`, with the same tested SHA. Different build times across independent builds are valid.

Only allowlisted metadata is logged/exposed. Builds accept validated full `RELEASE_SHA`, `RENDER_GIT_COMMIT` or `GITHUB_SHA`; conflicting or malformed sources fail without echoing their contents. Missing source becomes `unknown`; CI verification rejects missing identity. Runtime env cannot replace the baked backend SHA. There is no branch-HEAD fallback, manual application SHA, env dump or secret projection.

The SHA above is a **real disposable Git snapshot created inside the local CI image**, then cloned for the clean-install gate. It is not the host branch HEAD, a published release commit, or a claimed GitHub Actions run. The final production images were built from an archive of that exact snapshot. Comparing **608 non-documentation source files** with the worktree found **0 mismatches**; documentation added after verification is outside that comparison. [Artifact evidence](PHASE1_RELEASE_CLOSURE_IMPLEMENTATION_20261003.json) records full image IDs, timestamps, lock hash and comparison scope. These local image IDs are not registry digests.

For a future authorized deployment, record backend and frontend separately and require **CI tested SHA = backend Live SHA = frontend Live SHA**. The [provenance runbook](RELEASE_PROVENANCE.md) contains the Render build configuration and verification procedure. Current Live identity remains unverified; future deployment equality is not claimed from local artifacts.

## D. Password-reset email — CI PASS; staging UNKNOWN

| Item | Evidence |
|---|---|
| Staging `EMAIL_DELIVERY_ENABLED` | **UNKNOWN** |
| Staging SMTP/provider configured and usable | **UNKNOWN** |
| Intended staging real delivery | **UNKNOWN**, user confirmed uncertainty |
| Full real-adapter SMTP sandbox E2E | **PASS, 4/4**, inside Node 22/Linux CI |
| Real staging mailbox receipt/reset | **NOT VERIFIED** |
| Disabled-email staging waiver | **None** |

The dedicated suite uses the real Nest HTTP application, PostgreSQL/Prisma, Redis/BullMQ worker and Nodemailer 10.0.9 with an authenticated test-owned SMTP mailbox. It verifies forgot-password → queued email → received MIME/link → valid stored token hash → reset → rejection of all three old access/refresh sessions and old password → successful new-password login/refresh. Additional cases verify enumeration resistance, one-time token reuse rejection, temporary SMTP 451 retry and expired delivered-token rejection.

The sandbox is private to the disposable test process and does not forward mail. No app email provider/guard is mocked, no public debug token endpoint exists, and tokens/mailbox content are not exported in diagnostics. [The email report](PHASE1_PASSWORD_RESET_EMAIL_20261003.md) documents configuration evidence, exact coverage and staging limitations.

Source defaults and incomplete older local env files cannot establish actual Render settings. The user asked to retain UNKNOWN; no additional real staging email request was made. Closing this remaining evidence gap requires a sanitized attestation of delivery intent and actual configuration. If staging intends real delivery, verify the normal forgot/reset flow using an owned real/sandbox mailbox; if deliberately disabled, document that intended limitation alongside the passing full SMTP CI evidence. UNKNOWN cannot be silently treated as disabled.

## E. Tests and release gate

Canonical local Linux runner: **Node v22.23.2 / npm 11.18.0 / PostgreSQL 17 / Redis 7.4 / Chromium**, clean snapshot clone and `npm ci`. The final runner exited **0** and printed `PASS I2 Linux verification gates`. Hosted GitHub Actions was **not run on these worktree changes**; its updated workflow uses Node 22 and the same gate scripts.

| Verification | Result |
|---|---|
| Backend unit | **487/487**, 56 suites |
| Frontend tests | **65/65** |
| PostgreSQL E2E | **109/109**, 23 suites; includes SMTP 4/4 |
| Playwright, retries disabled | **8/8** |
| Migration integrity regressions | **14/14** |
| Engine.IO transport security regression | **1/1** |
| Shared provenance/CLI regressions | **15/15**; backend/frontend metadata cases also included in their suites |
| Lint / typecheck | **PASS / PASS** |
| Backend / frontend production build | **PASS / PASS** |
| 26 migrations: fresh apply, repeat deploy, status, exact history, two schema diffs | **PASS**, disposable DBs only |
| Independent SQL replay twice and catalog comparison | **PASS** |
| Production artifact smoke | **PASS**: startup/version, readiness, auth/RBAC, secure cookie, socket revocation, rate limits/proxy, redaction |
| Production container HTTPS/proxy and lifecycle | **PASS**: SPA/cache, paired identity, auth, WebSocket, revoked session, SIGTERM/restart |
| Online full / production npm audits | **0 / 0 findings** |
| Secret heuristic | **0 findings**: isolated CI snapshot plus separate host scan of 23 Git revisions |

Auth/socket/GPS regression includes real API/Redis/Socket operational browser journeys and session revocation. Browser/simulation GPS is synthetic; no new physical-device or live staging GPS claim is made. The existing logistics workflow, ownership, transaction, audit and realtime invariants **C01/C04/C05/C09/C10/C16/C18** remain covered; no logistics business policy was changed.

The final authoritative logs are `test-results/release-closure/linux-ci-verified.log` and `container-verified.log`. Earlier attempts remain diagnostic only. Two release-test issues were corrected: final production builds now run after Nest watch used by Playwright stops clearing `dist`, and an unnecessary fake credential was removed from a pure migration URL fixture so the unchanged secret scanner passes. No test, audit threshold or secret rule was disabled. Existing frontend chunk-size warnings and Vite proxy disconnect messages during browser shutdown did not fail the gates; performance work is outside scope.

## Files changed and remaining action

Changes are confined to package manifests/lock; migration integrity/preflight and tests; backend build/startup/health metadata; frontend Vite/console metadata; CI/Docker provenance wiring; test-only Engine.IO and SMTP regressions; and release documentation/PROJECT_STATE. Reused existing health, migration, notification and CI boundaries. No migration SQL, staging reset/history rewrite, logistics feature or performance optimization was introduced.

The implementation work and local gates are complete. Before a release-integrity PASS, resolve the **UNKNOWN staging email classification** with evidence under section D. For a later deployment, retain a hosted CI result for the actual release commit and compare both Live identities using section C. No push, image publication, Render configuration change or staging deployment was performed here.

- **PHASE 1 FUNCTIONAL: PASS**
- **RELEASE INTEGRITY: BLOCKED** — staging email intent/configuration and applicable delivery evidence remain unknown.
- **READY FOR STAGING DEPLOY: NO**
