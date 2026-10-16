# Address geocoding staging verification — 2026-10-16

**ADDRESS GEOCODING STAGING: BLOCKED**

Checked **2026-10-16 13:46–13:47 ICT**. Verification only: no product changes, provider change, commit/push/deploy, migration/reset/seed, database access or business-data writes.

## Release identity

| Service | Fresh public evidence | Commit SHA | Build timestamp (UTC) |
|---|---|---|---|
| Backend | `https://logistics-staging-api.onrender.com/api/v1/health/version`, HTTP 200 | `6ef8618ab2b188e7d6e8f783c03c6ba38215c5a7` | `2026-10-13T14:56:32.162Z` |
| Frontend | `https://logistics-staging-web.onrender.com/release.json`, HTTP 200; same SHA embedded in served entry JS | `6ef8618ab2b188e7d6e8f783c03c6ba38215c5a7` | `2026-10-13T14:56:30.919Z` |

The two services agree, but **this commit does not contain the geocoding resilience fix**. Local HEAD is the same SHA. The six geocoding production files remain modified and uncommitted: backend policy/service/search DTO/controller and frontend search component/API types. There is no committed fix SHA in this checkout to validate as the intended release.

Evidence independent of the release metadata:

- Served `/assets/location-picker-BuiGnEfL.js` renders each candidate with only `children:e.displayName`. It contains no `precision`, `providerLocality`, `administrativeMismatch` or `Vị trí gần đúng trên đường` marker. The approximate-road warning in the local fix is absent from the live search renderer.
- `git show 6ef8618ab2b188e7d6e8f783c03c6ba38215c5a7:backend/src/modules/locations/address-search.service.ts` still uses structured search followed by one full free-form fallback, with no four-query progressive fallback or HOUSE/STREET response precision.
- The same released policy still returns `!house || normalizeAdministrativeSearch(address.houseNumber ?? '') === house[1]`. A requested house therefore rejects a road candidate lacking `house_number`. This is source evidence tied to the reported runtime SHA, not a new authenticated staging provider trace.
- Backend `/api/v1/health/live` returned HTTP 200 and runtime version is Node `v22.23.3`. The earlier dependency-health request timed out after 25 seconds; it does not establish dependency readiness or an outage. Subsequent version/liveness success establishes identity and liveness only.

## Requested address matrix

All functional cases below are **NOT RUN / BLOCKED by the release gate**. No authenticated search or shipment/address mutation was issued against the old release. Prior local/provider results are not staging results.

| Case | Staging result |
|---|---|
| `475A Điện Biên Phủ`, Thạnh Mỹ Tây, Hồ Chí Minh | BLOCKED; no verified staging result or house coordinates |
| Normal house number / exact-address case: `123 Nguyễn Trãi`, Bến Thành | BLOCKED |
| Sequential fallback example: `1 Tràng Tiền`, Cửa Nam, Hà Nội | BLOCKED |
| House suffix A/B: `475A` / `475B Điện Biên Phủ` | BLOCKED |
| Accented / unaccented: `475A Điện Biên Phủ` / `475A Dien Bien Phu` | BLOCKED |
| Provider lacks or differs on canonical ward | BLOCKED |
| Multiple road candidates: `Điện Biên Phủ`, Thạnh Mỹ Tây | BLOCKED |
| No usable result / manual recovery | BLOCKED |

## Required behavior and regression

| Requirement | Evidence / result |
|---|---|
| Full query failure triggers sequential progressive fallback | Fix absent from released source; staging execution BLOCKED |
| Street-level candidates survive missing house number | Released policy still rejects them for a house-number query; staging execution BLOCKED |
| UI clearly labels approximate street suggestions | FAIL at artifact inspection: approximate-road renderer/warning absent |
| Explicit candidate selection and confirmation | Existing selection instruction is present in served JS; interactive staging verification BLOCKED |
| Map pin matches selected candidate | BLOCKED |
| Manual pin click/drag/confirm | BLOCKED |
| Provider cannot overwrite canonical city/ward | BLOCKED |
| Mandatory coordinates / stale-confirmation protection | BLOCKED |
| Service-area and business validation | BLOCKED |
| Create shipment and persisted address snapshots | BLOCKED |
| Quote | BLOCKED |
| Address book create/edit/reload | BLOCKED |
| Current location | BLOCKED |
| Reverse geocode | No reverse-geocode flow exists in the current implementation, as documented in the local report; source search found no reverse endpoint/adapter. Live GPS/manual-pin network behavior remains unverified. No feature added. |
| Responsive: 375×812, 812×375, 768×1024, 1440×900 | BLOCKED |

Relevant existing invariants: C01/C16 backend policy authority, C04 authorization/ownership, C08 immutable address snapshots. This task makes no product changes and does not claim fresh staging validation of these invariants.

## Artifacts, checks and blocker

Ignored, key-free evidence under `test-results/address-geocoding-staging/`:

- `release-probe.mjs` / `release-probe.json`, raw frontend release/index and downloaded served JavaScript.
- `backend-version-probe.mjs` / `backend-version-probe.json`, fresh backend version/liveness and request IDs.
- Entry JS SHA-256: `b1ff7c44a35f004307bb203cd22f497d326cd4388b62711142ff91d0a03f1887`.
- Location picker JS SHA-256: `80df2b678151a76b47ebe7342d1662602104d163f36ae52655e231c9dc6d309f`.

Public probes made 18 GET requests: 17 HTTP 200, one initial backend dependency-health timeout; zero HTTP mutations. No provider-key access, authenticated browser smoke, local fixture rerun or database operation. Checks performed: public release identity, embedded frontend SHA, served search renderer, Git source comparison, and documentation whitespace check. Files written by this task: this report, a short `PROJECT_STATE.md` update and ignored verification artifacts; all pre-existing source/test changes preserved.

**Blocker:** both staging services still serve the pre-fix commit. A release containing the geocoding fix must exist on both services before this requested staging matrix can be accepted. Commit/push/deploy is outside this verification-only request. Once that release is available, recheck both exact SHAs and execute the full authenticated address/interaction/regression matrix above. The [local and direct-provider report](ADDRESS_GEOCODING_RESILIENCE_20261016.md) remains valid only at its stated scope.
