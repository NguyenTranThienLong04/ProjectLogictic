# Repeated notification deep-link diagnosis — 2026-10-14

**REPEATED NOTIFICATION DEEP-LINK: BLOCKED — reported failure not reproduced; exact root cause not established.**

Observed repeated navigation passes locally and in the sampled real Customer session on staging. No product-code fix is claimed. Only regression tests, failure diagnostics and project-state documentation changed; no backend changes, migration/reset/seed, Driver business actions or deployment.

## Reproduction and state trace

The earlier Customer tests navigated to a fresh page before each click. They did not establish continuous A → B → C behavior. The new test starts one document, then performs **A → B → C → D (same shipment as C) → A → B**, without `goto`, reload or switching tabs between notifications. For All Notifications it uses browser Back between details; for the bell it reopens the same dropdown. Reload is tested only after the sequence.

| Suspected cause | Observed source/runtime evidence |
|---|---|
| `openingNotificationId` or stale double-click ref | Neither exists in `use-open-notification.ts` or either entry point. No retained entity ID is used as a click guard. |
| Mutation pending disables all items | Bell items and Notification Center title buttons have no `disabled` gate. `isPending` only controls separate mark-read/read-all actions. The new test clicks B while A's PATCH is still pending. |
| Read request awaited before navigation | The existing hook calls `markRead.mutate()`, closes the dropdown and invokes `navigate()` synchronously without awaiting the mutation. Success, 2s delay and 503 all pass. |
| Stale dropdown open/ref state | `dropdown.current.open = false` runs on each click. The test reopens it repeatedly, checks closure afterward and tags the DOM summary to prove cached-detail transitions reuse the same bell instance. |
| Event suppression or overlay | No notification `preventDefault`/`stopPropagation` blocks the click. The browser probe records disabled state and pointer hit targets. Sequences pass with the real detail map present and with long/scrollable real staging lists. |
| Same route pattern with a new parameter | `ShipmentDetailPage` reads `useParams().id`; both `queryKey: ['shipment', id]` and `getShipment(id)` use it. Fresh and cached A/B/C transitions produce the correct URL and heading without forcing remounts. |
| Same shipment target | The URL and shipment detail correctly stay the same, but the browser history key changes and the dropdown closes; the click is processed. Already-read notifications do not issue another PATCH. |
| Backend metadata | Sampled real Customer rows contain valid `shipmentId`; assignment/attempt/warehouse IDs remain auxiliary. No producer or API projection defect was found in this sample. |

**Stale/locked state identified: none in the reproduced sequences.** The reported user's failure remains unverified; this is not a claim that it cannot happen in their browser.

Seven of the eight sampled recent Customer notifications concern the same shipment. This explains why those notifications share a target, but it is only a possible explanation for a perceived lack of navigation, not an established root cause of the user's report. Testing also alternated between two genuinely different shipments successfully.

C01/C04/C11 remain unchanged: backend/API ownership remains authoritative, the resolver uses authenticated role and validated IDs, and reload obtains detail through the URL/API. No persisted business invariant violation was observed.

## Local browser regression

New test: `frontend/test/ui-flow/notification-repeat.mjs`, registered in the existing browser regression runner. It builds the actual App, router, AuthProvider and Customer detail; HTTP is intercepted test data. Default execution includes the Leaflet detail map with external tiles aborted. `--chrome` uses installed Chrome; `--without-map` covers plain detail.

Matrix: 375px and 1440px × dropdown and center × mark-read success, delay 2s and 503 = **12 scenarios / 72 sequential clicks / 12 reloads per run**. Both read and unread items are present; A/B/C have different shipment IDs, D shares C's ID, and returning to A/B exercises cached detail without replacing the bell DOM.

Assertions include:

- Actual click changes browser history and opens the exact shipment URL and heading.
- Second click in delayed cases starts while the prior PATCH is unresolved.
- Navigation completes before the 2s PATCH; the installed-Chrome/map run recorded 22–903ms.
- No document reload/auth refresh is needed between clicks; a DOM marker survives cached parameter changes.
- Already-read D does not produce a PATCH; same-target clicks close the bell.
- F5 restores auth and renders the final shipment B.
- Browser errors and unexpected API requests fail the test.

Commands:

- `node frontend/test/ui-flow/notification-repeat.mjs --without-map` (initial equivalent Chromium/plain-detail run): **12/12 PASS**.
- `node frontend/test/ui-flow/notification-repeat.mjs --chrome --with-map` (installed Chrome; map is now the default): **12/12 PASS**.
- `node frontend/test/ui-flow/notification-repeat.mjs`: default CI command validation recorded in `test-results/notification-repeat/results.json`.
- `node frontend/test/ui-flow/notification-reload.mjs`: **PASS** for the existing eleven-type Customer matrix, Driver Pickup/Delivery dropdown/center/detail/F5 at 375/768/1440px, and Admin/Dispatcher existing behavior.
- Frontend lint and scoped lint of all changed test files: **PASS**. `git diff --check`: **PASS**.

One initial run of the older independent-click suite timed out locating a fixture title after a fresh navigation (2.5s lookup). The unchanged assertion passed when rerun with failure screenshot/route diagnostics added. Its cause was not established and it did not reproduce the continuous-click failure. No timeout was increased, assertion removed or product behavior changed to obtain the rerun result.

## Real staging evidence

At **2026-10-14 11:10 ICT**, fresh public release/bundle checks confirmed frontend SHA **`6ef8618ab2b188e7d6e8f783c03c6ba38215c5a7`**, build `2026-10-13T14:56:30.919Z`. The served resolver and Notification Center contain both original Customer fixes. This supersedes the old release blocker in `CUSTOMER_NOTIFICATION_STAGING_20261013.md`; it does not replace that task's full requested staging matrix.

At **2026-10-14 11:13 ICT**, the saved real Customer session on installed Chrome passed **eight sequential notification clicks**: four from the bell and four from All Notifications (browser Back between center visits), alternating between:

- `SHP-20261013-02DE74BF`, shipment `8077bd97-46fe-4db3-a786-fda9a734c7e0`.
- `SHP-20261005-50347EBC`, shipment `acf1675c-3547-4ba6-b62a-270ba96f9f17`.

The title/URL/metadata groups used were `DELIVERED`, `WAREHOUSE_ARRIVED`, and `OUT_FOR_DELIVERY`. **All eight rendered headings matched the tracking code returned by the correct shipment detail API**, including cached revisits; final F5 also passed. Previous-day real clicks exercised several notifications for the same shipment successfully.

The final real-data run used only reads plus two successful auth refreshes; all chosen notifications were already read, so it sent zero notification/business writes. Mixed unread/read and delayed/failed PATCH coverage is local fixture evidence, not live fault injection. No shipment creation or status/assignment change was performed.

An earlier 14 October attempt showed session-restore connectivity failure; retry recovered and the final assertions above passed. Another saved profile returned 401. These were pre-navigation access failures, not established notification-click defects. The user's actual open browser was not attached: the checked CDP endpoint had no Logistics tab.

Ignored local evidence:

- `test-results/notification-repeat/chrome-map-results.json`: 12 cases/72 clicks, request overlap, DOM hit records, navigation timings.
- `test-results/notification-repeat/results.json`: latest default Chromium run.
- `test-results/notification-repeat/staging-repeat.json`: sanitized request/status log, real notification metadata, URLs and exact heading comparisons.
- `test-results/notification-repeat/live-release/release-probe.json`: fresh release identity and asset hashes/snippets.

## Remaining diagnosis and files

The user confirmed staging on Chrome/Edge but has not supplied the failing A/B notification pair or whether the URL changes during the failure. To locate an exact root cause, the next evidence needed is that pair's shipment/tracking IDs and the URL before/after the blocked click, or access to the actual failing browser state. Do not add arbitrary pending resets, forced remounts or backend changes without a reproducible failure.

Changed files:

1. `frontend/test/ui-flow/notification-repeat.mjs` — continuous-click browser regression.
2. `frontend/test/browser-regression.mjs` — includes the new test in the normal runner.
3. `frontend/test/ui-flow/customer-notification-check.mjs` — failure screenshot and route/error diagnostics; existing checks unchanged.
4. `docs/REPEATED_NOTIFICATION_DIAGNOSIS_20261014.md` — this report.
5. `PROJECT_STATE.md` — concise status entry.

Runtime files changed: **none**. Migration required: **NO**. The tested behavior is PASS; closure of the reported bug remains BLOCKED pending reproduction of the failing case.
