# Customer notification deep-link staging validation — 2026-10-13

**CUSTOMER NOTIFICATION DEEP-LINK STAGING: BLOCKED**

Checked at **2026-10-13 21:52:28 ICT** (`2026-10-13T14:52:28.793Z`). Scope: validate the existing Customer fix on staging; no feature or business-code edits, migration/reset/seed, commit/push/deploy, or Driver business actions.

## Release gate: FAIL

Frontend: `https://logistics-staging-web.onrender.com`

Fresh HTTP GET `/release.json` (200, cache-busting query plus no-cache headers):

```json
{
  "commitSha": "e63aeb3e0b477e9f7755ec91c8c9c2809b845a14",
  "buildTimestamp": "2026-10-09T10:37:51.785Z"
}
```

The same SHA is embedded in `/assets/index-hZjxv1or.js`. Release identity is consistent, but this commit **does not contain either Customer fix**. Local HEAD also equals that SHA; both fixed production files remain uncommitted working-tree changes. There is no committed fix SHA available in this checkout to compare as the intended release.

Fetched live assets confirm the old behavior independently of Git metadata:

| Required fix | Served asset | Evidence | Result |
|---|---|---|---|
| Customer branch in `notification-target.ts` | `/assets/empty-state-CRPyRzsO.js` | Resolver starts ``function M(e,t){if(t!==`DRIVER`)return;`` and only resolves Driver assignment routes | **FAIL — fix absent** |
| Resolver-based clickable titles in `notifications-page.tsx` | `/assets/notifications-page-DB6UdgUa.js` | Title still uses ``children:e?.role===`DRIVER`?`` to choose between a button and plain `n.title` | **FAIL — fix absent** |

Readable equivalent of the actual served conditions:

```ts
if (role !== 'DRIVER') return undefined;
// Notification Center title:
user?.role === 'DRIVER' ? clickableTitle : item.title;
```

`git show e63aeb3e0b477e9f7755ec91c8c9c2809b845a14:<file>` confirms both old conditions in the released source. This is an old frontend deployment, not evidence of a staging backend metadata issue.

Asset SHA-256:

- Entry: `d382553641b4ce00435f494058b4f5cb16b74428442fd66cae9d9294e3a811ce`.
- Shared resolver asset: `4b995a2cd87300b623dc8de6fbc30f698132aef75411c076b1cb0d5ba553ae66`.
- Notification Center asset: `7ca831b2e9c9a2a3845809a38ea5e99b2c392e33c23943edbf6194e57bee59a9`.

## Staging matrix

The release gate failed, so authenticated smoke did not proceed. NOT RUN is not a browser failure or a PASS inferred from the local suite.

| Check | Status |
|---|---|
| Frontend Live SHA | `e63aeb3e0b477e9f7755ec91c8c9c2809b845a14` — does not contain fix |
| Customer dropdown → shipment detail | **NOT RUN / BLOCKED by release gate** |
| Customer All Notifications → shipment detail | **NOT RUN / BLOCKED by release gate** |
| F5 retains correct shipment | **NOT RUN / BLOCKED by release gate** |
| Slow/failed mark-read still navigates | **NOT RUN / BLOCKED by release gate** |
| Missing/invalid metadata fallback | **NOT RUN / BLOCKED by release gate** |
| Customer ownership violation rejected | **NOT RUN / BLOCKED by release gate** |
| Driver Pickup/Delivery deep-link regression | **NOT RUN / BLOCKED by release gate** |
| Admin/Dispatcher existing behavior | **NOT RUN / BLOCKED by release gate** |

All five requested type groups remain unverified on this staging release. Real Customer notifications and their metadata were not read, and no notifications were marked read. Prior source/local coverage for all eleven types remains valid at its original scope in [the local report](CUSTOMER_NOTIFICATION_DEEPLINK_20261013.md); it is not staging acceptance.

## Evidence and next prerequisite

Read-only probe: `node test-results/customer-notification-staging/release-probe.mjs` — exit 0; 62 public GET requests, all 200, zero mutations. Exit 0 means the probe retrieved its evidence, not that the release gate passed. Ignored local artifacts include `release-probe.json`, `release-response.txt`, `index.html` and fetched JavaScript assets under `test-results/customer-notification-staging/`.

The staging frontend must first deploy a committed version containing the two already-tested production fixes. Verify its new `/release.json` SHA, embedded identity and both served bundle changes, then resume the authenticated Customer/type/regression matrix. This validation request did not trigger a release or any backend changes. Migration required: **NO**.

Files changed in this validation turn: this report and a short `PROJECT_STATE.md` entry; the ignored read-only probe/evidence is supporting material. Previous implementation/test changes and unrelated user files are preserved. C01/C04 ownership policy and C11 API-based recovery were not changed.
