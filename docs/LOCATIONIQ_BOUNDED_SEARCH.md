# LocationIQ bounded search — 2026-09-27

> Historical baseline. The hierarchy policy and live failure below were superseded later on 2026-09-27 by [semantic normalization](LOCATIONIQ_HIERARCHY_NORMALIZATION.md): the same live candidate now passes with a soft city anomaly. Search strategy/bounds remain unchanged; the original evidence is retained here.

Search strategy implemented locally. **The live target address still has zero selectable candidates**: LocationIQ returns explicitly conflicting `city=Thành phố Thủ Đức` for the house in both new attempts. This conflict remains rejected. **Authenticated staging: NOT VERIFIED; this change has not been deployed.**

## Root cause and fix

The previous free-form query used an unbounded ward-centre bias and required affirmative structured province AND ward evidence. That rejected missing metadata as well as actual conflicts. The backend now retrieves within a bounded area and checks raw and six-decimal coordinates against that exact same area. Missing administrative fields are allowed only with structured street/house evidence and no explicit administrative conflict. Country code VN remains mandatory; contradictory country, province, ward, municipality and display hierarchy still veto a candidate. `display_name` never supplies street/admin proof.

Primary uses LocationIQ's documented [structured endpoint](https://docs.locationiq.com/reference/search-structured). The canonical province maps to `state`, including centrally governed cities; ward is not incorrectly passed as a city. A [free-form fallback](https://docs.locationiq.com/reference/search) runs when there are no selectable primary candidates, including an empty array, 404, or every candidate rejected. Both attempts share all restrictions and the exact validator. No result triggers a broader area, provider change or third request. Errors/429 stop the search. Each provider request consumes existing account-wide quota (2/second, 60/minute, 5,000/day); each has a 5-second timeout. Existing client throttle/click-only interaction remains intact.

C01 backend authority, C04 role/ownership, C08 snapshot consistency and C16 single-source policy remain enforced. No schema, dependencies, pricing, assignment, persistence or lifecycle change.

## Requests before / after (key omitted)

Shared options: `format=json`, `countrycodes=vn`, `addressdetails=1`, `accept-language=vi`, `limit=5`.

| Attempt | Endpoint | Address parameters | Spatial / normalization |
| --- | --- | --- | --- |
| Before | `/v1/search` | `q=123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh, Vietnam` | same viewbox, `bounded=0`, no normalizeaddress |
| Primary | `/v1/search/structured` | `street=123 Nguyễn Trãi`, `state=Hồ Chí Minh`, `country=Vietnam` | same viewbox, `bounded=1`, `normalizeaddress=1` |
| Fallback | `/v1/search` | `q=123 Nguyễn Trãi, Bến Thành, Hồ Chí Minh, Việt Nam` | same viewbox, `bounded=1`, `normalizeaddress=1` |

Area reuses `addressSearchViewbox` and the canonical Bến Thành ward centre `10.77, 106.695` (province `79`, ward `26743`). The existing ±0.05° latitude / cosine-adjusted longitude window is unchanged:

```text
west,south,east,north = 106.644103,10.720000,106.745897,10.820000
```

This is a bounded search window around an approximate centre, **not an administrative polygon**. It cannot prove exact ward membership or exclude every neighbouring ward geometrically. Explicit hierarchy conflicts remain rejected even inside the rectangle. Provider-supplied house bounding boxes never replace the selected search area. No wider radius was introduced.

## Live raw candidates and decisions

At **2026-09-27 00:17:25 UTC**, the local compiled service called the real LocationIQ API using the configured backend key. The before-comparison request is audit-only; the actual service made two requests. All three requests returned HTTP 200 and one candidate each:

| Field | Before / primary / fallback |
| --- | --- |
| place_id | `257000422` |
| osm_type / osm_id | `node` / `6791068236` |
| raw lat / lon | `10.7695084` / `106.6907953` |
| normalized lat / lon | `10.769508` / `106.690795` |
| house_number / road | `123` / `Đường Nguyễn Trãi` |
| neighbourhood | `Khu phố 3` |
| suburb | `Phường Bến Thành` |
| city | **`Thành phố Thủ Đức`** |
| state / province | absent |
| country / country_code | `Việt Nam` / `vn` |
| postcode | `70200` |
| provider boundingbox | `[10.7694584,10.7695584,106.6907453,106.6908453]` |

Before display name:

```text
123, Đường Nguyễn Trãi, Khu phố 3, Phường Bến Thành, Thành phố Thủ Đức, Thành phố Hồ Chí Minh, 70200, Việt Nam
```

Both new attempts' display name:

```text
123, Đường Nguyễn Trãi, Khu phố 3, Phường Bến Thành, Thành phố Thủ Đức, 70200, Việt Nam
```

All three pass coordinate/window/house/road checks but fail at **`conflicting_city`**. Missing `state` is no longer a rejection reason. The display hierarchy independently conflicts too. Final selectable candidates: **`[]`**. No coordinate or administrative field was rewritten to turn the conflict into a match.

Full raw responses, key-free request parameters and the actual shared evaluator's decisions are in ignored `test-results/locationiq-bounded-live.json`. Reproduce after build:

```powershell
node backend/scripts/audit-address-search.mjs .env --compare-before
```

The script makes read-only provider calls; it does not invoke a deployed authenticated API or write business records. It stores no key or credential URL. Live target outcome: **FAIL (provider hierarchy conflict)**. A staging PASS cannot be inferred from these calls.

## Regression and validation

- Backend address-search/HTTP regression: **75/75 PASS**; final focused address/DTO/shipment/assignment/config run: **149/149 PASS**, 8 suites.
- Exact-house success in selected area; street-prefix normalization (`Đường`); missing state, missing ward and both missing with structured evidence; no structured road/house evidence; foreign/missing country code; wrong province/ward/city; display conflicts; same street outside the box even when all text claims Bến Thành; original/rounded edge containment; valid Thủ Đức when actually selected; six-decimal DTO compatibility.
- Empty/404 fallback, all-rejected structured fallback, identical restrictions, two-call maximum, per-attempt quota, fallback error and quota failure; no fallback when primary yields selectable candidates.
- Frontend unit tests: **51/51 PASS**. Product empty message is exactly `Không tìm thấy địa chỉ chính xác. Bạn có thể đặt pin thủ công trong khu vực đã chọn.`
- Production backend/frontend build, workspace lint and typecheck: **PASS**.
- Production-built browser regression `node frontend/test/address-location/check.mjs --validated-search`: **PASS** at 375×812, 812×375, 768×1024 and 1440×900. Warehouse/Saved Address flows preserve canonical selectors, exact selected coordinate/zoom-16 draft, explicit confirmation, stale blocking and captured HTTP payloads. Shipment/Quote confirm or omit stale coordinates correctly. Typing makes zero searches; double-click makes one app request. Missing-state candidates are selectable; Thủ Đức, wrong province/ward, conflicting hierarchy inside the box and matching text outside the area are not selectable. Empty/error/rejected-result manual pin fallback **PASS**. No page errors.
- Initial frontend tests/browser build hit sandbox `spawn EPERM`; approved unsandboxed retries passed. Initial browser fixture incorrectly retained Bến Thành coordinates/display after switching to Hà Nội; fixed the fixture to use the selected canonical ward coordinate and matching display, retaining the region-change assertions. Initial test-only lint errors corrected.

Browser fixtures and local HTTP persistence are mocked; live provider results above are not mocked. No authenticated staging result or real business persistence PASS is claimed.

## Files

- `backend/src/modules/locations/address-search-policy.ts`: shared bounds containment, house/street match and explicit administrative rejection reasons.
- `backend/src/modules/locations/address-search.service.ts`: structured/fallback requests, per-attempt quota, shared candidate evaluator.
- `backend/src/modules/locations/address-search.service.spec.ts`, `address-search.controller.spec.ts`: regressions.
- `backend/scripts/audit-address-search.mjs`: reproducible live evidence.
- `frontend/src/features/locations/address-search.tsx`: requested empty-state message.
- `frontend/test/address-location/check.mjs`: real compiled validator + browser checks, region-correct fixtures after canonical selection changes.
- `docs/STACK.md`, `docs/TESTING.md`, `PROJECT_STATE.md`: current contract/status.
