# Driver GPS lifecycle — 2026-09-27

## Root cause and ownership

The inspected working tree already mounted `DriverLocationProvider` around Driver routes; `DriverMapPage` was already read-only. It did **not** reproduce a literal Map-owned publisher. The deployed revision behind the reported Map-only behavior has not been verified.

Confirmed defects: `/profile` was outside the provider and unmounted it; the geolocation watcher depended on changing active-trip query objects and restarted during refetch; a throttled `watchPosition` callback was not a periodic publisher; Driver online/offline/profile suspension did not control publishing; GPS state was not visible throughout the workspace.

Before: `DriverRoutes → DriverLocationProvider → driver pages`; browser watch callbacks triggered POSTs.

After: `ProtectedRoute → AuthenticatedWorkspace → DriverLocationProvider → Driver pages / Profile / Notifications`. Lazy loading is retained for the Driver provider. Account identity keys the session owner. Map and task maps only read the authenticated current-location endpoint.

## Runtime behavior and unchanged contract

- An ACTIVE authenticated Driver with an online AVAILABLE or BUSY profile starts one polling timer. Profile and active-trip context refresh every 5 seconds, including while the tab is hidden when the browser permits timers.
- Initial acquisition requests browser permission, then one fresh `getCurrentPosition` acquisition every **5,000 ms**. No `watchPosition` watcher is needed. `maximumAge: 0`, existing 15-second acquisition timeout, no overlapping acquisition/POST. Slow acquisition/network can skip ticks; browser background throttling or device sleep cannot guarantee wall-clock cadence.
- Initial fresh sample publishes immediately. Cached samples aged **20 seconds or more** are never re-stamped and uploaded. Only successful uploads show `GPS đang hoạt động`; denial, waiting, service failure and stale state remain visible in the sticky workspace status with the required permission guidance and retry action.
- Offline mutation updates the provider's profile cache immediately. Cleanup clears the timer, aborts an in-flight HTTP request, and fences late browser/HTTP callbacks. Browser one-shot geolocation has no cancellation API; a late callback is discarded and cannot publish.
- Logout clears local authentication before waiting for the logout HTTP response. Session loss/account or role change also stops the owner. Driver suspension/offline from another client is detected by profile polling; authorization rejection stops publishing immediately when received. There is no new server push contract for suspension.
- Permission changes restart acquisition; denied permission stops the timer until grant/retry. Backend success is required before the UI reports GPS active. It never claims that GPS alone establishes assignment eligibility.
- Existing last-mile endpoint `POST /driver/location`, authenticated identity, payload latitude/longitude, Redis `driver:location:{driverId}`, TTL **20 seconds**, and Socket contract are unchanged. No GPS points are written to PostgreSQL.
- Existing line-haul context is retained: PLANNED/READY do not publish; IN_TRANSIT uses only the trip-scoped endpoint. A point is never sent to both endpoints. Development simulation controls reuse the same loop and remain absent from production.
- No candidate/ranking/assignment, authorization, schema or migration changes. C01/C04/C10/C11/C12/C16/C18 are preserved; backend remains authoritative and Redis remains disposable.

## Changed files

- `frontend/src/app/app.tsx`, new `authenticated-workspace.tsx`, `role-routes/driver-routes.tsx`: provider ownership across shared authenticated routes.
- `frontend/src/features/locations/driver-location-provider.tsx`, new `driver-gps-publisher.ts`, `driver-location-context.ts`, `location-api.ts`: lifecycle, periodic fresh acquisition, state and request cancellation.
- New `frontend/src/features/locations/driver-gps-status.tsx`, `frontend/src/features/auth/components/account-layout.tsx`, `pages/profile-page.tsx`: persistent accessible status, including Profile loading.
- `frontend/src/features/auth/auth-provider.tsx`, `frontend/src/features/dashboards/driver-dashboard-page.tsx`: immediate logout/availability lifecycle updates.
- `frontend/test/driver-gps-publisher.test.mjs`, `frontend/test/driver-gps-lifecycle.mjs`: regression tests.
- This report and `PROJECT_STATE.md`.

## Verification

- Backend GPS/TTL and assignment candidate regression: **28/28 PASS** (`locations.service.spec.ts`, `assignment-candidates.service.spec.ts`). Covers canonical Redis write arguments, stale reads, current-GPS eligibility and ranking. These are unit tests with infrastructure fixtures.
- Frontend suite: **59/59 PASS**, including eight new tests: exact 5-second cadence, stationary fresh samples, StrictMode discarded mount, abort/late callback fencing, permission denial, old device samples, pending-request expiry/no overlap, HTTP recovery and authorization rejection.
- Chromium real App/routes/auth/provider at **375×812, 812×375, 768×1024, 1440×900: PASS**. Login → online without opening Map emits authenticated POST; Dashboard/Pickup/Profile/Delivery/History/Map navigation maintains updates; Map open/close emits no extra POST; task detail read-error route and BUSY retain GPS; Offline, denied permission, stale acquisition, HTTP failure/recovery, suspension and logout behave correctly. No horizontal page overflow or uncaught page errors.
- Frontend lint/typecheck and backend/frontend build: **PASS**. Vite reports the existing large-chunk advisory.
- Node/Chromium required execution outside the Windows sandbox due to `spawn EPERM`. No dependency added.

Run: `npm run test --workspace frontend`; `node frontend/test/driver-gps-lifecycle.mjs`; `npm run test --workspace backend -- --runTestsByPath src/modules/locations/locations.service.spec.ts src/modules/assignments/assignment-candidates.service.spec.ts`.

## Staging result

**NOT VERIFIED / BLOCKED — no staging PASS claimed.** The browser regression uses explicitly mocked geolocation and HTTP; it proves frontend request lifecycle, not actual Redis persistence or a live Dispatcher candidate. Backend unit tests verify the unchanged eligibility and TTL policy separately. Docker's local Linux engine is unavailable; no real-Redis integration was run in this task. Changes were not deployed and no authenticated staging Driver/Dispatcher smoke was performed.

Remaining staging checks after deploying: actual device permission and Online from Dashboard → current-location API/Redis update → matching Dispatcher candidate; navigate through Profile and Map while observing 5-second POSTs; Offline/logout/suspension stop writes; denied permission warns; missing/stale GPS after 20 seconds remains excluded. Preserve REAL GPS mode and current backend policies for that verification.
