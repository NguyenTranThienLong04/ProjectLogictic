# Phase I3 — Staging Provision & Deployment

Date: 2026-09-09 (Asia/Saigon). **BLOCKED — Neon migrations complete; runtime infrastructure incomplete.**

All 25 canonical migrations were applied to the explicitly authorized clean Neon staging DB. No application deployment, production action, I4 work, main DB reset, demo seed or applied-history rewrite occurred. This report supersedes the previous preflight-only I3 report. Historical I2 local/container results are not staging release evidence.

## Git and artifact identity

- Origin `https://github.com/NguyenTranThienLong04/ProjectLogictic.git`; branch `main`, frozen release commit `87c82b87f45e264088bd17729dd2f37928392ea9`, committed/pushed without force. This adopted the existing A-I2 release tree plus I3 tooling after secret checks. Final evidence updates in this report and PROJECT_STATE.md remain local documentation changes after that release SHA; published artifacts refer to the frozen commit.
- Git Credential Manager provides repository admin/push access. Hosted push CI [34356063465](https://github.com/NguyenTranThienLong04/ProjectLogictic/actions/runs/34356063465) and explicit publication run [34357584859](https://github.com/NguyenTranThienLong04/ProjectLogictic/actions/runs/34357584859) both completed successfully on the exact release SHA; verify and release-gate PASS. Main now requires strict release-gate plus one review, including admins; force push and branch deletion are prohibited.
- `gh` and cloud-provider CLIs are absent. Docker Linux is available; kubectl has no current context. No staging target bindings or Neon control-plane API key were available.
- The local GitHub credential could not enumerate packages (403), and Docker has no stored GHCR credential. Repository Actions GITHUB_TOKEN successfully published and read all three immutable manifests. Runtime-target pull identity must be verified when the deployment target is bound; do not assume local registry login.
- Built current-source `logistics-i3-migration:local`, image config ID `sha256:6060b3b5619b84c65effb40d0c38b120023a3b129d91363d6e6e2114bdf0106e`. This local provisioning artifact is not a GHCR release digest or an approved application deployment.

## Published immutable images

Source: `87c82b87f45e264088bd17729dd2f37928392ea9`. Publication artifact: `staging-images-87c82b87f45e264088bd17729dd2f37928392ea9`, artifact ID `10106886639` from run `34357584859`; downloaded to ignored `test-results/i3/published-images/images.json`.

| Target | Immutable reference |
|---|---|
| Backend | `ghcr.io/nguyentranthienlong04/projectlogictic/backend@sha256:ce31aa9fe6e7f84a5ab1714d1c93707d1d8a041eb514f63872580bcd820db039` |
| Frontend | `ghcr.io/nguyentranthienlong04/projectlogictic/frontend@sha256:8992099bbd0a59e7a4bbd1429119779e706dd3c431c656c6c0e1132a456bb523` |
| Migration | `ghcr.io/nguyentranthienlong04/projectlogictic/migration@sha256:8e0414563e05be49f65e8337fbc0ae5be5f8fe8709fb1ac1c57c326e5549d989` |

Publication is explicit `workflow_dispatch` with `publish_images=true`. All verification and production-container HTTPS/API/socket/SIGTERM smoke precede publication. The publisher tags the exact tested images without rebuilding, pushes commit-SHA tags, verifies digest reads and records promotion references. No deployment or staging secrets are part of CI. Default push/PR/manual runs do not publish.

## Configuration and secrets

- Confirmed backend `backend/`, Prisma config `backend/prisma.config.ts`, and actual env names against source and root/deploy examples. JWT name is `JWT_ACCESS_SECRET`.
- Created ignored/untracked root `.env.staging.local`, `.env.staging.runtime.local` and `.env.staging.deploy.local`; existing Git/Docker ignore rules exclude them. Runtime draft omits migration/shadow credentials and uses a separately generated DB password. Deployment draft holds verified image digests and DIRECT_URL, with STAGING_ENV_FILE intentionally absent until an actual target path exists. Existing deploy/.env.example remains the placeholder-only template.
- Set `NODE_ENV=production`, both providers `DISABLED`, `VITE_LOCATION_MODE=REAL`, secure refresh-cookie name, Swagger off and same-origin public build values. Generated JWT directly into the ignored file using `crypto.randomBytes(48)`. Missing Redis/SMTP/HTTPS values are omitted. `EMAIL_DELIVERY_ENABLED=true` keeps SMTP mandatory for eventual startup rather than silently bypassing delivery.
- Normalized Markdown escapes in user URL values. Both supplied main URLs were pooled; derived main DIRECT_URL from the supplied direct shadow hostname with `/neondb`. Discarded pooled shadow alternative. All three URLs use `sslmode=verify-full`, retaining `channel_binding=require`.
- Compared normalized DB identities in memory: staging is distinct from development. Development env was not used for staging connections. Local build-time Prisma configuration read root `.env`; generation/build make no DB connection and are not staging runtime evidence.
- The provisioning file `.env.staging.local` retains the supplied owner connections for controlled migration work. Created login role `logistics_staging_runtime` with no superuser/createdb/createrole/replication/bypass-RLS rights. Granted SELECT/INSERT/UPDATE on the 25 application tables, sequence usage, and DELETE only on CustomerAddress (the existing supported delete operation). No migration-history grants. Future migration-owner table/sequence default privileges are configured. Verified runtime TLS/Prisma reads, no database/schema CREATE, no migration-history UPDATE and no Shipment DELETE. No business rows were created or deleted. Runtime draft is incomplete until Redis/SMTP/HTTPS are supplied; transfer through the chosen secret manager.
- Linux jobs received migration/shadow URLs through environment injection, not URL command-line literals or image layers. Runner output was redacted before persistence. No secret value was committed or printed in reports.

## Neon / migration evidence

New reusable read-only probe: `node backend/scripts/staging-preflight.mjs .env.staging.local`. Requires explicit file; validates Neon topology, TLS certificate authorization, database identities, extension privileges and history through existing I2 `checkHistory`. No DDL, history repair or development env fallback. Rejects unmanaged nonempty main databases and nonempty shadow before replay; the empty-shadow check is a pre-replay safety check, not post-replay readiness.

| Gate | Result |
|---|---|
| Initial three connections | PASS; pooled/direct `neondb`, direct `logistics_shadow`, verified TLS certificates, no application relations/history before migration |
| Database separation | PASS; staging differs from development; pooled/direct main target matches; shadow separate |
| btree_gist | PASS; available/trusted, role has CREATE privilege; canonical migration installed extension and post-check confirmed it |
| Canonical local files / Git baseline | PASS; all 25 hashes and lock file, MIGRATION_BASE_REF=669e6fabdc253c4eb282bf4e2572c3eb071f6134 |
| Linux deploy/migrate.sh | PASS; read-only history 0/25, Prisma deploy 25/25, status current, exact applied checksums 25/25 |
| Repeat deploy / status / checksum | PASS; no pending migrations, up to date, exact history 25/25 |
| Migration-to-schema diff | PASS, exit 0, no difference; designated disposable shadow only |
| Main DB-to-schema diff | PASS, exit 0, no difference |
| Generated Prisma through pooled URL | PASS; read-only query returned neondb and 25 successful migrations |

Actual Linux diff commands: `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` and `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`. Git baseline ran separately on the workstation because migration image excludes `.git`. No checksum bypass or SQL/history edits. Development H2/H3 history remains unchanged; [I2 reconciliation](RELEASE_ENGINEERING_I2.md) still applies there.

Staging is now an existing migrated database: recheck status/checksums on resumption; do not reset or replay raw SQL into main. Only designated disposable shadow was used for Prisma replay. Local ignored evidence: `test-results/i3/validate.log`, `deploy.log`, `status.log`, `drift.log`, and redacting runner `run-linux.mjs`. These are workstation records, not hosted CI run URLs.

## Checks in this continuation

| Check | Result / limit |
|---|---|
| Prisma validation/generation | PASS in Linux migration image and generation during local build |
| Lint / typecheck | PASS both workspaces |
| Unit / migration regression | PASS 240 backend + 32 frontend + 2 migration-gate tests |
| Production builds | PASS backend dist/main.js and frontend dist/index.html; same-origin API/socket, REAL |
| Live npm audits | PASS full and omit-dev, offline=false, zero findings both |
| Source/history secret scan | PASS 709 workspace paths, 7 Git revisions, zero heuristic findings |
| Compiled artifact secret scan | PASS 722 files, zero exact staging credential/JWT matches |
| Final source/artifact secret scan | PASS 1,432 current source/artifact files against all three staging env files, including the new runtime-role password; zero matches |
| Whitespace / probe syntax | PASS git diff --check and node --check backend/scripts/staging-preflight.mjs |
| Hosted integration / browser | PASS 21 E2E suites / 76 tests and 8/8 Playwright without retries on explicitly disposable CI PostgreSQL/Redis; not persistent staging evidence |
| Hosted CI / registry | PASS both runs; published exact container-smoke-tested images and verified immutable manifests. Dedicated OS image vulnerability scan remains unverified |

Initial sandbox attempts failed on Git/Node subprocesses, Prisma cache/native frontend dependencies and npm registry access. Gates passed after explicit escalation; no tests, checksums or security settings were disabled. Lockfile unchanged: SHA-256 `4f320a6b6b4fca857a8f92e68f6bb118339980e65caa055d20a149a35bcf75ee`. No dependency or business/application logic changes.

## Remaining external provisioning

Bind credentials through a protected local file or target secret manager. The agent can handle file edits, injection and remaining technical work; operator input is service/access provisioning.

| Missing / unverified | Exact requirement |
|---|---|
| REDIS_URL | Dedicated rediss:// standalone Redis, BullMQ TCP/Lua/blocking support, ACL, noeviction; not HTTP-only |
| SMTP | SMTP_HOST/PORT/SECURE/USER/PASSWORD, EMAIL_FROM, verified sender/domain and controlled recipient mailbox |
| Deployment target | Staging Linux host/platform identity and access, one backend, private backend network and single migration-job owner |
| HTTPS/DNS/ingress | Actual frontend/backend origin and DNS/certificate access. Standard same-origin topology: TLS ingress to frontend Nginx to backend; preserve /api/v1 and Socket.IO Upgrade; derive real FRONTEND_URL/PASSWORD_RESET_URL and verify proxy hops |
| Runtime secret manager / monitoring | Target secret store/access, rotation policy, restricted logs/metrics/alerts; import generated JWT, separate runtime DB role/grants and migration credentials |
| Backup/PITR | Neon project/control-plane access or provider evidence of retention, RPO/RTO and incident owner. Connection URLs alone cannot prove PITR. Restore drill must use a new isolated DB |

Release commit, hosted Linux CI, main protection, GHCR publication and runtime DB grants are complete. Remaining agent work after external provisioning: verify target registry pull access, inject secrets, deploy frozen images, complete a staging-safe harness, operational validation and restore/rollback drill. No application promotion from local checks alone.

## Staging-safe validation pending

Existing Playwright starts development servers and OSRM, enables TEST payment/SIMULATION GPS, and writes/cleans fixtures directly through Prisma. It must not target persistent staging. Under C05/C10/C18, add separate deployed-HTTPS configuration with controlled identities and authorized API setup, preserve history/rate limits and disabled providers. Label any browser geolocation emulation in evidence.

All rows below are NOT RUN; no runtime endpoint has been deployed.

| Scope | Required assertions |
|---|---|
| Auth/RBAC | Controlled Admin bootstrap, mandatory password change, ownership/suspension denials, cross-customer/driver/warehouse isolation, SMTP reset |
| Full logistics journey | Create, confirm/assign, pickup, origin verification, scheduled line-haul READY/dispatch, destination arrival/receive, delivery/POD, customer timeline; append-only history and retry idempotency |
| GPS/Socket | REAL HTTPS ingestion, scope/TTL/staleness, isolated trip/last-mile rooms, arrival cleanup, reconnect/revocation |
| Scheduling/capacity | Overlap/adjacency, eligibility/capacity limits, stale-submit rejection, READY locking, reviewed recommendation and disabled-route fallback |
| Fees/COD | SENDER/RECEIVER cash, integer amounts, remittance/dispute/settlement/idempotency, separate COD and privacy |
| Disabled providers | No payment action/create/webhook, null road ETA/geometry fallback, UNKNOWN deviation and unavailable reroute |
| Browser/transport | Secure/HttpOnly cookie, CORS/Origin, HTTPS/SPA/assets, actual WebSocket Upgrade, proxy anti-spoofing, multi-tab refresh |
| Health/operations | /api/v1/health/live and /api/v1/health/ready, DB/Redis up, SMTP/queue recovery, drain/restart and protected logs/alerts |
| Backup/rollback | Restore into new DB, history/checksum/count/FK/CHECK verification, queue/email reconciliation and first-release rollback path |

## Decision and handoff

**I3 BLOCKED.** Operator binds Redis, SMTP, staging target/DNS/secrets and backup/PITR evidence. Agent then completes target configuration, deployment and operational validation using the frozen published release. Stop after I3; no production or I4.

Files introduced/changed for I3: backend/scripts/staging-preflight.mjs, .github/workflows/release.yml, deploy/ci/publish-images.sh, docs/DEPLOYMENT.md, PROJECT_STATE.md and this report; ignored staging env/evidence and Git origin/branch/release commit. Existing A-I2 work was included in the release snapshot; SQL/manifest bytes and development env/history were preserved. Final evidence changes are local docs only and need the protected-branch review flow before a later merge.
