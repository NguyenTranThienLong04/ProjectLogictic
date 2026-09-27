# LocationIQ hierarchy normalization — 2026-09-27

**Live provider via local compiled backend: PASS.** Candidate `257000422` is selectable after one structured request. **Authenticated staging: NOT VERIFIED; changes are local and have not been deployed.** This supersedes the hierarchy rejection policy in `LOCATIONIQ_BOUNDED_SEARCH.md` while retaining its search strategy and spatial checks.

## Semantics before / after

The old matcher treated raw `city` as a canonical province/municipality constraint and vetoed conflicting display text. LocationIQ's [normalized address contract](https://docs.locationiq.com/reference/search-structured) explicitly allows `city` to represent several intermediate levels. The app's canonical province therefore cannot be inferred from this field.

| Provider field | Before | After |
| --- | --- | --- |
| `state`, `province`, `region` | state/province hard; region not checked | explicit province-level evidence; any mismatch is hard rejection |
| `ward`, `suburb`, `quarter` | hierarchy constraint | normalized ward evidence; explicit mismatch is hard rejection |
| `neighbourhood`, `neighborhood`, `locality`, `village`, `hamlet` | mixed handling | named canonical ward or explicit Phường/Xã/ward/commune label is ward evidence; explicit other ward rejects |
| `Khu phố 3` etc. | incidental metadata | subward community, neither ward proof nor ward conflict |
| `city`, `city_district`, `borough`, `municipality`, `county`, `town`, `district`, `state_district` | often hard province/ward conflict | intermediate provider hierarchy; never mapped into canonical province |
| `display_name` | hierarchy veto and UI label | not validation evidence and not used as the UI label |

The adapter `normalizeLocationIqAddress` preserves the field provenance in separate semantic buckets. `assessAdministration` consumes those buckets, rather than interpreting raw city as app province. Unexpected intermediate names generate `provider_hierarchy_anomaly:<field>` diagnostics. Such an anomaly needs affirmative structured ward match to be accepted; display text and intermediate levels cannot supply ward proof. Without that proof, `hierarchy_anomaly_without_ward_match` rejects it. Existing missing-metadata handling remains available when there is no anomaly and all other required evidence matches.

Mandatory checks remain: VN country code, no conflicting country, finite/in-range coordinates, raw AND rounded coordinates inside the exact bounded search window, structured road and query house-number match, no conflicting explicit province/region or ward evidence. Normalization handles accents, case, Vietnamese road prefixes and house-number suffixes/slashes; there is no special case for an address or place ID.

Accepted result `displayName` is constructed from the validated street query + canonical ward fullName + canonical province. Result `ward` and `city` also use canonical selected values. Coordinates always come from the candidate, with existing six-decimal normalization. No provider metadata overwrites form selectors; candidate selection remains a draft requiring explicit confirmation.

## Live before / after

Before evidence: `2026-09-27 00:17:25 UTC`, preserved in ignored `test-results/locationiq-bounded-live.json`: primary and fallback each returned one house and were rejected `conflicting_city`, selectable `[]`.

After evidence: `2026-09-27 00:29:26 UTC`, real LocationIQ HTTP 200 through the rebuilt local backend, recorded in ignored `test-results/locationiq-hierarchy-live.json`:

```json
{
  "place_id": "257000422",
  "lat": "10.7695084",
  "lon": "106.6907953",
  "address": {
    "house_number": "123",
    "road": "Đường Nguyễn Trãi",
    "neighbourhood": "Khu phố 3",
    "suburb": "Phường Bến Thành",
    "city": "Thành phố Thủ Đức",
    "country": "Việt Nam",
    "country_code": "vn"
  }
}
```

State is absent. Raw display: `123, Đường Nguyễn Trãi, Khu phố 3, Phường Bến Thành, Thành phố Thủ Đức, 70200, Việt Nam`.

Accepted because VN + exact normalized ward + inside selected bbox + matching house/road + no conflicting province-level evidence. Diagnostic: `provider_hierarchy_anomaly:city`. Selectable response:

```json
{
  "id": "257000422",
  "displayName": "123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh",
  "latitude": 10.769508,
  "longitude": 106.690795,
  "houseNumber": "123",
  "road": "Đường Nguyễn Trãi",
  "ward": "Bến Thành",
  "city": "Hồ Chí Minh"
}
```

One structured request, no fallback needed. Request/area remain unchanged: `street=123 Nguyễn Trãi`, `state=Hồ Chí Minh`, `country=Vietnam`, `countrycodes=vn`, `normalizeaddress=1`, `addressdetails=1`, `accept-language=vi`, `limit=5`, `bounded=1`, viewbox `106.644103,10.720000,106.745897,10.820000`. Reuses canonical ward centre `10.77,106.695`; no expanded radius. The window is not a polygon and cannot certify exact administrative borders.

Reproduce after build: `node backend/scripts/audit-address-search.mjs .env`. The script reads a backend-local key without exposing it; no business writes, database, staging login or deployment are performed.

## Regression / files

- Backend **177/177 PASS**, 9 suites: normalization/service/controller, address DTO/service, shipment, assignment, quote DTO, env config. Includes live fixture acceptance, hard rejection of actual outside Thủ Đức coordinates, wrong ward/state/province/region, same road elsewhere, missing-state acceptance, all intermediate fields, ambiguous city without ward proof, display-only evidence rejection and a different house/road. Existing request limits/fallback/rounding tests remain.
- Frontend unit tests **51/51 PASS**. Production-built browser `node frontend/test/address-location/check.mjs --validated-search` **PASS** at 375×812, 812×375, 768×1024, 1440×900. Live-anomaly fixtures are selectable with canonical labels, exact candidate coordinate draft/map focus and unchanged selectors. Wrong province/region/ward/neighbourhood and outside-area fixtures are not selectable; empty/error/rejected-result manual pin fallback **PASS**. Saved Address/Warehouse create/edit, Shipment/Quote payload capture, stale invalidation, typing zero searches and double-click one app request remain PASS. Provider and HTTP persistence are mocked in browser; the direct live evidence above is real.
- Workspace lint/typecheck and backend/frontend production builds **PASS**. Sandbox blocked frontend test/browser subprocesses with `spawn EPERM`; approved retries passed. No frontend production logic change was necessary in this semantic fix: the shared component already renders the backend result label and preserves selectors.
- Files: new `backend/src/modules/locations/locationiq-address-normalization.ts` and its spec; updated `address-search-policy.ts`, `address-search.service.ts`, service tests, `backend/scripts/audit-address-search.mjs`, browser fixture, STACK/TESTING/PROJECT_STATE and these reports.
- C01 backend authority, C04 authorization/scope, C08 immutable snapshots and C16 single policy source retained. No provider/dependency/schema/lifecycle/ownership change.

Staging remains **NOT VERIFIED**, distinct from the successful direct live provider check. No deployed authenticated search/selection/manual-pin PASS is claimed.
