# Admin Pricing bootstrap — 2026-09-26

## Root cause and change

Missing active pricing already raised `PRICING_CONFIG_UNAVAILABLE` at HTTP 503. The global exception filter discarded every 5xx code/message, so Admin received `INTERNAL_SERVER_ERROR`. The page rendered its form only after a successful config read; the first config could not be created through that page.

The pricing service now throws a dedicated `PricingConfigUnavailableException`. The filter exposes only this known exception's fixed public code/message, preserving 503. Arbitrary 503/500 exceptions remain redacted, even if their payload claims the same pricing code. Swagger documents the missing-config response on GET config and POST quote.

The Admin page recognizes exactly HTTP 503 + `PRICING_CONFIG_UNAVAILABLE`:

- Before: generic server error with no way to create the first config.
- After: “Chưa có cấu hình giá vận chuyển”, explanation of blocked quote/shipment creation, and “Tạo cấu hình giá”.
- CTA opens an editable draft: base 30,000 VND; included weight 1,000 g; excess 5,000 VND/kg; COD 50 basis points (0.5%). These are the approved Phase 2 migration values, used only as form prefills. Distance/surcharge/discount remain fixed at zero under the existing backend rule.
- Only “Lưu và kích hoạt” sends POST. Cancel, loading the page, CTA and reload never seed data.
- True load failures display “Không thể tải cấu hình giá” with retry. Other 503 codes, 500 with the pricing code, and network failures do not become bootstrap states.
- Existing form/current-version layout is retained. Inline Vietnamese validation, initial field focus, disabled pending save and success feedback are included. Validation updates on change to avoid removing an error on blur and shifting the Save button during a click.

## API and invariants

Customer quote and create-shipment still fail at HTTP 503 until an active config exists; there is no quote fallback or formula change. Backend transaction, Admin-only create, integer money, versioning, single-active constraint and `PRICING_CONFIG_ACTIVATE` audit remain authoritative. Historical config/shipment pricing is unchanged. No schema, migration, dependency, auto-seeding or staging business write.

## Verification

| Check | Result |
| --- | --- |
| Backend unit regressions | 53 suites / 382 tests PASS |
| Frontend unit regressions | 51 tests PASS |
| Real PostgreSQL integration | PASS: config count 0 → GET/quote/create 503 with specific code; no write; Customer create-config 403; invalid Admin input 400; Admin creates active v1; GET reload matches; quote 200 with 35,501 VND; shipment 201; exact Admin/version/policy audit |
| Inactive-only history | PASS: GET 503, Admin creates v2, two historical rows, one active, two activation audits |
| Browser page integration | PASS at 375×812, 812×375, 768×1024, 1440×900: loading, bootstrap copy, CTA defaults/no POST, focus, inline errors, pending save, mutation failure/retry, success, active config, reload/no extra POST, no horizontal overflow or page exceptions |
| True error classification | PASS: network, generic 503, and 500 carrying pricing code remain retryable error states |
| Workspace lint / typecheck / build / diff check | PASS; existing large frontend chunk warning remains |
| Staging deployment / authenticated smoke | NOT VERIFIED: changes are local; deployment/session access unavailable |

PostgreSQL used a newly created disposable localhost database `pricing_bootstrap_1790359060032`; migrations were replayed only there. Integration uses the real Nest API, auth guards, pricing/shipment services and PostgreSQL. Redis is mocked. Browser tests intercept HTTP and therefore prove UI behavior, not live persistence; the separate PostgreSQL test supplies persistence evidence. Sandbox process restrictions required approved external execution. Browser initially caught the blur/click validation issue, fixed and rerun successfully; initial test typing lint failures were corrected.

Reproduce browser checks: `node frontend/test/address-location/pricing.mjs`.

Reproduce integration against a **new, migrated, unused localhost** `pricing_bootstrap_<timestamp>` database, with `DATABASE_URL`/`DIRECT_URL` pointing only there:

```sh
npm run test:e2e --workspace backend -- --testRegex 'pricing-bootstrap.integration-spec.ts$' --runTestsByPath test/pricing-bootstrap.integration-spec.ts
```

The integration refuses non-localhost/nonmatching database names and checks that User/Shipment are empty before removing the migration pricing seed. It is deliberately separate from shared-database E2E suites. Test records remain in the disposable database for inspection.

Changed application files: pricing exception/service/controller, global exception filter, Pricing API error classifier and Pricing page. Regression files: exception-filter tests, isolated pricing integration test, browser fixture/runner. Screenshots/logs under ignored `test-results/pricing-bootstrap/` and `test-results/pricing-unit.log`.
