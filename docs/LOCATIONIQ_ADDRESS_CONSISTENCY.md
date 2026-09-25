# LocationIQ address consistency — 2026-09-25

## Root cause and invariant

The existing UI sent `street`, `ward`, `district`, `city`; the backend already joined those into `q`. For the reported selection it did **not** search street alone. However, ward was optional, no backend canonical lookup occurred, no local viewbox was supplied, and candidate validation checked only `country_code=vn`, numeric coordinate ranges and required response fields. Any Vietnamese result in another administrative area could become a selectable result and draft pin.

C01/C16: backend now owns one candidate policy; province/ward selectors remain authoritative. C04 authentication/roles/throttling and C08 historical snapshots remain unchanged. No lifecycle, provider, address persistence schema, dependency or migration changes.

## Request before / after

UI → `POST /api/v1/locations/address-search`:

```json
{"street":"123 Nguyễn Trãi","ward":"Bến Thành","district":"","city":"Hồ Chí Minh"}
```

`street`, `city` and `ward` are now required. Backend resolves the selected province and its ward from the same dataset as the UI. Invalid/mismatched canonical selections return 400 before any provider call. The legacy district field remains accepted but cannot override the current two-level selection.

Both versions use `GET https://us1.locationiq.com/v1/search`, with backend-only `key` omitted here:

| Parameter | Before | After |
| --- | --- | --- |
| `q` | `123 Nguyễn Trãi, Bến Thành, Hồ Chí Minh, Vietnam` | `123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh, Vietnam` |
| `viewbox` | absent | `106.644103,10.720000,106.745897,10.820000` |
| `bounded` | absent | `0` |
| `countrycodes` | `vn` | `vn` |
| `format`, `addressdetails`, `limit`, `accept-language` | `json`, `1`, `5`, `vi` | unchanged |

The viewbox derives from the existing Bến Thành point `(10.77, 106.695)`, not a new geographic dataset. [LocationIQ documents viewbox as a preference and bounded=1 as a restriction](https://docs.locationiq.com/reference/search). We use bias because the canonical dataset contains approximate centres, **no ward/province boundaries**. This is not a polygon containment check.

## Filtering and UI

- Require Vietnam, affirmative canonical province and ward/locality matches. Normalize accents, administrative prefixes and supported city aliases through the shared catalogue.
- Check every relevant provider hierarchy field, not just the first match. A matching ward cannot cancel a contradictory city/province/locality. Explicit conflicting administrative labels in `display_name`, and conflicting bare parent names following the ward, also veto the candidate. Display text alone cannot supply missing structured proof.
- For the reported selection, `Thành phố Thủ Đức` is rejected along with its coordinate. Thủ Đức is not blacklisted: a consistent result is accepted when the user actually selects that ward.
- Return the provider's unmodified display text and its own validated coordinate, rounded to the existing six-decimal contract. Do not substitute the ward centre or relabel a wrong pin.
- UI requires the canonical pair to enable search, renders only the backend results, and reports no match as: `Không tìm thấy địa chỉ phù hợp với Phường Bến Thành, Hồ Chí Minh. Hãy thử địa chỉ khác hoặc đặt pin thủ công.` Provider errors have a separate retry/manual-pin message.
- Selecting a result keeps province/ward unchanged, centres the map on its draft coordinate at zoom 16, and still requires explicit confirmation. Empty/error/rejected results leave manual click/drag/keyboard selection available. Existing address fingerprints discard stale requests and coordinates.

## Files

- `backend/src/modules/locations/address-search-policy.ts`, `address-search.service.ts`, `dto/address-search.dto.ts`: canonical resolution, request bias and candidate filtering.
- `backend/src/common/addresses/administrative-data.ts` and `data/`: single shared catalogue moved from the frontend; existing codes/names/parents/coordinates preserved, full ward labels retained from the same pinned cross-check source. Backend build includes JSON in `dist`.
- `frontend/src/features/addresses/administrative-model.ts`: re-exports the shared catalogue; maintenance script and integrity test follow the new location.
- `frontend/src/features/locations/address-search.tsx`, `location-api.ts`: required ward, contextual empty/error states. Existing picker/map coordinate/focus behavior reused.
- Search service/HTTP specs, frontend catalogue integrity test and `frontend/test/address-location/check.mjs`: regression coverage.

## Verification

| Check | Result |
| --- | --- |
| Backend focused: search service/HTTP, address/quote DTOs, saved addresses, shipment snapshots, assignment candidates | **PASS — 120/120, 7 suites** |
| Frontend unit suite, including canonical integrity/checksum | **PASS — 51/51** |
| `--validated-search`: actual compiled backend service → production-built UI with raw provider fixtures | **PASS — 375×812, 812×375, 768×1024, 1440×900** |
| Reported Thủ Đức regression, same street in different areas, wrong province/ward, no match, valid coordinate, manual fallback | **PASS** |
| Province/ward preserved; draft and confirmed coordinate exact to six decimals; marker centred at zoom 16 | **PASS** |
| Original canonical codes/names/parents/coordinates compared with Git baseline | **PASS — unchanged** |
| Workspace lint/typecheck, backend + frontend builds, diff whitespace checks | **PASS** |
| Live LocationIQ, staging deployment, real database persistence | **NOT RUN** |

The sandbox initially blocked Node/Vite/browser subprocesses and the pinned-source download; approved retries passed. Initial test query expectations and one formatting failure were corrected, then rerun successfully. Vite retains its existing chunk-size warning.

Fixtures exercise the real backend service and production-built UI; no live LocationIQ accuracy, staging deployment or database persistence claim is made. Without polygons or historical ward mappings, ambiguous/obsolete provider hierarchies can be rejected even when nearby; manual pin remains the fallback. The provider's own coordinate accuracy cannot be certified from administrative names alone.
