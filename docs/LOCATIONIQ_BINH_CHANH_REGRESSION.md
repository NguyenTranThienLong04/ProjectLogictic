# Saved Address: Bình Chánh exact-query audit — 2026-09-27

**Observed provider limitation for the existing bounded search strategy. No matcher/normalization or frontend product change.** The live provider returned no exact house/road candidate for `14/13a đường số 4 khu phố 2`, ward `Bình Chánh`, province `Hồ Chí Minh`. Manual pin fallback remains unchanged. **Authenticated staging search and its deployed backend commit are NOT VERIFIED.**

## Scope and capture

At `2026-09-27T00:55:23.709Z`, freshly compiled local backend called real LocationIQ using the configured backend-local key. Product hierarchy code comes from commit `631c7240723c6622c6b80bab4cfa0e30a638798a`; no product matcher edits were made. An earlier run at `00:53:56.942Z` produced the same statuses/candidate/rejection. This is provider evidence, not a capture inside Render.

Complete key-free capture: `test-results/locationiq-binh-chanh-live.json` (ignored local artifact). It contains both requests, raw candidates, normalized addresses, independent policy diagnostics, the evaluator's first rejection and final selectable array. Province is sent in the API's `city` field:

```json
{
  "street": "14/13a đường số 4 khu phố 2",
  "ward": "Bình Chánh",
  "city": "Hồ Chí Minh"
}
```

Shared parameters: `format=json`, `countrycodes=vn`, `limit=5`, `addressdetails=1`, `normalizeaddress=1`, `accept-language=vi`, `bounded=1`, `viewbox=106.519121,10.614000,106.620879,10.714000`. Canonical ward centre: `10.664,106.57`. No query shortening or area expansion.

| Attempt | Endpoint / address parameters | Status | Raw candidates |
| --- | --- | --- | --- |
| Structured | `https://us1.locationiq.com/v1/search/structured`; `street=14/13a đường số 4 khu phố 2`, `state=Hồ Chí Minh`, `country=Vietnam` | 404 | `[]` (provider not found) |
| Fallback | `https://us1.locationiq.com/v1/search`; `q=14/13a đường số 4 khu phố 2, Bình Chánh, Hồ Chí Minh, Việt Nam` | 200 | One locality, below |

Raw fallback candidate:

```json
{
  "place_id": "332108734773",
  "licence": "https://locationiq.com/attribution",
  "lat": "10.69541",
  "lon": "106.59128",
  "display_name": "Tân Túc, Binh Chanh, Thành phố Hồ Chí Minh, Việt Nam",
  "boundingbox": ["10.67541", "10.71541", "106.57128", "106.61128"],
  "importance": 0.15,
  "address": {
    "city": "Tân Túc",
    "county": "Binh Chanh",
    "state": "Thành phố Hồ Chí Minh",
    "country": "Việt Nam",
    "country_code": "vn"
  }
}
```

Normalized candidate address (absent house/road fields stay absent):

```json
{
  "countryCode": "vn",
  "country": "Việt Nam",
  "provinceLevels": [{ "field": "state", "name": "Thành phố Hồ Chí Minh" }],
  "wardLevels": [],
  "localLevels": [],
  "intermediateLevels": [
    { "field": "city", "name": "Tân Túc" },
    { "field": "county", "name": "Binh Chanh" }
  ]
}
```

| Candidate | Policy evidence | Decision |
| --- | --- | --- |
| `332108734773` | Raw coordinate inside viewbox; VN and province match. `city=Tân Túc` produces `provider_hierarchy_anomaly:city`; no structured ward evidence. No `house_number` or `road`; independent `matchesSearchStreet` is false. | First rejecting gate: `hierarchy_anomaly_without_ward_match`. No selectable result. |

Final selectable result: `[]`. Even removing the hierarchy veto would not supply house/road evidence. No valid exact candidate was observed being incorrectly rejected. This establishes the limitation of these exact bounded requests at the capture time; it does not prove that every possible query or the provider's entire dataset lacks the address. The search window is an approximate ward-centre box, not a ward polygon.

## Staging commit verification

Read-only evidence: `test-results/locationiq-binh-chanh-staging.json`, captured `00:56:18Z`–`00:56:22Z`.

- Expected latest hierarchy fix: `631c7240723c6622c6b80bab4cfa0e30a638798a`, confirmed from Git history for `locationiq-address-normalization.ts`.
- Render API health: HTTP 200, database/Redis up; request ID `38355679-bd12-499b-9321-10f03bf87bd7`. Health has no deployed SHA.
- Render web: HTTP 200, entry asset `/assets/index-Dj1u16fE.js`. This does not identify the backend commit.
- Public GitHub deployments: `[]`; commit statuses: `[]`. The commit's `verify` and `release-gate` checks report failure. None establishes which commit Render is currently serving.
- CDP 9222 has only Lenovo Vantage; 9223–9226 are unavailable. No authenticated staging Customer/Admin session or Render management access was available. No authenticated search was made, and no deployment was performed.

Remaining verification requires the Render backend's current Live deployment record (SHA/status/service) and an authenticated Customer/Admin session for this exact API payload. Access was requested during the investigation. Do not mark staging current, stale, or PASS from the provider trace alone.

## Changes and checks

- `backend/scripts/audit-address-search.mjs`: accepts `--input` JSON and a separate `--output` file under `test-results/`; captures normalized address and independent diagnostics using the existing shared policies; records provider 404 as zero candidates. Existing default audit remains supported.
- `backend/src/modules/locations/locationiq-address-normalization.spec.ts`: actual live locality fixture verifies rejection and lack of house/road evidence. No synthetic exact-result assumption or address-specific product exception.
- This report and `PROJECT_STATE.md` record findings. C01/C04/C08/C16 retained: backend authority, auth/scope, immutable snapshots and one policy source. No schema, business-data or frontend product changes by this task.
- Backend build PASS. Focused normalization/service/controller regression: **104/104 PASS**, three suites. Changed spec ESLint, audit script syntax and scoped diff checks PASS.
- Frontend build attempt was blocked by `TS2741` at `driver-location-provider.tsx:201`: required `retryGps` missing from its context value. Unrelated GPS/auth files were being edited concurrently in the shared workspace; this task did not edit them. No fresh frontend browser PASS is claimed. Existing manual fallback code is unchanged; staging interaction remains unverified.

To reproduce, save the exact input above as `test-results/locationiq-binh-chanh-input.json`, then:

```powershell
npm run build --workspace backend
node backend/scripts/audit-address-search.mjs .env --input test-results/locationiq-binh-chanh-input.json --output test-results/locationiq-binh-chanh-live.json
```

No key or credential URL is printed or saved by the audit.
