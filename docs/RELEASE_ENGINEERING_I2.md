# Phase I2 — Release Engineering + Staging Preparation

Scope: existing application only; no new feature, provider enablement, production deployment or migration-history mutation. Verification is recorded below; staging infrastructure is not assumed from local container success.

## Migration integrity investigation

Read-only inspection of configured development on 2026-09-09: 25 successful migrations, 23 exact matches, two H2/H3 mismatches, zero unresolved failures and zero unknown history rows. Removing only I1's leading comment, `BEGIN;` and `COMMIT;` from the current H2/H3 text reproduces **exactly** each applied SHA-256:

| Migration | Applied legacy SHA-256 | Canonical I1/I2 SHA-256 |
|---|---|---|
| `20260907170000_phase_h2_shipping_fee_reconciliation` | `b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f` | `4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb` |
| `20260907210000_phase_h3_shipping_fee_online_payment` | `f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386` | `8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228` |

Root cause is the I1 transaction-boundary repair, not a newline conversion or changed business DDL. PostgreSQL requires new enum values to commit before dependent CHECK constraints; canonical scripts now commit that phase explicitly. A failure after that commit can leave partial DDL, so blind retries are prohibited. Invariants affected: C05 preserve history, C10 integrity/concurrency, C18 repeatable release verification.

Canonical source is all **25 current SQL files** plus `migration_lock.toml`, pinned by `backend/prisma/migrations.manifest.json`. I2 did not edit any SQL migration or any `_prisma_migrations` row. `.gitattributes` disables migration newline conversion to preserve exact SHA-256 bytes on Windows/Linux.

The incoming Git HEAD is `669e6fabdc253c4eb282bf4e2572c3eb071f6134` (Phase 9); later migrations are untracked. The pre-existing Phase 5 SQL repair also differs from that HEAD, but its current bytes match the applied development checksum. The manifest records that exact bootstrap Git tree, with this one documented adoption exception. It does not whitelist H2/H3 applied mismatches. After the first reviewed manifest commit, baseline comparisons reject editing/deleting/reordering old migrations even if a PR also updates the current manifest. New migrations must append after the previous tail; review and append their exact hash explicitly, never auto-regenerate old entries in CI.

`migration-integrity.mjs` checks exact local hashes, a trusted Git base SHA and optional DB history in a read-only repeatable-read transaction. DB validation rejects edited applied checksums, pending migrations (post-deploy), unknown/duplicate/unresolved rows, gaps and unmanaged nonempty databases. Pre-deploy allows only a canonical applied prefix plus pending tail. Regression tests cover these fail-closed conditions; no repair option exists.

## Safe reconciliation decision

1. **New staging:** provision an empty DB and apply canonical migrations with the Linux migration image. This creates matching history without touching development. Do not clone the two mismatched history rows into staging.
2. **Existing development:** preserve the original DB and all history unchanged. It remains blocked by the release checksum gate. No SQL `UPDATE`/`DELETE`, migration reset, or `resolve --applied` is used to hide successful checksum differences.
3. **If representative data is required:** snapshot the legacy DB, restore into an isolated investigation environment, compare catalogs and validate constraints. A separately reviewed data-only transfer into a newly canonical-migrated DB must preserve IDs, ownership, business histories and referential consistency, exclude `_prisma_migrations`, and verify counts/ledgers/constraints before switching consumers. No such data movement is performed in I2. Alternatively use new staging test accounts/data through supported APIs.
4. Existing environments needing in-place reconciliation remain blocked until an explicit reviewed strategy exists. Appending a migration cannot make an old applied checksum match; changing the ledger is not the chosen strategy.

## Release artifacts and evidence

The Linux workflow, Docker targets, Nginx WebSocket/SPA config, strict healthcheck, production env template and staging checklist are described in [DEPLOYMENT.md](DEPLOYMENT.md). No new application capability or business policy was added. Browser fixture env loading accepts a clean checkout with environment injection and no `.env` file. The existing localhost audit-rate isolation is reused before each actor login: Linux runs can perform the multi-actor F journey within the shared IP's 60-second login quota. Production rate limits are unchanged; full Playwright still runs with zero retries.

## Dependency audit remediation

The live Linux registry audit found 13 high findings on the incoming lockfile; cached/offline workstation output of zero was **not** accepted as release evidence. The gate stopped. No advisory was suppressed and `audit fix --force` was not used (its proposed Nest/Prisma downgrades would change the stack).

- Nodemailer `9.0.5 → 9.1.1`; maintainer [advisory/fix](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-8m3c-c648-2xjj).
- Nest's existing Multer dependency `2.2.0 → 2.3.0`; maintainer [advisory](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm).
- Prisma tooling's existing MySQL2 dependency `3.15.3 → 3.24.4` (including its `sql-escaper` transitive dependency). The product still uses PostgreSQL only. [Maintainer advisory](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-rgwj-5xj2-c3m3).
- js-yaml patched within each existing major: `3.15.1 → 3.15.2`, `4.3.1 → 4.3.2`; existing 5.x unchanged. [Maintainer advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
- Prisma config's deepmerge-ts `7.1.5 → 8.0.2` via an explicit transitive override. [Maintainer advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx) requires 8.x; [8.0 release notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) describe changed Map merging and merge-into behavior. This repo's Prisma config uses plain objects, not Maps/merge-into. Actual Prisma generate/deploy/status/diff must pass with this override. Remove it when the pinned Prisma line supplies a patched compatible dependency; do not silently broaden the override to application use.

Overrides are limited to those existing package names; direct Nest/Prisma versions remain fixed. The Linux resolver regenerated the exact affected resolutions after the workstation resolver retained the old transitive lock entries. Release audits explicitly set `--offline=false`. Production image installation also omits optional peers: `--omit=dev` alone retained Prisma CLI through @prisma/client's optional peer. The runtime image must pass the assertion that CLI/migrations/.env are absent and its UID is non-root.

## Final verification

| Gate | Result | Evidence / limit |
|---|---|---|
| Linux clean checkout | PASS | `deploy/ci/clean-checkout.sh` created an isolated Git snapshot inside a Docker CI image, cloned it into an empty directory and ran `npm ci` + all `verify.sh` gates. No workstation node_modules/dist/.env reused; primary Git repository was not committed or modified by this snapshot operation |
| Lint / typecheck / unit | PASS | Both workspaces; 240 backend unit tests, 32 frontend tests, 2 migration-gate regression tests |
| PostgreSQL/Redis E2E | PASS | All 21 suites / 76 tests, isolated localhost services |
| Production builds | PASS | Backend `dist/main.js`, Vite same-origin/REAL frontend; Docker targets backend/frontend/migration built on Linux |
| Prisma migrations | PASS on fresh DB | All 25 applied, second deploy no-op, status up-to-date, exact applied checksums 25/25, migration→schema and DB→schema diffs both empty; separate SQL replay twice matches columns/constraints/indexes/enums |
| Git/canonical migration gate | PASS | Original Phase 9 Git baseline checked separately; clean snapshot baseline and exact canonical files checked during CI |
| Legacy development preflight | EXPECTED BLOCK | Read-only current database rejected for applied H2/H3 mismatch; no history or business-data mutation |
| Chromium Playwright | PASS | 8/8, retries=0, patched dependencies; fixture login isolation resolves Linux speed/shared-IP quota failure |
| Compiled production smoke | PASS | Actual production Nest process with disabled providers: health/auth/RBAC/cookies/origin/rate-limit/log-redaction/socket revocation |
| Production containers / HTTPS | PASS | Non-root backend UID 1000, no .env/migration SQL/Prisma CLI in runtime; same-origin frontend SPA/assets, API/auth/secure cookies and real WebSocket upgrade/revocation through two proxies with explicitly trusted CI certificate |
| SIGTERM / restart | PASS for idle lifecycle | Exit 143, no OOM/forced kill; health and HTTPS/socket smoke after restart. In-flight workload/SMTP/queue-drain and operational restore drills remain staging checks |
| Dependency audit | PASS, live feed | Full and `--omit=dev`, `--offline=false`: 0 findings after remediation; not an OS image vulnerability scan |
| Secrets / whitespace / configs | PASS | Workspace + all 7 reachable Git revisions: 0 heuristic findings; clean snapshot scan: 0; `git diff --check`, YAML parse, Compose validation and Linux shell checks |
| Hosted GitHub CI / real staging | NOT RUN | Incoming A→I2 working tree still requires review/commit/push; no registry, managed services, public DNS/TLS ingress, SMTP or staging credentials were provisioned in this task |

Final tested lockfile SHA-256: `4f320a6b6b4fca857a8f92e68f6bb118339980e65caa055d20a149a35bcf75ee`. Local ignored evidence: `test-i2-verified-checkout.log`, `test-i2-*-audited*.log`, `test-results/i2/`; initial failures remain separate from the successful final run. The first clean run demonstrated that an audit failure stops the pipeline; it is not counted as a passing run. The primary Git secret scan also covers the seven original revisions, which the disposable snapshot does not contain.

**I2 repository preparation is complete; staging promotion is conditional on the external checklist in [DEPLOYMENT.md](DEPLOYMENT.md).** No production or external staging deployment occurred. The Windows schema-engine block remains a workstation constraint; Linux Prisma verification passed without modifying Application Control. Existing development checksums remain intentionally unreconciled in place.

## Files changed by I2

- CI/integrity: `.github/workflows/release.yml`, `.gitattributes`, `backend/prisma/migrations.manifest.json`, `backend/scripts/migration-integrity.mjs` and its regression test.
- Artifacts/config: `Dockerfile`, `.dockerignore`, `deploy/migrate.sh`, `deploy/healthcheck.mjs`, `deploy/nginx.conf`, `deploy/staging.compose.yml`, `deploy/.env.example`, `deploy/ci/*`, root `.env.example` and `.gitignore`.
- Dependency/fixtures: root `package.json`, `package-lock.json`, `backend/package.json`, browser `support/environment.ts`, `support/test.ts`, `support/browser-session.ts`.
- Documentation: this report, `docs/DEPLOYMENT.md`, `README.md`, `PROJECT_STATE.md`. Existing unrelated A→I1 work was preserved. No migration SQL was changed by I2.
