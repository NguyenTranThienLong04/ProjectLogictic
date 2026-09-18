# STACK — Tech, Structure, DB, API, Security

## FIXED STACK

**Frontend**: React, TypeScript, Vite, Tailwind, React Router, TanStack Query, Axios, React Hook Form, Zod, Socket.io Client, Recharts, Leaflet (map provider abstraction). Không dùng Next.js, không đổi framework.

**Backend**: NestJS, TypeScript, REST API, Prisma ORM, PostgreSQL, JWT, Socket.io, Redis, BullMQ, Swagger/OpenAPI. Modular Monolith — không microservices.

**Database**: PostgreSQL (Neon hosted) qua Prisma. Env: `DATABASE_URL`, `DIRECT_URL`. Cấm MongoDB/Mongoose/Firestore.

**Redis** (không phải primary DB): cache, rate limiting, driver current location, BullMQ, temp state, distributed lock khi cần. Dev = Docker Redis, Prod = managed provider.

**File Storage**: qua `StorageService` abstraction (Cloudinary hoặc S3-compatible). Không lưu binary trực tiếp trong PostgreSQL.

---

## BACKEND STRUCTURE
```
backend/src/
  common/ config/ database/
  modules/
    auth/ users/ addresses/ shipments/ pricing/ tracking/ audit/
    drivers/ assignments/ warehouses/ transfers/ delivery/ cod/
    notifications/ files/ analytics/ routing/
```

## FRONTEND STRUCTURE
```
frontend/src/
  app/ router/
  features/
    auth/ customer/ shipments/ tracking/ driver/ warehouse/
    dispatcher/ admin/ notifications/
  components/ layouts/ hooks/ services/ types/ utils/
```
Không dồn business code vào components.

---

## DATABASE RULES
Prisma migration bắt buộc, không sửa production DB thủ công để né migration.

Index tối thiểu:
```
User.email UNIQUE
DriverProfile.employeeCode UNIQUE
Shipment.trackingCode UNIQUE
Shipment(customerId, createdAt)
Shipment(status, createdAt)
Shipment(currentWarehouseId, status)
DriverAssignment(driverId, status)
TrackingEvent(shipmentId, createdAt)
Notification(userId, readAt, createdAt)
```
Index bổ sung phải dựa trên query thực tế.

## TRANSACTION RULES
Dùng Prisma transaction khi 1 business command phải all-or-nothing (vd `completeDelivery` = validate + DeliveryAttempt + update Shipment + TrackingEvent + CODTransaction state + AuditLog trong 1 transaction). External side-effect (email...) KHÔNG nằm trong DB transaction.

---

## API RULES
Prefix `/api/v1`. Response: `{ "data": {}, "meta": {} }`. Business error: `{ statusCode, code (machine-readable), message }`.

## PAGINATION / FILTER
List lớn bắt buộc pagination: `page, limit, search, status, fromDate, toDate` (+ `driverId, warehouseId, customerId` cho staff). Backend giới hạn max `limit`.

## AUTH
register/login/logout, access + refresh token, forgot/reset password. Password hashed. Refresh token có revoke strategy. Không log token/password.

## SECURITY (minimum)
ValidationPipe, Helmet, CORS, rate limiting, password hashing, JWT guards, RBAC, ownership checks, file validation, env secrets. `.env` không commit, có `.env.example`.

## REDIS — allowed use
```
location · cache · rate limiting · BullMQ · temporary lock
```
Memory fallback chỉ chính xác khi chạy single instance. Khi scale ngang nhiều instance, cần rate limit tập trung qua Redis bắt buộc (không fallback) hoặc dùng sticky session — đánh giá lại ở Phase 11 khi quyết định chiến lược deploy.

Cache key vd: `tracking:{trackingCode}`, `shipment:{id}:summary`. Mutation shipment phải invalidate cache liên quan. Không cache response nhạy cảm sai user scope.

Route cache G3B1 dùng key `route:{provider}:road_route:{roundedOrigin}:{roundedDestination}`, tọa độ làm tròn 4 chữ số thập phân và TTL mặc định 900 giây. Cache miss/read failure chỉ gọi provider hoặc fallback; Redis không giữ planned Trip snapshot.

## ADDRESS GEOCODING (2026-09-19)

- Separate from routing: `POST /api/v1/locations/address-search`, authenticated CUSTOMER, existing JWT/role guards and per-client throttle (10/minute). Structured trimmed/length-bounded street/ward/district/city; fixed upstream `https://us1.locationiq.com/v1/search`, native fetch, 5-second timeout, no redirects, `countrycodes=vn`, `limit=5`, `addressdetails=1`, Vietnamese language. Backend also filters non-VN and malformed/non-finite/out-of-range results and returns only normalized fields. Provider exceptions/body/credential URLs never reach logs or clients. Existing exception filter sanitizes 503 responses; upstream/local quota errors return 429.
- `LOCATIONIQ_API_KEY` is optional, backend-only and format-validated; blank disables search with 503 while manual picker remains usable. No VITE key, schema/migration, new dependency or business mutation. C01/C04/C08/C16 preserved.
- Reuses existing Redis-backed throttler for account-wide 2/second, 60/minute, 5,000/day windows before upstream fetch. Existing local outage fallback supports the documented single backend instance; multi-instance Redis outage and other applications sharing the same key can exceed the account budget. Provider 429 remains handled. No result cache is introduced, so search does not depend on Redis cache availability.
- Terms verified 2026-09-19: [Free pricing/attribution](https://locationiq.com/pricing), [search contract](https://docs.locationiq.com/docs/search-forward-geocoding), [storage/caching](https://help.locationiq.com/support/solutions/articles/36000216111-can-i-save-addresses-from-api-output-). Free permits limited commercial use with a prominent LocationIQ link, persistent output storage, and request-response caching up to 48 hours. Geocoding is a suggestion: street/house-level coverage is not guaranteed, and new administrative names may not match upstream data. Local dataset stays authoritative; user must confirm the pin.

## ROUTE PROVIDER (G3B1)

- Backend abstraction: `RouteProvider` + resilient `RouteMetricsService`; business modules không chứa Google/Mapbox/OSRM-specific parsing.
- Runtime dùng native `fetch`, timeout mặc định 2.5 giây, batch concurrency 4 và tối đa 20 external attempts mỗi candidate response. Không thêm dependency.
- `ROUTE_PROVIDER=DISABLED|OSRM`; mặc định `DISABLED`. OSRM adapter chỉ được opt-in ở development bằng `ROUTE_PROVIDER_BASE_URL`; URL chứa credential/query bị reject. Production validation bắt buộc `DISABLED` cho tới khi provider canonical/credential/license/attribution được duyệt.
- External errors không trả raw upstream body/URL/secret và không làm candidate/trip READY trả 500 khi Haversine fallback khả dụng.

### Geometry/deviation/reroute extension (G3B2)

- Contract provider vẫn là một stack duy nhất và thêm optional normalized geometry `{ points: [{ latitude, longitude }] }`. OSRM development adapter yêu cầu GeoJSON, normalize `[lng, lat]`, dùng simplified overview và chặn geometry ngoài 2–2.000 điểm qua `ROUTE_GEOMETRY_MAX_POINTS=2000`.
- Redis cache metric-only và geometry dùng key mode riêng để response G3B1 không vô tình được xem là geometry. Route geometry/history/current pointer là PostgreSQL source of truth; Redis chỉ giữ cache provider và operational deviation state.
- `LineHaulTripRoute` lưu planned v1/reroute v2+ với unique trip/version và một planned partial-unique index. `LineHaulTrip.currentRouteId` là nullable/additive và trỏ đúng route version authoritative; không có public endpoint nhận arbitrary origin/destination.
- Config deviation canonical: `LINE_HAUL_ROUTE_DEVIATION_METERS=500`, `LINE_HAUL_ROUTE_DEVIATION_CONSECUTIVE_SAMPLES=3`. Socket route update dùng invalidation thay vì gửi geometry lớn.
- Reroute external call không giữ PostgreSQL lock. Short commit transaction revalidate status/version/destination/current route và dùng conditional update; provider failure/timeout trả unavailable, không ghi version và không thay current route.

## LINE-HAUL CAPACITY (G3C1)

- PostgreSQL tiếp tục lưu weight/capacity bằng `Int` grams. Migration additive `20260906100000_phase_g3c1_line_haul_capacity` chỉ thêm nullable READY snapshots và pair/check constraint; không backfill capacity hư cấu cho Fleet legacy.
- `line-haul-capacity.ts` là source duy nhất cho package snapshot weight resolution, active-manifest aggregation và overload validation. Percent được tính ở response boundary để display, không tham gia mutation decision.
- Add/remove/READY/dispatch dùng interactive transaction + `SELECT ... FOR UPDATE` trên `LineHaulTrip`; Fleet capacity update khóa active trip trước rồi vehicle, requery ownership/load và dùng versioned conditional update. Lock order thống nhất ngăn lost update/deadlock và không phụ thuộc frontend disable.
- API chỉ mở rộng Fleet commands, trip detail/manifest và eligible-resource responses; không có generic capacity mutation hoặc public arbitrary-load calculation endpoint.

## BULLMQ
Queues: `email · notification · analytics`. Job phải retryable, idempotent, logged, an toàn khỏi duplicate side-effect. HTTP request không chờ email gửi xong.

## SHIPPING FEE PAYMENT PROVIDER (H3)

- Backend dùng `PaymentProvider` contract và `PaymentGatewayService`; shipping-fee business service chỉ nhận normalized create/webhook result, không chứa vendor-specific parsing.
- `PAYMENT_PROVIDER=DISABLED|TEST`, mặc định `DISABLED`. Production validation bắt buộc `DISABLED` cho đến khi canonical vendor, credential storage, billing/compliance và go-live được duyệt. `TEST` chỉ chạy development/test với HMAC secret test-only tối thiểu 32 ký tự.
- Nest giữ raw request body cho webhook signature verification. Adapter verify trước khi business service dùng payload; browser return chỉ là GET read model.
- Native provider call có `AbortController` timeout tối đa 15 giây và idempotency key là merchant reference. External call nằm ngoài PostgreSQL transaction; database commit ngắn dùng row lock, unique/partial indexes và append-only normalized event.
- API/DB không lưu card/payment secret hoặc raw provider payload; response Customer/Dispatcher/Admin không expose provider reference/signature/raw data. H3 không thêm dependency, wallet, invoice hoặc refund.
