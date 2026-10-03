# Ba lỗi UI/flow — 2026-10-03

Đã sửa đúng phạm vi transfer, notification Driver và dimension check-in. Không migration, reset/seed staging, thay lịch sử hoặc triển khai. Skill áp dụng: `.agents/skills/ui-ux-pro-max/SKILL.md` (form validation, deep linking và async feedback).

## 1. Warehouse transfer

**Root cause đã tái hiện:** modal lưu nguyên object shipment từ inventory bằng `useState`. Sau đổi kho đích, `routeDestinationMutation.onSuccess` đóng modal sorting trước khi inventory refetch xong; nút tạo transfer vẫn có thể mở object cũ. Refetch của danh sách không cập nhật object đã giữ trong modal. Thay đổi ở phiên khác cũng gây cùng lỗi. UI đọc label từ `destinationWarehouse`, payload đọc `destinationWarehouseId`, nhưng cả hai có thể đã cũ so với PostgreSQL. Không tìm thấy mapping đảo source/destination hoặc đổi ID trong API client.

**Trace:** inventory → `openTransferModal` → `createTransfer` → `POST /warehouses/:warehouseId/transfers` → `WarehousesService.createTransfer` → so sánh `shipment.destinationWarehouseId !== dto.toWarehouseId` → HTTP 409 `TRANSFER_DESTINATION_MISMATCH`. Payload transfer thực tế tên **`toWarehouseId`**; `destinationWarehouseId` là field của shipment và command sorting.

**Bằng chứng shipment thật, chỉ đọc DB:** `SHP-20261003-8F291E64` / `7e41b45c-56f2-4d1a-89b0-3a18e24ed5c6` hiện `DELIVERED`, version 12; origin/current/destination cùng `94e6ee6d-3627-4bdb-b479-d73a0e13801c` — `SG01`, Kho hiệp bình chánh, đang hoạt động. Không có WarehouseTransfer. Audit ngày 03/10 theo giờ Việt Nam:

| Thời điểm | Destination sau sorting |
|---|---|
| 15:27:45 | `4658712e-ae22-472b-b78f-eb9c8f057376` |
| 15:28:38 | `df04d1f9-fdfe-4d0e-9887-937ba947bd36` |
| 15:29:21 | `4658712e-ae22-472b-b78f-eb9c8f057376` |
| 15:29:44 | `94e6ee6d-3627-4bdb-b479-d73a0e13801c`, sẵn sàng giao nội kho |

Không có HAR/log request bị reject trong phiên staging gốc, vì vậy **chưa xác minh được chính xác `toWarehouseId` của request lỗi gốc**. Audit chứng minh nhiều lần đổi đích; browser regression tái hiện cơ chế stale với payload đích A trong khi dữ liệu API hiện tại là B. Không kết luận snapshot hiện tại là trạng thái lúc lỗi xảy ra.

**Trước → sau:** object cũ và submit thẳng → modal giữ định danh, đọc lại inventory theo tracking code/ID và active transfer từ API hiện có; kiểm tra lại trước POST. Khi đích đổi, hiển thị đích mới và yêu cầu xem lại bằng lần bấm tiếp theo. Thiếu sorting, sai trạng thái/vị trí, kho ngừng hoạt động, relation/ID không khớp, active transfer hoặc lỗi tải đều chặn tạo kèm lý do. Refetch sau 409 và chuyển riêng lỗi mismatch thành hướng dẫn tiếng Việt. Label và payload lấy cùng shipment vừa đọc; idempotency key vẫn được giữ khi retry.

**Files:**

- `frontend/src/features/warehouses/pages/warehouse-workspace-page.tsx`
- `frontend/src/features/warehouses/transfer-form.ts`
- `frontend/src/features/warehouses/warehouse-types.ts`
- `backend/src/modules/warehouses/warehouse.response.ts`

**API/compatibility:** không đổi endpoint, request DTO hay rule transfer. Response warehouse shipment bổ sung `destinationWarehouse.isActive`; frontend chấp nhận thiếu field để tương thích backend cũ. Không schema/migration. Backend vẫn quyết định ownership, transition và matching đích.

## 2. Notification Driver

**Root cause:** dropdown chỉ gọi mark-read; trang danh sách chỉ có nút đánh dấu đã đọc. Không có route mapping dù backend đã lưu `type`, `data.assignmentId`, `data.shipmentId`. Hai type chính là `PICKUP_ASSIGNMENT_CREATED` và `DELIVERY_ASSIGNMENT_CREATED`; task type được suy từ type notification, không từ title hoặc shipment status.

**Trước → sau:** click chỉ đổi trạng thái đọc → mark-read thành công rồi mở `/driver/pickups/:assignmentId` hoặc `/driver/deliveries/:assignmentId`. Notification đã đọc vẫn mở được, không PATCH lần nữa. Thiếu/sai định dạng assignment ID về danh sách pickup/delivery; notification chung về danh sách pickup. Dropdown đóng khi mở task hoặc “Xem tất cả”; trang thông báo mở bằng tiêu đề. Mark-read lỗi có feedback và retry, không giả báo đã đọc. Role khác không được ánh xạ sang Driver route; backend task ownership không đổi.

**Files:** `frontend/src/features/notifications/{notification-bell.tsx,notifications-page.tsx,notification-target.ts,use-open-notification.ts}`.

**API/compatibility:** không thay backend, DTO, schema hay cấu trúc notification. Dùng được với bản ghi cũ đã có assignment ID; thiếu ID fallback. Không rewrite notification history.

## 3. Kích thước check-in

**Root cause:** `PackageDto` (shipment create) và `ShippingQuoteDto` đã cho phép **1–300 cm, tối đa một chữ số thập phân**, nhưng `WarehouseCheckInDto` dùng `IsInt`. Check-in UI chỉ kiểm tra số dương, không precision/bounds. Form create/quote có `step=0.1` nhưng Zod chưa giới hạn precision. Không có endpoint edit package của shipment; snapshot lịch sử không bị sửa bởi task này.

**Bằng chứng:** test trước sửa tái hiện nguyên văn `widthCm must be an integer number` với `14.8`. Snapshot shipment thật chứa `widthCm:14.8` và `verifiedDimensions.widthCm:15`, weight 1000, dài 20, cao 10.

**Trước → sau:** check-in từ chối decimal hợp lệ → ba DTO dùng chung `PackageDimensionsDto`; create/quote/check-in frontend dùng chung dimension schemas. Check-in chấp nhận `1000 / 20 / 14.8 / 10` và giữ nguyên `14.8` khi tạo verified snapshot. `14.81`, ngoài 1–300, thiếu/không finite bị chặn inline; gram vẫn phải nguyên dương. Không làm tròn/ép nguyên số đo người dùng. Storage hiện là JSONB; service lưu trực tiếp number, không parseInt dimension. Capacity hiện dựa trên gram, không đổi pricing/volume/capacity logic.

**Files:**

- `backend/src/common/dto/package-dimensions.dto.ts`
- `backend/src/modules/shipments/dto/package.dto.ts`
- `backend/src/modules/pricing/dto/shipping-quote.dto.ts`
- `backend/src/modules/warehouses/dto/warehouse-check-in.dto.ts`
- `frontend/src/features/shipments/{package-dimensions.ts,shipment-form.ts}`
- Warehouse workspace nêu ở mục 1.

**API/compatibility:** DTO check-in mở rộng để nhận decimal một chữ số, đồng thời áp dụng max 300 như create/quote. Integer 1–300 vẫn hợp lệ. **Check-in trước đây nhận integer >300, nay từ chối** để thống nhất rule; frontend create/quote nay chặn >1 chữ số thập phân trước submit (backend vốn đã từ chối). Không migration/schema/history rewrite. Cần deploy backend cùng frontend để staging nhận check-in decimal.

## Kiểm thử và giới hạn bằng chứng

| Kiểm tra | Kết quả |
|---|---|
| `npm run test --workspace backend` | 499/499, 57 suites PASS |
| `npm run test --workspace frontend` | 69/69 PASS |
| `node frontend/test/ui-flow/check.mjs` | PASS 375/768/1440 px |
| `npm run lint` | Backend + frontend PASS |
| `npm run typecheck` | Backend + frontend PASS |
| `npm run build` | Backend + frontend PASS; frontend rebuild sau chỉnh guard cuối cũng PASS |
| `git diff --check` | PASS |

Backend regression giữ transfer PENDING/không di chuyển shipment khi tạo đúng đích, chặn mismatch trước write/audit, xác minh verified snapshot giữ decimal, DTO precision/bounds và mark-read ownership/idempotency qua suite hiện có.

Browser chạy Chromium thật với production components và production Vite build, **HTTP fixture được mock**, không chứng minh staging persistence. Bao phủ stale lúc mở/trước submit/đúng lúc POST, missing/inactive/mismatched destination, active transfer, kiện rời kho, lỗi GET + retry; dimension hợp lệ/precision sai/gram lẻ; dropdown và trang notification mở hai detail thật, missing-ID/general fallback, already-read và mark-read failure + retry. Đã xem ảnh mobile check-in, desktop transfer success và tablet pickup detail; ảnh nằm `test-results/ui-flow/`.

Test files: `backend/src/modules/warehouses/dto/warehouse-check-in.dto.spec.ts`, `backend/src/modules/warehouses/warehouses.service.spec.ts`, `frontend/test/ui-flow.test.mjs`, `frontend/test/ui-flow/{index.html,fixture.tsx,check.mjs}`. `--baseline` trong browser runner dành cho code trước sửa; regression sau sửa chạy không có flag.

Môi trường kiểm thử local Windows/Node 24.13.1; không thay cấu hình Node 22 của dự án. Sandbox ban đầu chặn child process bằng EPERM; frontend tests/browser/build đã chạy lại ngoài sandbox và PASS. Build còn cảnh báo chunk lớn và release SHA `unknown` của cây chưa commit. PostgreSQL E2E riêng không chạy: Docker daemon local không hoạt động; không dùng staging làm DB test. Staging chỉ được truy vấn bằng `BEGIN READ ONLY` rồi rollback; không có authenticated staging browser regression/deploy trong task này.

Invariants giữ nguyên: C01 backend quyết định; C02 command riêng; C04 role/resource scope; C05 lịch sử; C08 snapshot; C09 retry/idempotency. C16: dimension validation gom đúng phần lặp của ba DTO và các form liên quan, không refactor domain khác.
