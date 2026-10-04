# Delivery coordinate fix và chuẩn bị canonical Line-haul — 2026-10-04

Tiếp nối `LOGISTICS_INTEGRATION_AUDIT_20261004.md`. Product changes và kiểm thử chỉ local. Không deploy/enforce staging, reset/seed staging, backfill/geocode lại địa chỉ hoặc sửa lịch sử. Không thêm dependency, schema hay migration.

## A. Coordinate fix

**Root cause:** schema Shipment trước đây chỉ kiểm tra lat/lng có đủ cặp; serializer dùng fingerprint để bỏ cặp stale nhưng vẫn trả địa chỉ. Sau Confirm A → sửa street/ward/province thành B, form vẫn đủ điều kiện tính lại phí/tạo Shipment thiếu tọa độ.

**Invariant:** coordinate chỉ dùng khi finite, đủ cặp, trong range và đã Confirm cho fingerprint địa chỉ giao hiện tại. Fingerprint dùng source hiện có `address-location-model.ts`: street/ward/district/city, NFC/trim/case/whitespace normalization. Contact/phone không làm stale.

- `shipmentFormSchema` thêm validation confirmation; `deliverySnapshot()` fail closed nếu stale/missing. Nút Create cũng disabled; picker có nhãn bắt buộc và hướng dẫn xác nhận lại. Không chỉ dựa vào disabled button.
- Confirm lại ghi cặp tọa độ và fingerprint mới; tính lại phí rồi Create gửi cặp mới. Search/current-location/manual pin vẫn dùng chung picker; chỉ Confirm ghi vào form.
- Quote độc lập dùng `quoteFormSchema` và giữ tọa độ optional; không vô tình bắt user đặt pin chỉ để báo giá.
- Backend API compatibility không đổi: supplied coordinate phải qua DTO validation và được copy vào snapshot bất biến. API không nhận một fingerprint UI như bằng chứng vị trí địa lý. Historical null/older API coordinate omission vẫn được hỗ trợ theo yêu cầu compatibility; đây không phải server-side proof-of-confirmation protocol mới.

Ví dụ payload (minh họa, không phải request gốc của shipment staging):

```jsonc
// Trước: Confirm A → sửa street B → vẫn có thể POST
{"deliveryAddress":{"streetAddress":"126 Nguyễn Trãi","ward":"Bến Thành","city":"Hồ Chí Minh","district":""}}

// Sau: cùng thao tác → validation fail, không POST Shipment.
// Confirm lại B → payload có cặp mới
{"deliveryAddress":{"streetAddress":"126 Nguyễn Trãi","ward":"Bến Thành","city":"Hồ Chí Minh","district":"","latitude":10.769508,"longitude":106.690795}}
```

Tên/số điện thoại và các field Shipment khác được lược khỏi ví dụ. Không gửi fingerprint ra API; không gán tọa độ minh họa vào dữ liệu thật.

**Driver map:** không đổi geocode/GPS logic. Sau start delivery, owned API vẫn đọc receiver target từ `deliverySnapshot`; trước start vẫn là destination Warehouse đúng policy cũ. Marker Driver/current Redis GPS và receiver là hai marker khác nhau; reload refetch snapshot giữ marker đích, mất GPS chỉ ẩn Driver. Legacy null giữ fallback địa chỉ, không dựng tọa độ. Shipment staging đã null không được sửa bởi task này.

| Yêu cầu test | Bằng chứng |
|---|---|
| Confirm → submit ngay có lat/lng | `address-location.test.mjs`, serializer/schema |
| Sửa street sau Confirm chặn submit | Unit + browser HTTP captured, zero Shipment POST |
| Sửa ward/province/district | Unit đủ 4 field; browser street/ward/province |
| Confirm lại → cặp mới | Unit + browser Shipment payload |
| Saved address có coordinate → snapshot giữ nguyên | `shipments.service.spec.ts`; PostgreSQL `phase2.e2e-spec.ts`, sửa saved address qua API sau create không đổi pickup snapshot |
| Delivery coordinate persist | PostgreSQL `phase2.e2e-spec.ts` kiểm `deliverySnapshot` |
| Driver destination marker + hai marker riêng | `delivery.service.spec.ts`, `driver-task-map.test.mjs`, Chromium real components |
| Reload vẫn có đích từ snapshot | Owned backend read regression + browser refetch/reload |
| Legacy null fallback | Backend read + browser; không geocode, không substitute GPS |

Browser HTTP/provider/tiles được mock; không gọi đó là staging hoặc hành trình browser → DB → Driver thực tế. PostgreSQL integration chứng minh persistence riêng, backend owned read test dùng repository mock.

## B. Canonical Line-haul

Reuse `WarehouseTransfer ↔ LineHaulTripTransfer ↔ LineHaulTrip ↔ Driver/Vehicle`, existing manifest, schedule, capacity, GPS và dedicated commands. Không có module/table Manifest mới.

```text
Warehouse A tạo Transfer PENDING (hàng còn ở kho)
→ Dispatcher/Admin tạo Trip PLANNED với Driver + Vehicle và route A → B
→ attach Transfer vào manifest + scheduleStart/end
→ prepare READY (khóa manifest, snapshot tải/capacity)
→ dispatch Trip
  → Trip/Transfer/Shipment IN_TRANSIT, Vehicle IN_USE, currentWarehouseId=null
→ Driver chủ trip publish GPS qua API → Redis → Socket
→ Admin hoặc Warehouse B xác nhận Trip ARRIVED, Vehicle AVAILABLE
→ Warehouse B receive từng Transfer → COMPLETED; Shipment AT_DESTINATION_WAREHOUSE
```

Trip hiện bắt buộc Driver/Vehicle từ lúc create; không tạo trip thiếu tài nguyên để mô phỏng thứ tự UI. Terminal Trip vẫn `ARRIVED`, Transfer mới `COMPLETED`.

**Enforcement:** một config backend `LINE_HAUL_ENFORCEMENT_FROM`, default `''`:

| Config/thời điểm | Departure standalone mới | Receive standalone |
|---|---|---|
| Trống | Compatibility hiện có | Cho phép theo scope/lifecycle hiện có |
| Trước mốc cấu hình | Compatibility | Cho phép, audited |
| Từ đúng mốc trở đi | 409 `LINE_HAUL_TRIP_REQUIRED`, kể cả PENDING tạo trước cutover | Chỉ `dispatchedAt < cutover` |
| Đã COMPLETED/đã dispatch, retry command | Trả state đã commit theo idempotency | Không ghi thêm audit/tracking |

Mốc bắt buộc UTC ISO rõ ràng (seconds, tùy chọn milliseconds), không boolean/local-date-only. Config invalid làm startup fail; không tự lấy giờ restart. Trip-linked receive luôn kiểm exact route + `ARRIVED`, trong cả compatibility và strict. Timestamp null hoặc departure từ cutover trở đi không được giả làm legacy.

**Legacy audit:** giữ transfer cũ và dispatchedBy/At, không tạo Trip/Driver giả. Receipt mới append `metadata.flow=LEGACY_STANDALONE`, `enforcementFrom`, `dispatchedAt`. Standalone trong compatibility được nhận diện `COMPATIBILITY_STANDALONE`. Audit cũ không bị backfill/rewrite.

**Validation:** `assertExecutionReady` hiện có vẫn revalidate role/status/capability Driver, Vehicle AVAILABLE/positive capacity, schedule + reservation conflict, last-mile ownership, hai kho active, manifest không rỗng, exact route, Shipment tại origin và integer weight dưới execution locks. Trip dispatch atomic với toàn bộ manifest, version guards và history. Missing Driver/Vehicle bị DTO/required FK chặn ngay trước khi có trip; không cần thêm rule song song.

**Warehouse UX:** response scoped bổ sung `workflow` và summary Trip gồm scheduledStartAt, vehicleCode/plate, Driver employeeCode/fullName. UI lấy khả năng dispatch/receive từ backend. Strict PENDING chưa có trip hiển thị “Đang chờ điều phối chuyến trung chuyển” / “Chờ xếp chuyến”; không có nút Dispatch standalone. Có trip thì xem trip/resources/status/schedule. Destination chờ arrival; legacy hợp lệ vẫn có nút nhận. Backend phải deploy trước frontend mới; thiếu `workflow` không tự suy diễn quyền thao tác. Command lỗi refetch response authoritative. Hai bảng transfer dùng chế độ `DataTable wide` có sẵn: card tới breakpoint desktop và scroll trong vùng bảng; regression phát hiện và đã sửa overflow ở 768 px khi thêm summary chuyến.

## C. Resources và rollout staging (chưa thực hiện)

Audit đầu vào ghi nhận 0 Trip, 0 Vehicle, 0 LINE_HAUL Driver và một standalone IN_TRANSIT. Đây là kết quả audit trước task, không phải một lần đọc staging mới. Không bật strict trong trạng thái đó.

| Resource cần chuẩn bị | Workflow hiện có / điều kiện |
|---|---|
| Ít nhất một Vehicle | Admin `/admin/line-haul/vehicles`; `POST /api/v1/line-haul/vehicles` với vehicleCode, licensePlate, vehicleType, positive capacityWeightGrams đủ manifest. AVAILABLE; không conflict window |
| Ít nhất một Driver LINE_HAUL | Active User role DRIVER + DriverProfile không SUSPENDED; Admin Drivers / `PATCH /api/v1/drivers/:id/capabilities` bật LINE_HAUL, giữ capability khác nếu cần. Không active last-mile hoặc READY/IN_TRANSIT trip xung đột |
| Route/trip A → B | Hai Warehouse active khác nhau; không có route entity mới cần seed. Admin/Dispatcher tạo trip bằng `/line-haul/trips`, assign transfer qua `/:id/transfers`, schedule bằng `/:id/schedule` với expectedVersion và UTC start/end không overlap |
| Manifest | Transfer PENDING đúng A → B, Shipment ở A và sorting destination B; capacity đủ tải verifiedWeightGrams (fallback legacy snapshot weightGrams) |
| Staff A và B | Mỗi kho có User ACTIVE/WAREHOUSE_STAFF + profile isActive đúng warehouse; dùng Admin Warehouse staff workflow/API. Origin tạo/check-in/sort; destination arrive/receive |
| Người điều phối | Active Admin/Dispatcher dùng workspace hiện có để create/schedule/prepare/dispatch; Driver publish GPS đúng trip; Dispatcher không giả làm staff xác nhận arrival |

Readiness check chỉ đọc đã thêm: `backend/scripts/check-line-haul-readiness.mjs`. Build backend trước; cấp `READINESS_DATABASE_URL` qua môi trường bí mật, không đặt connection string trong command/log. Nó không tự load `.env`, không migration/seed/update; transaction `REPEATABLE READ READ ONLY`.

```text
node backend/scripts/check-line-haul-readiness.mjs <origin UUID> <destination UUID> <UTC window start> <UTC window end> [completed smoke trip UUID]
```

Script kiểm kho/staff, manager, eligible Driver/Vehicle theo window dùng policy hiện có, liệt kê pending routes và standalone IN_TRANSIT, kiểm smoke Trip cùng route đã ARRIVED/có schedule/READY capacity snapshots và tất cả active transfer COMPLETED. Exit 2 khi thiếu, exit 1 khi lỗi truy vấn. Exit 0 chỉ chứng minh các database checks: GPS transient phải có evidence smoke riêng, mọi tuyến vận hành cần được kiểm tra; không phải lệnh enable/deploy.

1. **Stage 1 (task này):** code + unit/PostgreSQL/browser tests local.
2. **Stage 2 (sau khi được deploy):** backend trước rồi frontend, `LINE_HAUL_ENFORCEMENT_FROM` trống; kiểm compatibility và legacy receipt. Release gates chung vẫn áp dụng.
3. **Stage 3:** tạo/cấu hình resources qua Admin UI/API hợp lệ. Không seed/reset staging.
4. **Stage 4:** smoke Transfer A → B qua Trip thật, Driver GPS, arrival và destination receive. Chạy readiness đúng route/window, truyền smoke trip UUID. Kiểm mọi route đang có việc, không chỉ một cặp kho.
5. **Stage 5:** mới chọn một mốc UTC ổn định sau các departure compatibility; drain request standalone và cấu hình giống nhau trên mọi API instance. Kiểm 409 standalone mới, trip departure đúng, legacy receive còn hoạt động. Không đổi mốc theo restart; rollback không được làm mất nhận diện departures đã hợp lệ. Nếu phải cho standalone phát sinh trong rollback, phải lập lại kế hoạch cutover/readiness có audit, không dịch mốc âm thầm.

## D. Files changed và rules

- Coordinate/UI: `frontend/src/features/shipments/{shipment-form.ts,shipment-form-fields.tsx,create-shipment-page.tsx}`, `frontend/src/features/pricing/quote-page.tsx`.
- Transfer backend: `backend/src/config/{line-haul-enforcement.ts,env.validation.ts}`, `backend/src/modules/warehouses/{warehouse-transfer-flow.policy.ts,warehouse-transfer-lifecycle.service.ts,warehouse.response.ts,warehouses.service.ts,warehouses.module.ts,warehouses.controller.ts}`, `.env.example`.
- Warehouse UI: `frontend/src/features/warehouses/{warehouse-types.ts,transfer-trip-summary.tsx,pages/warehouse-workspace-page.tsx}`.
- Readiness: `backend/scripts/check-line-haul-readiness.mjs`.
- Regressions: new transfer policy/lifecycle specs; updated warehouses/delivery specs; `backend/test/{phase-g2,phase2}.e2e-spec.ts`; `frontend/test/{address-location.test.mjs,shipping-fee-payer.test.mjs,address-location/check.mjs,ui-flow/canonical-flow.mjs}`.
- Docs: `docs/{DOMAIN,UI,TESTING}.md`, báo cáo này và `PROJECT_STATE.md`. Audit đầu vào và thay đổi PROJECT_STATE có trước task được giữ lại.

C01/C02/C03: source-of-truth và dedicated state transitions; C04: warehouse/Driver ownership; C05/C06: append-only audit khác tracking; C08: immutable coordinate/capacity snapshots; C09/C10: retry/transaction/locks; C11/C12: API reload và disposable GPS; C14/C15/C16: thin controller/safe response/reuse policy; C18: regressions. Không đổi COD/fee/ranking/provider.

## E. Verification và deployment verdict

| Check | Kết quả local |
|---|---|
| Backend unit | 508/508, 59 suites PASS |
| Frontend unit | 70/70 PASS |
| PostgreSQL G2 + Phase2 (final rerun) | 12/12, 2 suites PASS; strict path + legacy concurrent receipt + coordinate persistence |
| PostgreSQL/Redis/Socket G3A | 4/4 PASS trong lượt 15/15 trước khi bổ sung legacy test; product GPS/trip execution không đổi |
| Chromium address search/form | PASS; saved address/warehouse bốn viewport; Create/Quote stale/reconfirm HTTP regression tại 375/768/1440 px |
| Chromium Warehouse/Driver | PASS 375/768/1440; strict/compatibility, arrival/legacy, two markers/reload/fallback |
| Readiness script | Local empty-resource DB: expected exit 2/BLOCKED, no enforcement write |
| Workspace lint/typecheck/build; git diff --check | PASS |

Test DB cô lập ở `127.0.0.1:55432`, Redis audit ở `127.0.0.1:56379`; existing schema được dựng vào database test mới bằng runner sẵn có. Không chạy migration trên staging hay tạo SQL migration mới. Docker local được khởi động để kiểm thử. Browser/API/provider fixtures không đại diện geocoding accuracy hoặc authenticated staging smoke. Node thực thi Windows là v24.13.1; chưa có hosted Node 22/Linux CI cho tree này. Build báo provenance SHA `unknown` và cảnh báo chunk-size có sẵn; không suy ra Live SHA.

| Deployment question | Verdict |
|---|---|
| Migration required | **NO** |
| Safe to deploy compatibility code | **YES trong phạm vi thay đổi này**, config trống, backend trước frontend. Không phải release approval tổng thể; hosted CI/Live identity/email gates từ PROJECT_STATE chưa được đóng bởi task này |
| Safe to enable strict Line-haul on staging now | **NO** — resources/readiness/real Trip GPS smoke chưa thực hiện |
| Staging deployed/enforced by this task | **NO** |

Không sửa shipment staging null coordinate đã tồn tại. Không lấy GPS Driver làm destination. Không tuyên bố request gốc/owned Driver staging của audit đã được tái dựng; regression fix dựa trên bug đã tái hiện trong source/form.
