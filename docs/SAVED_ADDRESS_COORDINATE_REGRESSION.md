# Saved Address coordinate regression — 2026-09-19

## Finding and scope

Baseline inspected: `6a46401`. The reported staging Save error is not proof of a string payload: `@IsNumber({ maxDecimalPlaces: 6 })` produces the same message for numeric coordinates with excessive precision.

A live LocationIQ request using the configured backend key returned HTTP 200 and `{"lat":"10.7695084","lon":"106.6907953"}`; both runtime types were `string`. No key or credential URL was logged. This is a provider sample, not the original staging request for the displayed `10.878105, 106.810129`.

Before application edits, existing tests passed (34/34), and three new provider-to-DTO tests failed for CreateAddressDto, UpdateAddressDto and QuoteAddressDto. Their `typeof` assertions passed: the existing service already emitted numbers. Failure was caused by seven decimal places. HTTP regression tests also reproduce the exact reported latitude/longitude messages using JSON numbers with seven decimals.

| Boundary | Before (local source/request tests) | After |
| --- | --- | --- |
| Raw LocationIQ lat/lon | string: `"10.7695084"`, `"106.6907953"` | Same external contract |
| POST /locations/address-search | number: `10.7695084`, `106.6907953` | number: `10.769508`, `106.690795` |
| AddressSearchResult → picker draft | Numeric model; values retained | Numeric model; six-decimal values retained |
| Confirm → form → address-api | No coercion; exact coordinate retained | No coercion; exact normalized coordinate retained |
| Saved Address POST/PATCH | Numeric seven-decimal regression request → 400 | Numeric six-decimal request → 201/200 |
| Numeric strings sent directly to address DTOs | Existing `@Type(() => Number)` coerced them | 400, no coercion |

The UI uses `toFixed(6)`, so visible text can hide excess precision. Previous browser tests selected a search result but then dragged/clicked the map, replacing the original result before Save; they did not cover direct Search → Confirm → Save.

## Change

- `backend/src/modules/locations/address-search.service.ts`: keep normalization at the single provider boundary; check input type, finite value and original geographic range before rounding to the existing six-decimal internal contract. Invalid out-of-range values cannot become valid through rounding.
- `backend/src/modules/addresses/dto/create-address.dto.ts` and `backend/src/modules/pricing/dto/quote-address.dto.ts`: remove existing coordinate coercion. Keep IsNumber/maxDecimalPlaces/Min/Max unchanged. UpdateAddress inherits CreateAddress; Shipment delivery inherits QuoteAddress.
- Expand `address-search.service.spec.ts`, `address-search.controller.spec.ts`, `create-address.dto.spec.ts`, `quote-address.dto.spec.ts` and `frontend/test/address-location/check.mjs`.
- No application frontend changes, scattered coercion, provider/Leaflet/ranking/lifecycle changes or migrations. C01/C16 preserve backend contract and one normalization boundary; C04 ownership and C08 snapshots remain unchanged.

## Verification

- Backend: **85 tests / 7 suites PASS** across provider, HTTP, Saved Address DTO/service, Quote DTO, Shipment service and assignment candidates. After final test-only changes, provider/HTTP suites reran **24/24 PASS**.
- HTTP tests execute the real search service, response interceptor, JWT/role guards and ValidationPipe. Raw external fetch, account limiter, session repository and address persistence are mocked. They check numeric response, numeric POST/PATCH acceptance, string rejection, high-precision rejection and numeric GET reload. This is not database persistence evidence.
- Provider invalid cases cover both axes: `NaN`, `Infinity`, `-Infinity`, malformed text, blanks, null, boolean, array/object and positive/negative just-outside-range values.
- Frontend unit tests: **47 PASS**.
- `node frontend/test/address-location/check.mjs --direct-search`: **PASS** at 375×812, 812×375, 768×1024 and 1440×900. Production-built components select a result and Confirm without map adjustment; numeric draft rendering, confirmed rendering, exact numeric POST/PATCH, reload, Shipment delivery and Quote HTTP payloads pass. APIs are intercepted; tile requests are aborted.
- `node frontend/test/address-location/check.mjs --search`: existing drag/click/confirm regression **PASS**, all four viewports and all three form flows.
- Workspace typecheck, lint, backend/frontend builds and `git diff --check`: **PASS**. Sandbox spawn EPERM required approved reruns for browser and frontend tests; test-only lint errors were corrected.

## Staging status

**Create: NOT VERIFIED. Edit: NOT VERIFIED.** No deployment or authenticated staging smoke was performed. The reported edit failure remains a staging report; the precision root cause is reproduced locally, but the original staging response/request and deployed artifact have not been captured. Need the deployed commit/image and authenticated Network evidence to establish that staging runs this code and to close staging create/edit validation.
