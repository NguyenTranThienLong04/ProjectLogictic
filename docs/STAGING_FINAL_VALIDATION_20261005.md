# Staging final validation — 2026-10-05

Verified **13:30–13:37 ICT** (06:30–06:37 UTC). **STAGING FINAL: BLOCKED.**

The user authorized strict staging cutover/restart and post-cutover validation. Execution is blocked by unavailable Render access, not missing permission. No product-code changes, deployment, environment changes, migration/reset/seed, SQL writes or business mutations were performed. Normal Admin session refresh was used for authenticated reads.

## Notification and Live identity

Targets: `https://logistics-staging-web.onrender.com` and `https://logistics-staging-api.onrender.com/api/v1`.

| Check | Result |
|---|---|
| Live notification build correct | **NO — DEPLOY MISMATCH** |
| Backend Live SHA | UNKNOWN; `/health/version` → 404, request `d9c0948c-d118-4a97-8044-3136228311f0` |
| Frontend Live SHA | UNKNOWN; `/release.json` → 200 HTML SPA fallback |
| Backend health | 200; PostgreSQL/Redis up |
| Pickup deep-link | **FAIL in served artifact**; owned Driver browser test blocked |
| Delivery deep-link | **FAIL in served artifact**; owned Driver browser test blocked |
| Dropdown | **FAIL**; handler only marks read |
| All notifications | **FAIL**; no task navigation mapping |
| Slow/failed mark-read navigation | **BLOCKED / NOT RUN** on staging |
| Legacy missing-assignment fallback | **BLOCKED / NOT RUN** on staging |
| F5 detail | **BLOCKED / NOT RUN** with an owned Driver session |

Fresh cache-busted asset requests and a new headless Chrome context with cache disabled plus `Page.reload({ignoreCache:true})` load `/assets/index-BGj12pP4.js`. SHA-256:

`65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`

The served dropdown module `empty-state-De-z7GFy.js` has `disabled:a.isPending,onClick:()=>!e.readAt&&a.mutate(e.id)`. Its hash remains `0ab565931ca99601b260adebb8b6655d0dde712f19d1d3a6544673c06ca410ce`. The center module `notifications-page-hwCzdxUT.js` only exposes mark-read actions; hash `cbd91dd40b5f7748e5482bfb23c93a7662480edee7fde6ece3ed750ad1f7166d`. Both lack the assignment ID and pickup/delivery type mapping in the fixed source.

The existing fix is committed at `cade37c4e16b1f1c0cde8af8c735f9b0624c11aa`. Local `useOpenNotification` already navigates independently of mark-read; `notificationTarget` maps valid IDs to `/driver/pickups/:assignmentId` and `/driver/deliveries/:assignmentId`, with list fallbacks. Following the user's old-bundle instruction, no further code fix was made. Exact Live commit/deploy identity cannot be inferred from the asset fingerprint.

Fresh read-only DB join: **24/24** Driver assignment notifications have matching assignment, shipment, recipient ownership and type (14 pickup, 10 delivery; zero missing assignment IDs). This confirms persisted metadata, not an owned Driver HTTP click test. Both saved Driver profiles return 401 `AUTH_REFRESH_TOKEN_INVALID`; Admin refresh returns 200/ADMIN.

## Canonical manual trip — confirmed PASS before cutover

Authenticated API plus independent read-only DB/audit confirm the user's completed manual flow:

- Trip `LHT-20261005-ED4148` / `eb351ec9-893a-4dc4-a154-9889a1b0a2af`, SG01 → SG02, **ARRIVED**.
- Driver `SG01_TX01`, active with LINE_HAUL; Vehicle `TRUCK-02`, capacity **10,000,000 g**, released to AVAILABLE.
- One active manifest transfer `TRF-MUUUVCP5-NQDO` / `86c34c9d-02cb-43e5-a8bf-5846dfc5b036`, **COMPLETED**.
- Shipment `ee87960c-1e5e-4cae-95fb-b2a52a145d87`, **AT_DESTINATION_WAREHOUSE**, current warehouse SG02.
- Recorded schedule `2026-10-05T10:00:00Z`–`10:11:00Z`; READY manifest snapshot **1,000 g**. No scheduling policy was changed or assessed outside this task.

| Audit action | UTC timestamp | Audit ID |
|---|---|---|
| Trip created | 06:14:01.724 | `40038c70-4421-4ebc-a336-4d01ed2d4536` |
| Transfer created | 06:15:17.368 | `bd464189-0cf3-42b4-ba7e-3967a82d7494` |
| Transfer assigned to manifest | 06:15:31.189 | `a1438327-c280-4e47-91eb-36e8a2e98de0` |
| Scheduled | 06:22:42.726 | `2e889051-9839-4f89-aa6c-62c23a0208ed` |
| READY | 06:22:55.515 | `1f4ff5a7-9fb9-4fa2-bdc3-b80db16b446a` |
| Trip dispatched | 06:23:38.667 | `27cc2dc6-9b56-4ed4-8ef1-e1b116cbeff2` |
| ARRIVED | 06:25:08.585 | `f6bdbb2e-5403-4a44-95c2-7ce0454b817b` |
| Destination receive / transfer COMPLETED | 06:26:06.129 | `47ecc039-1585-4c82-9759-1ae9127de5fb` |

Schedule/READY/depart actions were by DISPATCHER; arrival and receive by destination WAREHOUSE_STAFF. Trip terminal state is ARRIVED; COMPLETED belongs to the transfer. This evidence closes the earlier manual-canonical blocker. It does not establish post-cutover strict PASS.

## Strict cutover and legacy

**Cutover timestamp: NOT SET by this task. Raw Live `LINE_HAUL_ENFORCEMENT_FROM`: UNKNOWN.** No Render credential/environment variable/CLI config or Render session in the available staging profiles was found; no running Chrome remote-debugging port was exposed. Access-source clarification was requested. Local env values cannot configure or prove Render runtime values.

Authenticated Live transfer responses contain no `workflow` object, including no `enforcementFrom` or `lineHaulRequired`. The source introducing this contract/enforcement is `ef14f1f2f2946e057ee598caead5b0f3d377260a`. Backend Live identity and support for that policy must be established before treating an env update as effective. No assertion that strict is ON or OFF is justified by the available runtime evidence.

| Required post-cutover check | Result |
|---|---|
| New standalone transfer dispatch without Trip rejected | **BLOCKED / NOT RUN** |
| No Vehicle rejected | **BLOCKED / NOT RUN** |
| No LINE_HAUL Driver rejected | **BLOCKED / NOT RUN** |
| Receive before ARRIVED rejected | **BLOCKED / NOT RUN** |
| New valid Trip → receive → COMPLETED | **BLOCKED / NOT RUN**; manual pre-cutover flow above PASS |
| Legacy standalone receive/complete | **BLOCKED / NOT RUN** |
| Rejected-action audit | No post-cutover request evidence; no rows with action matching REJECT/DENIED since 00:00 UTC. This query is not proof that no rejection occurred. |

Legacy candidate `TRF-MUSKE729-PAEL` / `8715b031-2ac2-4d2c-b1e0-56e1712578c0` remains standalone **IN_TRANSIT**, departure `2026-10-03T15:46:59.652Z`, no Trip association and no receipt. It was preserved for verification after enforcement is confirmed. No fabricated Trip/Driver/Vehicle was added.

Current inventory has no PICKED_UP/AT_ORIGIN_WAREHOUSE shipment and no pending transfer. A fresh strict smoke needs a new shipment to reach SG01 via normal pickup/check-in/sorting. Missing Vehicle/Driver are rejected by the canonical create DTO before a malformed trip can exist; do not bypass relational constraints to manufacture such trips. Capture exact HTTP status/code/request ID and unchanged state for rejections; lifecycle audit is separate from failed-request evidence.

## Validation and resumption

Performed: public health/release/asset reads; cache-disabled hard reload; normal Admin/Driver session probes; authenticated Trip/transfer/audit reads; notification ownership joins; canonical state/history and legacy read-only checks. SQL transactions used `REPEATABLE READ READ ONLY` and `ROLLBACK`. A verification query initially referenced nonexistent `readyAt`/vehicle warehouse fields; corrected using the checked-in schema and reran successfully. Chrome sandbox EPERM was resolved by approved escalation. No product tests/build were rerun because source did not change.

Evidence under ignored `test-results/staging-final-20261005/`: `gate.json`, `notification-trace.json`, `hard-reload.png`, `staging-database.json`, `sessions.json`, `audit.json`, downloaded modules and read-only verification scripts. Tokens/passwords are not persisted in reports. `git diff --check` passed.

Changed tracked-scope files: this report and `PROJECT_STATE.md`; previous uncommitted documentation preserved. C01/C03/C04 lifecycle/ownership, C05/C06 history, C08 snapshots, C09 idempotency and C18 honest validation status preserved.

Resume with Render access and an owned Driver session: establish a backend build containing enforcement, set a current explicit UTC cutover and restart/redeploy without migration, read back the effective value, then run the new-transfer strict matrix and finally receive the preserved legacy transfer. Notification remains deployment-blocked until the fixed frontend is served. The current user request already authorizes cutover/restart; do not request that permission again.

**NOTIFICATION: BLOCKED · STRICT LINE-HAUL: BLOCKED · STAGING FINAL: BLOCKED.**
