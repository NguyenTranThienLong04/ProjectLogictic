# Address Administration verification — 2026-09-18

Scope: verification only. No application source changes in this verification run.

## Local DB PASS

Command: `node test-results/address-admin-real-e2e.mjs` after successful workspace `npm run build`.

Evidence: `test-results/address-admin-1789750310436/report.json` and `completed.png` (ignored local artifacts). PostgreSQL 17.11, 25 canonical SQL migrations replayed into a fresh isolated local database `address_admin_verify_1789750310436` on port 55432. Database retained for inspection. Actual compiled Nest API on port 5310, dedicated real Redis 7.4, Chromium against production frontend on port 5192. No API/database mocks. Test processes and dedicated Redis stopped after verification.

| Case | Result | Observed evidence |
| --- | --- | --- |
| 1 | PASS | Browser-created Saved Address, Hồ Chí Minh / Bến Thành, `district: ''`, confirmed coordinates; HTTP 201. |
| 2 | PASS | GET and independent Prisma/PostgreSQL reads match city, ward, street, district and coordinates. |
| 3 | PASS | Browser contact/phone edit persists while coordinates remain unchanged. |
| 4 | PASS | Street and ward edits each show stale warning; save sends zero PATCH requests and DB remains unchanged; reconfirm then saves successfully. |
| 5 | PASS | Created Shipment pickup snapshot exactly matches the saved address and coordinates in PostgreSQL. |
| 6 | PASS | Two-level delivery with empty district succeeds with HTTP 201; confirmed delivery coordinates persist. |
| 7 | PASS | Saved Address later changed to Hà Nội / Hoàn Kiếm; Shipment GET and DB retain original Hồ Chí Minh pickup snapshot. |
| 8 | PASS | Authenticated GPS API writes synthetic test positions to real Redis; candidate distances 16 m and 7,793 m sort correctly; assignment persists `PICKUP_ASSIGNED`. |
| 9 | PASS | Production build passes. Local `modal-CgD07PgG.js` contains administrative data; browser observed zero GitHub/GitHubusercontent/Open Admin Data/geocoder requests throughout the flow. |

Administrative asset SHA-256: `2b3c2feaf020521e377c925d1114a53efe569f064f6c582e435ef6eb313f1064`.

Shipment: `a26f5008-63c3-4d2a-bcd5-5e08ddc1d928`. Address: `ccfe11ac-8147-4855-90ab-bd114e5de402`.

Limits: GPS positions are synthetic; route provider is DISABLED, so ranking verifies the distance fallback, not an external routing service. No browser page errors. Vite websocket proxy logged disconnect errors during full-page navigation; socket behavior is outside these assertions. Initial harness run stopped at case 7 because it used `pickupSnapshot` instead of the existing API field `pickup`; only the harness assertion was corrected, then the complete run passed.

## Staging PASS — route only

Read-only command: `node deploy/staging-web-smoke.mjs` against `https://logistics-staging-web.onrender.com`.

Root, direct `/shipments/new`, and reload each return HTTP 200 and render the SPA. Protected route and reload redirect to `/login`. This proves only routing/auth redirect, not feature deployment or map behavior.

## BLOCKED — deployment and case 10

No deploy hook/API credential/service configuration or authorized staging browser session was available. No deployment performed. Authenticated staging smoke for HCM wards, province/ward map focus, stale-coordinate reselection, and Vietnam address with stale Africa marker was not executed. Existing incorrect saved coordinates and the Africa regression were not independently verified by this local run. No staging feature PASS is claimed.
