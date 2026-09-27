# Auth reload audit — 2026-09-28 (Asia/Saigon)

## Root cause captured on staging

The API's login succeeds, but the browser rejects its refresh cookie. The deployed response is `__Secure-logistics_refresh=<redacted>; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax`. Chrome CDP reports **`SchemefulSameSiteLax`** in `blockedSetCookies`. The web and API are separate sites from the browser's perspective:

- Web: `https://logistics-staging-web.onrender.com`
- API: `https://logistics-staging-api.onrender.com/api/v1`

Login can render an authenticated dashboard using its in-memory access token. F5 removes that memory. Since the refresh cookie was never stored, `POST /api/v1/auth/refresh` has **no Cookie header** and returns **401 / `AUTH_REFRESH_TOKEN_INVALID`**. The provider then transitions from loading to guest and the guard redirects to Login. This incident is not an early guard redirect, wrong cookie path, expired persisted session, or demonstrated rotation/revocation failure.

Safe captured evidence (UTC on 2026-09-27; local date 2026-09-28):

| Actual role | Before F5 | Refresh result | Timing after document navigation |
| --- | --- | --- | --- |
| CUSTOMER | `/dashboard`, authenticated | 401 `AUTH_REFRESH_TOKEN_INVALID`, no cookie | loading 231 ms → `/login`, guest 350 ms |
| ADMIN | `/admin/dashboard`, authenticated | 401 `AUTH_REFRESH_TOKEN_INVALID`, no cookie | loading 265 ms → `/login`, guest 371 ms |
| DRIVER | `/driver/dashboard`, authenticated | 401 `AUTH_REFRESH_TOKEN_INVALID`, no cookie | loading 435 ms → `/login`, guest 524 ms |

Driver login request `6565eb64-be8a-46c7-a005-10e4ae02bf4d` returned HTTP 200 and the blocked Set-Cookie above. Subsequent refresh `eb1bddda-b4b1-446b-8931-ae179207bbf9` returned 401. Customer and Admin refresh IDs: `a95d0c17-4e3b-4f1b-aceb-6ff9b1586c3f`, `414eab45-77a3-420c-ba75-6745f44e9110`. Customer/Admin login responses preceded attachment; their authenticated state, missing cookie and failing reload were captured. Initial diagnostic file names label intended windows; actual role is taken from the observed AuthProvider, because the user logged into the windows in a different order.

## Cookie and server audit

| Item | Finding / correction |
| --- | --- |
| HttpOnly / Secure | Both true, retain them |
| SameSite | Lax blocked cross-site login; set `REFRESH_COOKIE_SAME_SITE=none` on the Render API |
| Path | `/api/v1/auth` correctly matches `/api/v1/auth/refresh` and logout |
| Domain | Omitted, host-only API cookie; do not widen to `onrender.com` |
| Credentials | Both Axios clients already use `withCredentials: true` |
| CORS | Live API returns exact web origin and `Access-Control-Allow-Credentials: true` |
| TrustedOrigin | Production auth guard rejects a different origin before cookie mutation; retained and tested |
| Refresh validity | Missing/unknown/revoked/expired/inactive-user sessions rejected with canonical 401 code |
| Rotation | Existing PostgreSQL transaction conditionally revokes exactly one old row before inserting the next hash; losing rotation cannot create another session |
| Failure response | Refresh 401 does not clear the cookie, so a losing response cannot delete another tab's rotated cookie |

`deploy/render-auth.env.example` contains the exact non-secret Render settings. The operator applied the environment change, deployed and reported Live; subsequent real-browser verification confirms SameSite=None. The example file is **not** automatically loaded at runtime. The same-origin reverse-proxy template keeps Lax. Config validation now rejects SameSite=None in non-production, where this application's cookie policy would omit Secure.

Browser behavior reference: [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie): cross-site requests need SameSite=None with Secure. The root-cause claim above comes from actual Chrome diagnostics, not an inferred hosting configuration.

## Additional defects fixed locally

- AuthProvider, Axios interceptor, and Socket recovery used to clear/broadcast null on any refresh error, including network errors/5xx. Only canonical `401 / AUTH_REFRESH_TOKEN_INVALID` now invalidates the requesting tab. Explicit logout continues to propagate to peers.
- Cold restore has loading and recoverable error states. Guards render loading/error with an explicit Retry action while preserving pathname/query/hash. No automatic refresh retry loop. Existing authenticated sessions survive temporary refresh failures.
- One in-flight refresh promise deduplicates requests within a tab. Web Locks serialize shared cookie rotations. Revisions prevent late success/failure from overwriting a newer session or undoing logout. Without Web Locks, auth-invalid has one bounded recovery attempt for a sibling's rotation.
- Logout waits for an existing rotation and the real revoke/clear-cookie response before reporting guest. This closes the reproduced logout → immediate reload gap. The account layout shows pending/error feedback instead of navigating on failed logout.
- Access tokens remain only in memory and transient BroadcastChannel messages. No localStorage/sessionStorage token or refresh-cookie JavaScript access was added.

Invariants: C01/C04/C16 (backend authority, role/ownership boundaries, one invalidation policy). No shipment lifecycle, database schema, migration, backend revoke policy, session history, or business data changes.

## Validation

- Backend focused tests: **33/33 PASS** — real Nest controller/cookie/origin HTTP boundary with mocked AuthService; real AuthService with mocked repository covers all three roles, missing/unknown/expired/revoked/suspended/losing rotations and database failures. No claim of real PostgreSQL concurrency testing: local Docker is unavailable.
- Frontend unit tests: **64/64 PASS**, including local-only invalidation and explicit cross-tab logout.
- Browser regression `node frontend/test/auth-restore/check.mjs`: real AuthProvider/LoginPage/guards/Axios/BrowserRouter/BroadcastChannel/Web Locks; HTTP fixtures explicitly model cookies and rotation. Customer/Admin/Driver cover login → dashboard F5, deep route/query/hash, three tabs and simultaneous reloads, eight expired-token requests sharing one refresh, invalid refresh, logout/reload, transient 503/network/429/origin failures, retry and stale failure after newer login. Timeout/manual recovery and missing browser coordination APIs also covered. Fixture success is not staging evidence.
- Backend/frontend builds and typecheck **PASS**. Backend/frontend lint and `git diff --check` **PASS**. Existing large frontend chunk warning remains. Windows sandbox initially blocked Node child processes/Vite/Chrome; approved reruns passed without changing machine security policy or adding dependencies.

## Staging after configuration deployment

**PASS for the original F5 incident, all three roles**, verified beginning `2026-09-27T17:49:40Z` after the operator's configuration deployment and fresh login. No API interception, cookie injection, token fabrication, direct database writes or mock responses were used in staging verification.

All three browser profiles now contain one API host-only `__Secure-logistics_refresh` cookie: **HttpOnly=true, Secure=true, SameSite=None, Path=/api/v1/auth**, unexpired. Refresh requests have **Cookie header present**, no blocked cookie reasons, **HTTP 200**, and no error body code. No observed page errors or localStorage/sessionStorage keys.

| Role | Dashboard refresh request ID | Provider transition after F5 | Nested route | Three tabs + reload one | Logout + reload |
| --- | --- | --- | --- | --- | --- |
| CUSTOMER | `c8c4c5a6-816c-47e1-ab67-31218fb391cd` | loading 348 ms → authenticated 1561 ms | `/shipments/new` PASS | PASS | 401 invalid, guest PASS |
| ADMIN | `24206d9a-ce94-4cf9-b687-88cf05bbf12b` | loading 421 ms → authenticated 1707 ms | `/admin/staff/new` PASS | PASS | 401 invalid, guest PASS |
| DRIVER | `80a87af7-4ade-40e1-9797-6b2e7ac92e63` | loading 492 ms → authenticated 2239 ms | `/driver/delivery-history` PASS | PASS | 401 invalid, guest PASS |

Dashboard and nested reloads retain the route with no Login redirect during restoration. The three-tab test uses two additional real `/profile` pages in each account's browser context. Actual AuthProvider logout invokes the real endpoint, logs out both peers, clears the cookie, and the next reload stays at Login with `AUTH_REFRESH_TOKEN_INVALID`. Logout-reload refresh request IDs: Customer `61f5e81a-0e29-4495-ba03-70f819b143b1`, Admin `108f8be4-3be0-4d83-83ac-63008306232a`, Driver `abeb12f0-0a43-471f-b95a-13b679394ace`.

**Scope limit:** this proves the deployed cookie configuration repairs the incident using the currently deployed frontend. The new frontend transient-error/race handling and backend environment-validation guard are **local, not committed/pushed/deployed by this task**. Their failure-injection/expiry/invalid-session checks are local fixtures/unit tests; staging expiry and forced network/5xx were not induced. Exact Render Live SHA was not exposed. Full staging validation of the new frontend changes still requires their deployment.

## Changed files and evidence

- Runtime: `frontend/src/features/auth/{auth-provider.tsx,auth-context.ts,auth-api.ts,components/account-layout.tsx}`, `frontend/src/services/{api.ts,auth-session.ts,operations-socket.ts}`, `frontend/src/app/route-guards.tsx`.
- Backend/config: `backend/src/config/env.validation.ts`, `.env.example`, `deploy/.env.example`, `deploy/render-auth.env.example`.
- Tests: `backend/src/config/env.validation.spec.ts`, `backend/src/modules/auth/{auth.controller.spec.ts,auth.service.spec.ts}`, `frontend/test/auth-session-tabs.test.mjs`, `frontend/test/auth-restore/{check.mjs,fixture.tsx,index.html}`, and the existing address fixture's required context method.
- Documentation: this report and `PROJECT_STATE.md`.
- Ignored safe diagnostics: `test-results/auth-staging-*-before.json`, `test-results/auth-staging-*-after.json`, `test-results/auth-restore-browser.json`. Reports contain statuses, codes, roles, timing and cookie attributes, never token/password/cookie values. Dedicated Chrome profiles remain local and ignored.
