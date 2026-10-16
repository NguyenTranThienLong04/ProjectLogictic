# Address geocoding resilience — 2026-10-16

**ADDRESS GEOCODING RESILIENCE: PASS (local + direct live-provider verification).** No migration, provider replacement, dependency addition, deployment or business-data mutation. Exact house-level coverage and staging verification are not implied.

## 1. Root cause and trace

`CreateShipmentPage` → shared `ShipmentFormFields` / `AdministrativeAddressFields` → `LocationPicker` → `AddressSearch` → authenticated `POST /api/v1/locations/address-search` → `AddressSearchService` → LocationIQ → `evaluateAddressCandidate` → list → explicit selection → draft marker/zoom 16 → Confirm → coordinate + address fingerprint → existing shipment serializer.

The reported address is reproducible against the real provider. **The provider did return road candidates; the application discarded every one because none contained house number `475A`.** The old exact-house policy had no approximate-road result type. A second independent restriction rejected differing provider ward labels, even inside the allowed search window. The eight-case audit also reproduced rejection of `1 Tràng Tiền` because the provider calls the road `Phố Tràng Tiền`; the old normalizer only stripped `Đường`/`Street`.

Existing useful behavior was retained: explicit search, up to five selectable results (not `result[0]`), fingerprint-based stale-coordinate protection, map draft/confirm, manual pin and GPS. The previous result label always came from the requested full address, making distinct candidates hard to distinguish.

## 2. Before and after query formats

Before:

1. `/v1/search/structured?street=475A Điện Biên Phủ&state=Hồ Chí Minh&country=Vietnam`.
2. On no selectable result: `/v1/search?q=475A Điện Biên Phủ, Thạnh Mỹ Tây, Hồ Chí Minh, Việt Nam`.

Both used `countrycodes=vn`, `limit=5`, `addressdetails=1`, `normalizeaddress=1`, Vietnamese language, `bounded=1` and a ward-centred viewbox. For this ward: `106.667099,10.749000,106.768901,10.849000`. It was **not a city polygon**. House suffix parsing and accent-insensitive comparison already existed, but no fallback removed the house requirement. Canonical lookup resolves the user's `Thanh Mỹ Tây` to the dataset's `Thạnh Mỹ Tây`; no catalogue entries were changed.

After: at most four deduplicated **free-form, sequential** queries:

1. House + road + canonical ward + province + Việt Nam.
2. House + road + province + Việt Nam.
3. Road + canonical ward + province + Việt Nam.
4. Road + province + Việt Nam.

Stop as soon as there are usable suggestions; no unconditional parallel fan-out. Missing house/ward yields fewer distinct queries. All attempts keep the same geographic restrictions. With no selected ward, use the envelope of existing canonical ward centres plus the existing search margin, and require positive provider province evidence. This is a search heuristic, not a service-area boundary. LocationIQ documents [free-form search, viewbox and bounded](https://docs.locationiq.com/reference/search) and [structured hierarchy semantics](https://docs.locationiq.com/reference/search-structured).

## 3. Sanitized real-provider evidence

Before capture: **2026-10-16 03:27 ICT**. Final after capture: **2026-10-16 08:43 ICT**. The audit uses the compiled local backend with real LocationIQ, not staging or browser mocks.

Example from the failing fallback (HTTP 200), abbreviated from raw response:

```json
{
  "place_id": "257370683",
  "lat": "10.7989661",
  "lon": "106.7218629",
  "class": "highway",
  "address": {
    "road": "Điện Biên Phủ",
    "suburb": "Phường Thạnh Mỹ Tây",
    "city": "Thành phố Thủ Đức",
    "country_code": "vn"
  }
}
```

No `house_number`. Before: `street_or_house_mismatch`. After: `precision=STREET`, actual coordinates rounded to `10.798966,106.721863`, label **without invented 475A**, provider locality shown separately. This is a road location, **not verified coordinates for house 475A**.

Raw query/status/body/decision artifacts: [before](../test-results/locationiq-resilience-before.json), [after](../test-results/locationiq-resilience-after.json). These local artifacts are ignored by Git. A key-free target response is retained in the [tracked regression fixture](../backend/src/modules/locations/fixtures/locationiq-resilience.json). OSM-derived data retains provider attribution; UI attribution remains visible.

| Live matrix | Before selectable | After selectable | Interpretation |
|---|---:|---:|---|
| 475A Điện Biên Phủ + Thạnh Mỹ Tây | 0 | 5 | Road suggestions, not an exact house |
| 475A Dien Bien Phu + Thạnh Mỹ Tây | 0 | 5 | Same behavior without accents |
| 475A Điện Biên Phủ, no ward | HTTP 400 | 0 | Search now allowed; provider lacks province evidence, manual pin retained |
| Điện Biên Phủ + Thạnh Mỹ Tây | 4 | 5 | Multiple road segments |
| 123 Nguyễn Trãi + Bến Thành | 1 | 1 | Existing house result preserved |
| 1 Tràng Tiền + Cửa Nam, Hà Nội | 0 | 1 | Full query gives wrong road; no-ward fallback yields matching house/Phố Tràng Tiền |
| Điện Biên Phủ + Ba Đình, Hà Nội | 3 | 2 | Distinct suggestions after deduplication |
| 14/13a đường số 4 khu phố 2 + Bình Chánh | 0 | 0 | Locality-only response remains insufficient; manual pin |

Counts are snapshots of provider behavior, not guaranteed coverage. No result or centroid is fabricated.

## 4. Filtering and administrative mismatch

- **App-side filtering issue: YES.** Missing exact house, strict ward and missing `Phố`/legacy `Ð` normalization caused avoidable rejection.
- **Administrative labels differ: YES.** Responses include differing suburbs and the ambiguous `city=Thành phố Thủ Đức` hierarchy. However, the target's full-query fallback already matched `Thạnh Mỹ Tây`; its proven rejection was the missing house. This audit does **not** prove an old/new ward rename caused this particular target failure.
- Ward/intermediate labels now produce warnings, not hard rejection, provided street and bounded-coordinate checks succeed. Explicit conflicting country/state/province/region still fail. The canonical 34-province/3,321-ward snapshot remains unchanged.
- An explicitly different house still fails. A missing house is approximate only for a provider road feature (`class/category=highway`). Locality-only/no-road results never become a pin. Comparison supports NFC/accents, Đ/Ð, Đường/Phố/Street and house suffix/alley/range tokens.
- Deduplicate coordinates and equivalent house address/locality. Preserve different road segments with different coordinates. Prefer house matches, then candidates without ward-label differences, capped at five. None are auto-selected.

## 5. UX, ownership and reverse geocoding

Each suggestion shows its address, separately labelled provider locality, six-decimal coordinates and an approximate-road warning where applicable. Clicking or keyboard-selecting a result opens a draft marker at zoom 16; Confirm alone commits it. Provider text never updates street/province/ward selectors. Existing form validation still requires the canonical hierarchy and current confirmed coordinates where required; an optional ward on the **search DTO** does not relax address/shipment DTOs or service eligibility.

Map click/drag and current GPS do **not** call reverse geocoding in this application. They update only the coordinate draft. No reverse adapter was added. Fingerprint changes remount the picker and abort the old request; a late response cannot overwrite the next search. Manual map/GPS remain available on empty/error/429 results. No search happens on typing/blur, so a new debounce is unnecessary.

## 6. Provider safety and business invariants

Existing server-only `LOCATIONIQ_API_KEY`, fixed provider origin, 5-second per-request timeout, no redirects, sanitized failures, endpoint JWT/role throttle and account quotas (2/sec, 60/min, 5,000/day) remain. Every fallback consumes quota; request-start pacing prevents a four-attempt lookup from exhausting its own 2/sec limit. 429/network/5xx stop the sequence. Client disconnect aborts the upstream request and prevents later fallbacks. No key enters the browser or captured artifacts.

C01/C16: one backend search policy, no duplicated form rule. C04: existing Customer/Admin authorization and shipment ownership preserved. C08: coordinates are only committed by the existing form flow; shipment snapshots are unchanged. Assignment/warehouse/service-area policies, pricing, COD, historical data and mandatory pin rules were not altered. **Migration required: NO.**

## 7. Changed files

- Backend: `address-search-policy.ts`, `address-search.service.ts`, `dto/address-search.dto.ts`, `locations.controller.ts` under `backend/src/modules/locations/`.
- Frontend: `frontend/src/features/locations/address-search.tsx`, `location-api.ts`; reuse existing picker/map and all forms.
- Regression: `address-search-resilience.spec.ts`, `address-search.service.spec.ts`, `address-search.controller.spec.ts`, `locationiq-address-normalization.spec.ts`, `fixtures/locationiq-resilience.json`; `frontend/test/address-location/check.mjs`.
- Live audit: `backend/scripts/audit-address-resilience.mjs`.
- Documentation: this report, `docs/UI.md`, `docs/TESTING.md`, `PROJECT_STATE.md`.

Unrelated notification work already present in the workspace is preserved.

## 8. Validation and limits

- Backend: **204/204 tests, 10 suites PASS** (search/normalization/controller, saved addresses/coordinate DTOs, quote DTO, shipments, assignment candidates, environment validation).
- Frontend: **86/86 unit tests PASS**, including canonical dataset, stale/missing pin validation and shipment serialization.
- Workspace typecheck, lint and backend/frontend build: **PASS**. Existing Vite chunk-size and unknown-local-release-SHA warnings remain; they do not indicate geocoding failure.
- Browser `--validated-search`: **PASS, exit 0** at 375×812, 812×375, 768×1024 and 1440×900. A–F and label-preservation assertions pass, including choosing the second approximate road result, deduplication, zoom 16, explicit confirmation, 429/manual fallback, optional search ward and latest-search wins. Existing Saved Address/Warehouse and Shipment/Quote payload regressions pass. Fixture screenshots: [mobile](../test-results/address-geocoding/results-375.png), [desktop](../test-results/address-geocoding/results-1440.png).
- Browser `--current-location`: **PASS, exit 0**, including GPS success, denied/unavailable/timeout recovery, manual pin, canonical-selector preservation and late callbacks after cancellation/address change. There is no reverse-geocode request to overwrite administrative fields.
- Configured LocationIQ key absent from captured artifacts and production frontend JavaScript: **PASS**. `git diff --check`: **PASS**.
- Browser uses the real production-built pages and compiled backend with raw provider fixtures; API persistence/tiles are mocked. Live matrix above is a separate real-provider check. No deployed/staging/real-DB persistence PASS is claimed.
- Local runtime: Node 24.13.1; project CI targets Node 22, not rerun as hosted CI in this task.

Reproduce after build:

```text
node backend/scripts/audit-address-resilience.mjs .env after
node frontend/test/address-location/check.mjs --validated-search
node frontend/test/address-location/check.mjs --current-location
```

The two browser modes use independent coordinate fixtures and must run separately. Sandbox `spawn EPERM` required approved local browser/unit-test execution. During development, fixture selectors/expectations were corrected (canonical Thạnh spelling; coordinate text isolated from locality text; the no-ward province window differs from the ward window), and backend formatting was aligned with repository lint. A redirected PowerShell run wrapped an existing build warning as `NativeCommandError` despite all assertions passing; the final direct run above exited 0. No failing business checks were removed.
