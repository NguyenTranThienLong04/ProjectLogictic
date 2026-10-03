# Phase 1 dependency security remediation: 2026-10-03

All **9 original npm audit package entries** are fixed: full audit **9 -> 0**, production inventory **8 -> 0**. The four HIGH package entries were Axios, brace-expansion, Engine.IO and Nodemailer; three were present in production inventory. **Runtime HIGH remaining: NO. Waivers: none.** Audit thresholds remain at `low` for full and production checks. No `npm audit fix --force`, new stack dependency, logistics rule, migration/history change or staging deploy was used.

This report documents the chosen versions and exact lock inventory, not a deployed Live version. Full Node 22/Linux release checks are recorded separately by the final release-closure report; an empty audit alone does not prove application regression coverage. Prior audit documents remain unchanged. The [JSON companion](PHASE1_DEPENDENCY_REMEDIATION_20261003.json) records all node paths, shortest dependency chains including peer edges, original audit ranges/source IDs, package integrities, lock changes and evidence hashes.

## Exact lock and audit evidence

| Input | SHA-256 / result |
|---|---|
| Original exact lock at source `9b0ad498fa2364593472fabf714a36f8c7660549` | `9dc36888338f455198a0dd845bc68ca0dee49d1e090d406add37cfcb3cc1caf7` |
| Final current worktree `package-lock.json` | `5b6aaf0778322e8780c53c07283b7438f1c20546fff98dea4ae618a80d13a0ae` |
| Full before | 5 moderate / 4 HIGH / 9 total |
| Production before | 5 moderate / 3 HIGH / 8 total |
| Full after | 0 findings |
| Production after | 0 findings |

Original exact bytes were independently read using `git show HEAD:package-lock.json` as a Buffer and matched the original audit hash. The saved `lock-before.json` contains a BOM/line-ending conversion and therefore has a different byte hash; its parsed JSON was independently deep-equal to the original Git lock. The snapshot hash is retained separately in the JSON and is not mislabeled as the original exact-byte lock hash. The final lock belongs to the modified worktree and was verified in the immutable local CI snapshot documented by [the implementation report](PHASE1_RELEASE_CLOSURE_IMPLEMENTATION_20261003.md); it is not a published or hosted-CI-tested release commit.

Raw inputs: `test-results/release-closure/audit-before.json`, `audit-after.json`, `audit-after-production.json`, `lock-before.json`; production-before evidence is [the original npm audit JSON](PHASE1_RELEASE_CLOSURE_20261003_NPM.json). Advisory/CVE metadata below was checked against GitHub reviewed advisory pages on 2026-10-03. "No known CVE" means the primary advisory states none; it does not mean the package is safe. The nine package entries aggregate **24 distinct advisories**; inherited parent entries do not introduce separate vulnerabilities.

## Minimum safe changes

| Original audit entry | Before -> after | Direct/transitive | Semver impact |
|---|---|---|---|
| `@nestjs/platform-express` (moderate) | 11.2.1 -> 11.2.6 | direct | patch |
| `@nestjs/swagger` (moderate) | 11.4.7 -> 11.4.7 | direct | parent unchanged; transitive minor |
| `axios` (high) | 1.19.0 -> 1.20.0 | direct | minor |
| `brace-expansion` (high) | 1.1.18 / 2.1.4 / 5.0.9 -> 1.1.21 / 2.1.7 / 5.0.12 | transitive | patch on each existing major line |
| `engine.io` (high) | 6.6.9 -> 6.6.10 | transitive | patch within Socket.IO dependency range ~6.6.0 |
| `fast-uri` (moderate) | 3.1.7 -> 3.1.8 | transitive | patch |
| `js-yaml` (moderate) | 3.15.2 / 5.3.0 / 4.3.2 -> 3.15.2 / 5.4.1 / 4.3.2 | transitive | minor from 5.3.0; parent unchanged |
| `multer` (moderate) | 2.3.0 -> 2.4.0 | transitive | minor from 2.3.0; Nest parent patch |
| `nodemailer` (high) | 9.1.1 -> 10.0.9 | direct | major 9.x -> 10.x |

`@nestjs/platform-express@11.2.6` is the first safe 11.x parent in the captured affected range and pins `multer@2.4.0`; npm suggested the later `11.2.7`, which is unnecessary. `@nestjs/swagger@11.4.7` stays unchanged; its exact `js-yaml@5.3.0` dependency is overridden only under Swagger to `5.4.1`, avoiding the suggested Swagger 12 major. Existing safe YAML 3.x/4.x overrides stay unchanged. The version inventory table includes those unaffected copies for completeness; only the nested Swagger copy at 5.3.0 was part of this finding.

Engine.IO is upgraded **only from `6.6.9` to `6.6.10`**, the advisory minimum. `socket.io@4.8.3` already accepts `~6.6.0`; the root scoped Socket.IO override selects the safe patch. Neither Socket.IO nor Nest platform-socket.io requires a parent upgrade. The final installed copy moves to `node_modules/socket.io/node_modules/engine.io`. Namespace authentication and CORS do not eliminate the vulnerable transport-upgrade path. The fix preserves upgrades rather than replacing application realtime behavior with a mitigation. [Engine.IO advisory](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv).

Nodemailer is the required application dependency major change: `9.1.1 -> 10.0.9`, the maximum of the five fixed-version thresholds. The selected version is earlier than npm's suggested `10.0.13` and covers every captured advisory. Nodemailer 10 requires Node >=20 and changes distribution to TypeScript plus ESM/CommonJS builds, so import/types and real SMTP adapter sandbox coverage are required. Canonical Node 22 satisfies its runtime engine; engine compatibility alone is not delivery evidence. [Nodemailer 10 release notes](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0).

## Package-specific paths, advisories and risks

### 1. `@nestjs/platform-express` - MODERATE

**Scope:** backend runtime direct dependency; inherited Multer finding. **Minimum/selected fix:** 11.2.6 with multer 2.4.0. **Semver:** patch.

**Parent decision:** @nestjs/platform-express 11.2.1 -> 11.2.6; no other Nest parent upgraded. **Breaking risk:** Low: adapter patch within Nest 11; Multer API remains 2.x; parent pins patched Multer without changing unrelated Nest packages.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> @nestjs/platform-express@11.2.1`; affected node `node_modules/@nestjs/platform-express`.

**Product/library inspection:** `backend/src/main.ts`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-3pph-fpjx-jg34](https://github.com/advisories/GHSA-3pph-fpjx-jg34) / CVE-2026-88932 (moderate) | `>=2.2.0 <2.4.0` | `2.4.0` | Multer diskStorage cleanup during an aborted multipart upload; no product upload interceptor/MulterModule/diskStorage pipeline exists. |

### 2. `@nestjs/swagger` - MODERATE

**Scope:** backend runtime direct dependency; inherited js-yaml finding. **Minimum/selected fix:** retain 11.4.7 and override nested js-yaml to 5.4.1. **Semver:** parent unchanged; transitive minor.

**Parent decision:** none. **Breaking risk:** Low to moderate: overriding an exact nested pin needs clean-tree/build/Swagger dump verification; avoids suggested Swagger 12 major.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> @nestjs/swagger@11.4.7`; affected node `node_modules/@nestjs/swagger`.

**Product/library inspection:** `backend/src/main.ts`; `node_modules/@nestjs/swagger/dist/swagger-module.js`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) / No known CVE (moderate) | `>=5.0.0 <=5.4.0` | `5.4.1` | js-yaml load/merge-key budget handling; current SwaggerModule calls dump, not parsing attacker-supplied YAML. |

### 3. `axios` - HIGH

**Scope:** frontend browser runtime direct dependency; no backend Axios import. **Minimum/selected fix:** 1.20.0 covers all 12 captured advisories. **Semver:** minor.

**Parent decision:** none; frontend direct Axios pin upgraded. **Breaking risk:** Low to moderate: header/method/prototype hardening may affect custom adapters or interceptors; existing auth, refresh races and HTTP client behavior require regression.

**Dependency paths from the original exact lock:**

- `frontend@0.1.0 -> axios@1.19.0`; affected node `node_modules/axios`.

**Product/library inspection:** `frontend/src/services/api.ts`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-vh66-26gq-q6x8](https://github.com/advisories/GHSA-vh66-26gq-q6x8) / CVE-2026-101908 (moderate) | `>=1.7.0 <1.20.0` | `1.20.0` | Axios fetch adapter: inherited fetchOptions may replace outbound headers; conditional on independent prototype pollution. |
| [GHSA-9fr6-4gfg-395g](https://github.com/advisories/GHSA-9fr6-4gfg-395g) / CVE-2026-101902 (moderate) | `>=1.0.0 <1.20.0` | `1.20.0` | Axios default-instance request configuration can read an inherited HTTP method; browser usage is conditional on independent prototype pollution. |
| [GHSA-c29m-xwm3-cm6r](https://github.com/advisories/GHSA-c29m-xwm3-cm6r) / CVE-2026-101903 (high) | `>=1.16.1 <1.20.0` | `1.20.0` | Axios Node HTTP adapter fromDataURI parser; product uses Axios only in the browser, not this Node data URI path. |
| [GHSA-mghh-pgcx-3jjj](https://github.com/advisories/GHSA-mghh-pgcx-3jjj) / CVE-2026-101906 (high) | `>=1.15.0 <1.20.0` | `1.20.0` | Axios Node HTTP adapter proxy/redirect shouldBypassProxy host normalization; no product Node Axios caller. |
| [GHSA-x97p-jq2g-jp4f](https://github.com/advisories/GHSA-x97p-jq2g-jp4f) / CVE-2026-101909 (high) | `>=1.15.1 <1.20.0` | `1.20.0` | Axios toFormData option reads after independent prototype pollution; product has no custom FormData/adapter configuration. |
| [GHSA-3pq3-5fj3-cg6v](https://github.com/advisories/GHSA-3pq3-5fj3-cg6v) / CVE-2026-101898 (high) | `>=1.13.0 <1.20.0` | `1.20.0` | Axios Node HTTP/2 adapter DNS/proxy controls; product does not use Axios HTTP/2. |
| [GHSA-542g-h47m-68v8](https://github.com/advisories/GHSA-542g-h47m-68v8) / CVE-2026-101901 (high) | `>=1.13.0 <1.20.0` | `1.20.0` | Axios Node HTTP/2 session initialization error handling; product does not use Axios HTTP/2. |
| [GHSA-j8rh-479h-cp32](https://github.com/advisories/GHSA-j8rh-479h-cp32) / CVE-2026-101904 (moderate) | `>=1.0.0 <1.20.0` | `1.20.0` | Axios dispatchRequest header normalization after an interceptor replaces config without own headers; product interceptor mutates and returns its existing config. |
| [GHSA-4hqw-qxg8-jxx2](https://github.com/advisories/GHSA-4hqw-qxg8-jxx2) / CVE-2026-101900 (moderate) | `>=1.12.0 <1.20.0` | `1.20.0` | Axios fetch adapter FormData getHeaders inherited-property handling; no custom FormData/adapter configuration in product. |
| [GHSA-m8m8-qj5v-23w3](https://github.com/advisories/GHSA-m8m8-qj5v-23w3) / CVE-2026-101905 (high) | `>=1.15.2 <1.20.0` | `1.20.0` | Axios Node HTTP adapter inherited createConnection option; no product Node Axios caller. |
| [GHSA-44g4-m2mj-wpvx](https://github.com/advisories/GHSA-44g4-m2mj-wpvx) / CVE-2026-101899 (moderate) | `>=1.15.0 <1.20.0` | `1.20.0` | Axios Node HTTP proxy NO_PROXY CIDR matching; no product Node Axios caller. |
| [GHSA-r4gj-5m52-g5wh](https://github.com/advisories/GHSA-r4gj-5m52-g5wh) / CVE-2026-101907 (high) | `>=1.17.0 <1.20.0` | `1.20.0` | Axios fetch adapter maxRedirects enforcement; product does not set fetch adapter or server-side Axios requests. |

### 4. `brace-expansion` - HIGH

**Scope:** dev-only: all seven affected lock nodes have dev=true; absent in production audit. **Minimum/selected fix:** 1.1.21 / 2.1.7 / 5.0.12 for the three installed major lines. **Semver:** patch on each existing major line.

**Parent decision:** none; root overrides scoped by installed major. **Breaking risk:** Low: no major-line switch; test/lint/compiler glob behavior still verified by release gates.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> @eslint/eslintrc@3.3.6 -> minimatch@3.1.5 -> brace-expansion@1.1.18`; affected node `node_modules/@eslint/eslintrc/node_modules/brace-expansion`.
- `backend@0.1.0 -> jest@30.4.2 -> @jest/core@30.4.2 -> @jest/reporters@30.4.1 -> glob@10.5.0 -> minimatch@9.0.9 -> brace-expansion@2.1.4`; affected node `node_modules/@jest/reporters/node_modules/brace-expansion`.
- `backend@0.1.0 -> eslint@10.8.1 -> minimatch@10.2.6 -> brace-expansion@5.0.9`; affected node `node_modules/brace-expansion`.
- `backend@0.1.0 -> @nestjs/cli@11.0.24 -> fork-ts-checker-webpack-plugin@9.1.0 -> minimatch@3.1.5 -> brace-expansion@1.1.18`; affected node `node_modules/fork-ts-checker-webpack-plugin/node_modules/brace-expansion`.
- `backend@0.1.0 -> jest@30.4.2 -> @jest/core@30.4.2 -> jest-config@30.4.2 -> glob@10.5.0 -> minimatch@9.0.9 -> brace-expansion@2.1.4`; affected node `node_modules/jest-config/node_modules/brace-expansion`.
- `backend@0.1.0 -> jest@30.4.2 -> @jest/core@30.4.2 -> jest-runtime@30.4.2 -> glob@10.5.0 -> minimatch@9.0.9 -> brace-expansion@2.1.4`; affected node `node_modules/jest-runtime/node_modules/brace-expansion`.
- `backend@0.1.0 -> ts-jest@29.4.12 -> @jest/transform@30.4.1 (peer) -> babel-plugin-istanbul@7.0.1 -> test-exclude@6.0.0 -> minimatch@3.1.5 -> brace-expansion@1.1.18`; affected node `node_modules/test-exclude/node_modules/brace-expansion`.

**Product/library inspection:** `ESLint/Jest/test-exclude/fork-ts-checker/minimatch tooling; no backend/src or frontend/src direct import`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) / CVE-2026-102277 (moderate) | `<1.1.21`; `>=2.0.0 <2.1.7`; `>=4.0.0 <5.0.12` | `1.1.21` / `2.1.7` / `5.0.12` | brace-expansion expansion/rewrite of brace patterns in ESLint, Jest, glob/minimatch and Nest compiler tooling. |
| [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) / CVE-2026-102278 (high) | `<1.1.20`; `>=2.0.0 <2.1.6`; `>=4.0.0 <5.0.11` | `1.1.20` / `2.1.6` / `5.0.11` | brace-expansion expand_ recursion on nested groups, reached via tooling minimatch/glob patterns. |
| [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) / CVE-2026-102276 (high) | `<1.1.19`; `>=2.0.0 <2.1.5`; `>=4.0.0 <5.0.10` | `1.1.19` / `2.1.5` / `5.0.10` | brace-expansion parseCommaParts recursion, reached via tooling minimatch/glob patterns. |

### 5. `engine.io` - HIGH

**Scope:** backend runtime reachable HIGH before fix. **Minimum/selected fix:** 6.6.10. **Semver:** patch within Socket.IO dependency range ~6.6.0.

**Parent decision:** none; socket.io 4.8.3 and @nestjs/platform-socket.io 11.2.1 unchanged; scoped socket.io -> engine.io override. **Breaking risk:** Low: transport-upgrade hardening may reject malformed connections; auth/revocation/reconnect/polling upgrade/GPS/socket regressions required.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> socket.io@4.8.3 -> engine.io@6.6.9`; affected node `node_modules/engine.io`.

**Product/library inspection:** `backend/src/common/realtime/configured-socket-io.adapter.ts`; `backend/src/modules/notifications/notifications.gateway.ts`; `node_modules/socket.io/node_modules/engine.io/build/server.js`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) / CVE-2026-102599 (high) | `>=6.6.0 <6.6.10` | `6.6.10` | Engine.IO transport polling-to-WebSocket upgrade with protocol revision mismatch before namespace auth; ConfiguredSocketIoAdapter retains default upgrades. |

### 6. `fast-uri` - MODERATE

**Scope:** transitive runtime inventory plus dev tooling; application exploitability not demonstrated, not classified dev-only. **Minimum/selected fix:** 3.1.8. **Semver:** patch.

**Parent decision:** none; root fast-uri@^3 override. **Breaking risk:** Low: corrected host normalization may affect unusual URI refs; generation/build/tool validation required.

**Dependency paths from the original exact lock:**

- `frontend@0.1.0 -> @hookform/resolvers@5.9.0 -> ajv@8.20.0 (peer) -> fast-uri@3.1.7`; affected node `node_modules/fast-uri`.

**Product/library inspection:** `node_modules/ajv/dist/runtime/uri.js`; `backend Prisma/tooling dependency graph; product uses class-validator/Zod`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) / CVE-2026-86472 (moderate) | `>=3.0.0 <3.1.8` | `3.1.8` | fast-uri host normalization for percent-encoded octets via AJV URI/$ref resolution; product validation uses class-validator and Zod, but the package exists in production inventory. |

### 7. `js-yaml` - MODERATE

**Scope:** backend transitive runtime dependency; YAML load exploit path not used by current Swagger code. **Minimum/selected fix:** 5.4.1 for affected Swagger copy only. **Semver:** minor from 5.3.0; parent unchanged.

**Parent decision:** none; @nestjs/swagger 11.4.7 unchanged; scoped js-yaml 5.4.1 override; existing 3.x/4.x overrides preserved. **Breaking risk:** Low to moderate: exact nested pin override; current Swagger dump API preserved, build/docs-generation compatibility required.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> @nestjs/swagger@11.4.7 -> js-yaml@5.3.0`; affected node `node_modules/@nestjs/swagger/node_modules/js-yaml`.

**Product/library inspection:** `node_modules/@nestjs/swagger/dist/swagger-module.js`; `backend/src/main.ts`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-r3ph-w7gj-g6xm](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) / No known CVE (moderate) | `>=5.0.0 <=5.4.0` | `5.4.1` | js-yaml load/merge-key budget handling; current SwaggerModule calls dump, not parsing attacker-supplied YAML. |

### 8. `multer` - MODERATE

**Scope:** backend transitive runtime inventory; diskStorage upload path currently absent. **Minimum/selected fix:** 2.4.0. **Semver:** minor from 2.3.0; Nest parent patch.

**Parent decision:** @nestjs/platform-express 11.2.1 -> minimum safe 11.2.6; root Multer override 2.4.0. **Breaking risk:** Low: no active multipart pipeline; future diskStorage behavior is patched; adapter and production bootstrap regression required.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> @nestjs/platform-express@11.2.1 -> multer@2.3.0`; affected node `node_modules/multer`.

**Product/library inspection:** `Nest Express adapter dependency; no MulterModule/FileInterceptor/diskStorage in backend/src`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-3pph-fpjx-jg34](https://github.com/advisories/GHSA-3pph-fpjx-jg34) / CVE-2026-88932 (moderate) | `>=2.2.0 <2.4.0` | `2.4.0` | Multer diskStorage cleanup during an aborted multipart upload; no product upload interceptor/MulterModule/diskStorage pipeline exists. |

### 9. `nodemailer` - HIGH

**Scope:** backend direct runtime SMTP dependency, enabled only by EMAIL_DELIVERY_ENABLED; parser safeguards are not a waiver. **Minimum/selected fix:** 10.0.9 is maximum of five advisory fixed thresholds. **Semver:** major 9.x -> 10.x.

**Parent decision:** none; direct Nodemailer upgraded because no 9.x fix is documented for all five advisories. **Breaking risk:** Moderate: Nodemailer 10 uses ESM/CJS/TypeScript distribution and Node >=20; Node 22 supported; verify import/types, queue and real SMTP adapter sandbox reset flow.

**Dependency paths from the original exact lock:**

- `backend@0.1.0 -> nodemailer@9.1.1`; affected node `node_modules/nodemailer`.

**Product/library inspection:** `backend/src/modules/notifications/email-sender.ts`; `backend/src/modules/notifications/notification-jobs.service.ts`. Reachability conclusions describe inspected usage, not an advisory waiver or proof of Live identity.

| Advisory / CVE | Affected range in audit | Minimum fixed version(s) | Affected code path / application evidence |
|---|---|---|---|
| [GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v) / No known CVE (moderate) | `>=5.0.0 <10.0.2` | `10.0.2` | Nodemailer global DNS/TLS servername cache across multiple transports; product creates one system SMTP transport without tenant-supplied TLS identity. |
| [GHSA-8vvx-rff5-p5rq](https://github.com/advisories/GHSA-8vvx-rff5-p5rq) / No known CVE (moderate) | `<10.0.2` | `10.0.2` | Nodemailer nested recipient-array parsing; EmailMessage.to is a string, no structured recipient arrays accepted. |
| [GHSA-g57g-f23g-4646](https://github.com/advisories/GHSA-g57g-f23g-4646) / No known CVE (moderate) | `>=9.1.0 <10.0.9` | `10.0.9` | Nodemailer quoted-address comment parsing into envelope recipient; DTO IsEmail and max length reject tested examples but do not prove all imported historical values safe. |
| [GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j) / No known CVE (high) | `<=10.0.5` | `10.0.6` | Nodemailer addressparser free-text quadratic regex; email input is a bounded validated string, but parser runtime is used for outbound email. |
| [GHSA-prgh-xp8r-p3m5](https://github.com/advisories/GHSA-prgh-xp8r-p3m5) / No known CVE (high) | `>=9.1.0 <=10.0.4` | `10.0.5` | Nodemailer addressparser comment-joined quadratic processing; no inbound mailparser, outbound parser still exists. |

## npm workspace override correctness

The original npm 11.8.0 toolchain could lose root transitive overrides when the graph crossed a workspace/file Link. Arborist's dependency edges did not connect a Link to its target early enough for override propagation; a written override therefore did not reliably prove a safe resolved package. The upstream fix forwards overrides before link-target subtree resolution and repropagates after resolving actual edges. [npm PR #9671](https://github.com/npm/cli/pull/9671).

The v11 backport is [npm PR #9673](https://github.com/npm/cli/pull/9673). Root `packageManager` is pinned to `npm@11.18.0`; that release includes `@npmcli/arborist@^9.9.0`, and its Arborist workspace is version `9.9.0`. The npm engine accepts `^20.17.0 || >=22.9.0`, covering canonical Node 22. This is build/install tooling, not a new product stack dependency. [npm 11.18 manifest](https://raw.githubusercontent.com/npm/cli/v11.18.0/package.json), [Arborist 9.9.0 manifest](https://raw.githubusercontent.com/npm/cli/v11.18.0/workspaces/arborist/package.json).

The final clean install and full/production audits validate the resolved tree. No unrelated surviving package version was upgraded. Besides the security targets, resolution removes the duplicate Nest CLI `typescript@5.9.3` in favor of the **pre-existing** root `typescript@6.0.3` override, moves Engine.IO and removes its obsolete nested resolver copies, and removes Multer's now-unused `concat-stream@2.0.0`/`typedarray@0.0.6`. These incidental removals are listed exactly in the JSON version/path diff; they are not an optimization change.

## Verification boundary

Clean `npm ci` with the pinned npm completed before downstream changes. Full and production online audit JSON both contain empty `vulnerabilities` and zero totals. **No findings remain and no B/C/D waiver is needed.** The earlier reachability evidence is retained to explain affected paths, rather than used to accept vulnerable versions.

At creation of this report, the root agent owns the full Node 22/Linux CI-equivalent verification: backend/frontend unit tests, PostgreSQL E2E, Playwright, lint, typecheck, production build and auth/socket/GPS regression. The exact final outcomes and any failed/blocked gate must be read from its final release-closure report. This document does not claim GitHub ran the uncommitted worktree or that staging was deployed.
