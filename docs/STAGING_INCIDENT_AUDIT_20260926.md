# Staging pricing, address search and auth audit — 2026-09-26

Evidence captured at 2026-09-25 17:41 UTC (2026-09-26 00:41 Asia/Saigon). This is an incomplete live audit, not a staging PASS.

## Pricing

- A read-only transaction against the operator-verified Render staging Neon target (`ep-royal-dust-axv3itmx`, `neondb`) returned **zero PricingConfig rows**. `/api/v1/health/ready` returned **200**, database/Redis up; request ID `07a22eff-7f42-437a-a110-5373a050ae59`.
- `PricingService.getActiveConfigEntity()` throws HTTP 503 with internal code `PRICING_CONFIG_UNAVAILABLE` when there is no active config. Both quote and shipment creation depend on it. The global exception filter masks all 5xx bodies as `INTERNAL_SERVER_ERROR`; a generic browser response does not imply a different cause.
- The supplied Render logs establish successful startup/Live at 17:27:15 UTC, but contain no pricing request failure/stack/request ID. Missing config is verified; correlation to the user's exact failed request awaits its backend error log or authenticated reproduction.
- Canonical seed: `backend/prisma/migrations/20260817150000_phase2_pricing_shipments/migration.sql`. Restore through authenticated ADMIN `POST /api/v1/pricing/config` with `{"baseFee":30000,"includedWeightGrams":1000,"extraWeightFeePerKg":5000,"codFeeBasisPoints":50}`. Existing service activates one version transactionally and writes the audit log; distance/surcharge/discount remain zero.
- **Not executed:** no current Admin credential/session available. No direct DB write, migration replay, frontend patch or pricing policy change. Quote 200 and shipment creation remain unverified.

## Address provider evidence

Direct live LocationIQ request using the available backend-local key and the exact parameters constructed by the current service (not an intercepted staging request):

```json
{
  "q": "123 Nguyễn Trãi, Phường Bến Thành, Hồ Chí Minh, Vietnam",
  "format": "json", "countrycodes": "vn", "limit": "5",
  "addressdetails": "1", "accept-language": "vi",
  "viewbox": "106.644103,10.720000,106.745897,10.820000",
  "bounded": "0"
}
```

Provider **HTTP 200**, exactly one candidate before filtering. No key, credential URL or raw provider exception retained. Local normalized evidence: `test-results/staging-incident-evidence.json` (ignored).

| Field | Value |
| --- | --- |
| Canonical province | Hồ Chí Minh, code `79` |
| Canonical ward | Phường Bến Thành, code `26743` |
| Canonical ward centre | `10.77, 106.695` (approximate, not boundary) |
| Provider place ID | `257000422` |
| Raw coordinate | `10.7695084, 106.6907953` |
| Normalized coordinate (six decimals) | `10.769508, 106.690795` |
| House / road | `123` / `Đường Nguyễn Trãi` |
| neighbourhood | `Khu phố 3` |
| suburb | `Phường Bến Thành` |
| city | `Thành phố Thủ Đức` |
| state / province | Absent |
| country / country_code | `Việt Nam` / `vn` |
| display_name | `123, Đường Nguyễn Trãi, Khu phố 3, Phường Bến Thành, Thành phố Thủ Đức, Thành phố Hồ Chí Minh, 70200, Việt Nam` |

Current matcher rejects this candidate. The first rejection is the municipality check: city matches neither the selected province nor ward and is not a district label. Independent additional blockers are absent structured province proof and contradictory `Thành phố Thủ Đức` in the display hierarchy. Country and coordinates pass structural validation; suburb matches the selected ward.

This evidence is contradictory provider hierarchy, not proof of a legitimate canonical-to-legacy administrative relationship. No polygon or legacy crosswalk exists in the shared catalogue. The nearby ward centre and tiny provider house bounding box do not prove administrative containment. No matcher relaxation has been made, preserving the explicit requirement to reject Thủ Đức hierarchy.

Actual staging `/locations/address-search` HTTP status/raw upstream request: **NOT OBSERVED**, pending authenticated browser/API access. The direct provider response must not be reported as that endpoint's status. Wrong ward/province and Thủ Đức rejection, selectable valid result and manual fallback have local regression coverage, but **live staging cases are NOT VERIFIED**.

## Auth

- Read-only DB inspection found five active users (one each ADMIN/CUSTOMER/DRIVER/DISPATCHER/WAREHOUSE_STAFF), 21 AuthSession rows. Counts alone establish neither validity of a particular browser cookie nor successful refresh.
- No staging tab was available on CDP 9222 (only Lenovo Vantage); 9223–9226 were unavailable. No current browser network history was inspected.
- `AuthProvider` attempts refresh on mount; missing/expired/revoked sessions can legitimately produce a bootstrap 401. Login 401 has its own credential validation path. Neither can be labeled stale from the provided startup logs.
- **UNRESOLVED:** whether the screenshot's login/refresh failures are old or affect the user's current session. Kept separate from verified missing pricing data; no token fabrication, password reset, session deletion or auth bypass.

## Validation and remaining access

- Backend focused service/controller/auth/pricing/shipment regressions: **70/70 PASS**.
- Frontend tests: **51/51 PASS** after approved retry of sandbox `spawn EPERM`.
- These tests use local fixtures/mocks; they do not establish live quote/create/search/session success.
- Need authenticated Admin/Customer access and the pricing request error log to finish exact-request correlation, Admin API restoration and live verification. User was asked separately about treatment of the observed contradictory Thủ Đức label; no override has been assumed.
- Invariants retained: C01/C04 authorization/ownership, C08 consistency, C16 backend authority. Only audit documentation changed; no application behavior or business data changed.
