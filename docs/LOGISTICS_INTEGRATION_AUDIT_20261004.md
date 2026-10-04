# Audit WarehouseTransfer / Line-haul và delivery coordinate

Audit-only, kết thúc 2026-10-04. Chưa sửa product code, deploy, migrate, seed hoặc cập nhật dữ liệu nghiệp vụ staging.

## Phạm vi và độ chắc chắn

- Đọc source backend/frontend, Prisma schema, constraints thực tế và các test liên quan. Routing: `docs/DOMAIN.md`, `docs/CONSTITUTION.md`; checklist UI từ skill `ui-ux-pro-max`.
- DB: Neon `ep-royal-dust-axv3itmx.c-4.us-east-2.aws.neon.tech/neondb`, transaction `REPEATABLE READ READ ONLY`, kết thúc bằng `ROLLBACK`. Kiểm tra đầu 23:18–23:19 ngày 03/10 và kiểm tra lại 11:09 ngày 04/10, giờ Việt Nam.
- API/frontend: `https://logistics-staging-api.onrender.com`, `https://logistics-staging-web.onrender.com`; authenticated GET bằng phiên Admin/Customer có sẵn tối 03/10. Auth refresh được dùng bình thường; không giả danh Driver hoặc tạo token.
- Workspace HEAD được quan sát: `4477548f71f908fc746350411b1f2d4b851171a3`. Đây không phải Live SHA. Backend `/api/v1/health/version` trả 404; frontend `/release.json` trả HTML fallback. Backend Live commit chưa xác định.
- Frontend Live đã tải và đọc trực tiếp: entry `index-BGj12pP4.js`, SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`; các chunk Customer/Driver/Warehouse chứa những nhánh được mô tả bên dưới.
- Shipment do user chỉ định: `SHP-20261003-B61E02E5`, ID `f0d6861a-05dc-4ff7-88b8-17c3e5109388`.

## A. Warehouse transfer / Line-haul integration

### Kết luận và trả lời 5 câu hỏi

**Integration đã tồn tại, nhưng là tùy chọn.** Hệ thống có hai đường thực thi vào cùng lifecycle của WarehouseTransfer; đường standalone vẫn được backend cho phép và UI đưa ra. Không phải hai module hoàn toàn chưa nối với nhau.

| Câu hỏi | Kết quả có bằng chứng |
|---|---|
| Transfer bắt buộc thuộc Trip không? | **Không.** Quan hệ qua `LineHaulTripTransfer[]`; không có trip FK bắt buộc trên Transfer. `docs/DOMAIN.md:114` hiện còn cho phép standalone dispatch rõ ràng. |
| Dispatch chỉ đổi state? | **Không chỉ đổi state:** kiểm actor/scope, kho active, route/sorting, trạng thái transfer/shipment và tồn kho; transaction đổi Transfer + Shipment, clear inventory, ghi actor/time/tracking/audit. Tuy nhiên đường standalone **không đòi trip/vehicle/driver**. |
| Line-haul dùng cho shipment/transfer nào? | Source hỗ trợ các Transfer `PENDING` cùng chính xác cặp kho với trip, qua manifest association; READY/dispatch kiểm Shipment ở origin, sorting đúng destination và capacity. **Staging hiện chưa dùng cho shipment nào:** 0 trip và 0 association. |
| Có hai flow độc lập chưa nối? | Có hai flow tùy chọn; **đã nối bằng association và lifecycle service dùng chung**. Khi đã có active association, standalone dispatch bị 409; trip dispatch chuyển toàn manifest atomically. Gap là chưa bắt buộc đi qua integration này. |
| Ai chịu trách nhiệm vật lý khi IN_TRANSIT? | Với standalone, dữ liệu chỉ biết staff/actor xuất kho, không có carrier Driver hay vehicle được phân công. `dispatchedById` là người thực hiện command, không chứng minh người chở. Với trip, trách nhiệm vận chuyển là `LineHaulTrip.driverId` + `vehicleId`. |

### Dữ liệu staging chứng minh flow đang dùng

| Aggregate | Số lượng lúc kiểm tra lại |
|---|---:|
| WarehouseTransfer | 6 |
| LineHaulTrip | 0 |
| LineHaulTripTransfer | 0 |
| LineHaulVehicle | 0 |
| DriverProfile có capability LINE_HAUL | 0 |

Authenticated GET `/api/v1/line-haul/trips?limit=20` và `/api/v1/line-haul/vehicles?limit=20` đều HTTP 200, `total=0`, phù hợp DB. Request IDs: `e52bbbd2-5942-463c-8a89-bd86d06f2375`, `4ea98126-52f1-4dc3-80ff-039940614137`.

Transfer `TRF-MUSL4U1U-3YWA` của shipment được chỉ định:

- SG01 → SG02; tạo 23:07:10 ngày 03/10.
- Staff SG01 xuất lúc 23:07:17; staff SG02 nhận lúc 23:08:12; hiện `COMPLETED`.
- Không có manifest association, trip, vehicle, line-haul Driver, departedAt/arrivedAt của trip.
- DB có `createdById`, `dispatchedById`, `receivedById`, timestamps và tracking tương ứng. Thiếu trách nhiệm người vận chuyển; không thiếu toàn bộ audit xuất/nhận.
- Một transfer khác, `TRF-MUSKE729-PAEL` / `SHP-20261003-48FF366D`, vẫn `IN_TRANSIT`, cũng không có trip. Đây là dữ liệu cần xét khi chuyển policy.

### Các đường thực thi hiện tại

```text
Standalone:
Create Transfer PENDING
  → POST /warehouses/:warehouseId/transfers/:transferId/dispatch
  → Transfer + Shipment IN_TRANSIT; currentWarehouseId=null
  → POST /warehouses/:destinationId/transfers/:transferId/receive
  → Transfer COMPLETED; Shipment AT_DESTINATION_WAREHOUSE

Line-haul đã có:
Create Transfer PENDING
  → Create Trip PLANNED với route + Driver + Vehicle
  → Assign Transfer vào manifest + schedule trip
  → Prepare READY (khóa manifest, snapshot tải/capacity)
  → Dispatch Trip IN_TRANSIT + departedAt
      → Vehicle IN_USE + từng Transfer/Shipment IN_TRANSIT cùng transaction
  → Arrive Trip ARRIVED + arrivedAt; Vehicle AVAILABLE
      → Shipment vẫn IN_TRANSIT, chờ dỡ/nhận
  → Warehouse Receive từng Transfer
      → Transfer COMPLETED; Shipment AT_DESTINATION_WAREHOUSE
  → Command ready-for-delivery hiện có
```

`dispatchTrip` do Admin/Dispatcher thực hiện. `arriveTrip` do Admin hoặc staff active đúng kho đích xác nhận. Driver được phân công là người chở, không phải actor được cấp quyền bấm hai command này trong architecture hiện tại. GPS chỉ nhận từ Driver đúng chủ trip `IN_TRANSIT`, có capability `LINE_HAUL`; dữ liệu tạm Redis, không phải chứng cứ tự động arrival.

### Guard, history và concurrency đã có

- `WarehouseTransferLifecycleService.dispatch`: khóa Transfer; standalone bị chặn **khi đã có** active association. Nhánh trip đòi association đúng trip và trip đã chuyển `IN_TRANSIT` trong transaction gọi nó.
- `receive`: chỉ receive đúng kho đích; **chỉ khi có association** mới kiểm `trip.status === ARRIVED`. Không association thì bypass điều kiện arrival theo policy cũ.
- Manifest chỉ sửa khi `PLANNED`; add/remove khóa trip, add khóa Transfer, route phải trùng chính xác. READY/dispatch revalidate Driver active/capability, vehicle AVAILABLE/capacity, lịch, xung đột last-mile, Warehouse, toàn bộ manifest và tồn kho.
- Trip dispatch khóa trip → Driver → vehicle → Transfer theo thứ tự ổn định; cập nhật version/status có điều kiện, cùng transaction với lịch sử. Receive khóa Transfer và cập nhật Shipment theo version. Retry đã commit không ghi lại history.
- DB thực tế có unique `(createdById,clientRequestId)`, partial unique một active transfer/Shipment, partial unique một active manifest association/Transfer, schedule exclusion Driver/Vehicle, timestamp/capacity/history checks. **Không có constraint bắt mọi Transfer IN_TRANSIT phải có trip.**
- Actor departure/arrival nằm trong `AuditLog` (`LINE_HAUL_TRIP_DISPATCHED`, `LINE_HAUL_TRIP_ARRIVED`); timestamp còn nằm trên Trip. Trip chưa có cột riêng `departedById/arrivedById`. Không cần thêm cột nếu tiếp tục coi AuditLog là nguồn actor canonical.
- Vehicle hiện không có `currentWarehouseId`. Kho arrival được xác định bởi route của Trip + tracking/audit; không có fleet-location entity riêng cần tự tạo.

### Schema hiện có và các module cần dùng

| Source | Trách nhiệm |
|---|---|
| `backend/prisma/schema.prisma:515` | Transfer: Shipment/route/status, clientRequestId, creator/dispatcher/receiver FK + timestamps, association history |
| `backend/prisma/schema.prisma:549` | DriverProfile: capability set và last-mile profile; không dùng vehiclePlate này thay Fleet |
| `backend/prisma/schema.prisma:576` | LineHaulVehicle: code/plate/type, capacity grams nullable cho legacy, status/version |
| `backend/prisma/schema.prisma:591` | Trip: route/Driver/Vehicle FK bắt buộc, schedule, status/version, departed/arrived timestamps, capacity/route snapshots |
| `backend/prisma/schema.prisma:664` | LineHaulTripTransfer: association append-only với assigned/removed actor/time. Đây chính là manifest; không có lý do tạo thêm bảng Manifest |
| `backend/src/modules/warehouses/warehouses.controller.ts:209` và `warehouses.service.ts:843` | API tạo/dispatch/receive, role/scope, wrapper transaction |
| `backend/src/modules/warehouses/warehouse-transfer-lifecycle.service.ts:94` | Nguồn transition canonical cần siết, gồm nhánh receive ở dòng 217 |
| `backend/src/modules/line-haul/line-haul-trips.service.ts:594` | Assign; prepare ở 816, dispatch 934, arrive 1049, revalidation 1621 |
| `backend/src/modules/line-haul/line-haul.policy.ts` | Trip/resource/status/route policy |
| `backend/src/modules/warehouses/warehouse.response.ts:32` | Response chỉ summary trip `id/tripCode/status`; Driver/Vehicle có trong Trip detail |
| `frontend/src/features/warehouses/pages/warehouse-workspace-page.tsx:925` | Có trip thì link sang trip; chưa có trip thì vẫn hiện xuất riêng. Receive tương tự ở 1039 |
| `frontend/src/features/line-haul/line-haul-trip-detail-page.tsx` | Đã có manifest, Driver/Vehicle, READY/dispatch/arrival/receive; tái sử dụng |
| `backend/src/modules/locations/locations.service.ts:240` | GPS line-haul ownership, state, Redis TTL và lifecycle boundary |

Frontend Live `warehouse-workspace-page-CMNqAeHV.js` cũng chứa `PENDING && lineHaulTrip` → link Trip, còn `PENDING` chưa có Trip → standalone dispatch; receive cho phép `!lineHaulTrip || ARRIVED`.

### Canonical flow đề xuất và plan tối thiểu

Giữ flow Line-haul đã có ở trên làm đường bắt buộc cho **departure mới**. Trip hiện bắt buộc Driver/Vehicle ngay lúc tạo, vì vậy không thêm trạng thái trip rỗng tài nguyên chỉ để khớp thứ tự UI đề xuất.

1. Sửa business policy canonical tại `docs/DOMAIN.md:114`: inter-warehouse departure phải qua trip hợp lệ, bỏ quyền xuất mới standalone.
2. Siết backend ở lifecycle service; giữ endpoint cũ trả lỗi nghiệp vụ hữu ích cho client cũ, không biến endpoint một Transfer thành thao tác âm thầm xuất cả manifest. Reuse `LineHaulTripsService.dispatch`, không tạo rule validation song song.
3. Receive mới yêu cầu active association đúng route và trip ARRIVED. Chốt cách xử lý một transfer standalone đang đi trước khi bật rule: xử lý theo thực tế trước cutover, hoặc có ngoại lệ legacy rõ ràng, audited và có giới hạn. **Không tạo trip/arrival giả để hợp thức hóa lịch sử.**
4. Test backend negative/race/retry/rollback trước; sau đó UI thay CTA xuất riêng bằng trạng thái chờ điều phối/gán chuyến, đưa tới Trip có quyền truy cập. Có summary Driver/Vehicle qua response scoped hoặc link detail hiện có; backend vẫn quyết định eligibility.
5. Giữ shipment lifecycle và command ready-for-delivery nguyên nghĩa; giữ Trip terminal ARRIVED và Transfer COMPLETED khác nhau. Phải refresh cả query Transfer và Trip sau command.

**Migration: NO cho integration tối thiểu.** Các bảng/FK/index cần thiết đã tồn tại cả trong staging. Chỉ cần migration nếu chọn mở rộng schema riêng cho policy legacy/actor convenience; đó không phải điều kiện để reuse module hiện tại và chưa được đề xuất triển khai.

**Effort: vừa, rủi ro nghiệp vụ cao hơn số dòng code.** Guard/UI tương đối nhỏ; phần cần thận trọng là compatibility, một transfer đang đi, retry đã hoàn tất và concurrency. Staging hiện không có xe/Driver line-haul, nên bật bắt buộc mà chưa cấu hình tài nguyên sẽ chặn mọi departure mới.

**Có nên implement ngay?** Integration source đã đủ rõ để chuẩn bị bản sửa local theo hướng trên. Chưa nên bật staging; còn quyết định chuyển tiếp cho standalone IN_TRANSIT và provisioning tài nguyên. Trong lượt audit này chưa implement.

## B. Delivery coordinate

### Bằng chứng của shipment cụ thể

| Lớp | Kết quả |
|---|---|
| Shipment | Tạo 23:03:10 ngày 03/10/2026; hiện DELIVERED. Đây là đơn mới, không đủ cơ sở gọi là legacy |
| DB | `Shipment.deliverySnapshot.latitude = null`, `longitude = null`; keys này tồn tại trong JSONB. Schema không dùng tên `deliveryAddressSnapshot.lat/lng` |
| Warehouse | Kho đích SG02 có tọa độ; tọa độ kho không phải tọa độ người nhận và không được lấy thay |
| Create audit | `SHIPMENT_CREATE` chỉ có status/trackingCode/fee/payer/configVersion; không có coordinate hoặc payload gốc; metadata null |
| HTTP logs source | Request interceptor lưu requestId/method/path/status/duration/user/role, không lưu request body. Không tìm thấy payload của shipment này trong evidence local |
| Customer GET | `/api/v1/shipments/f0d6861a-05dc-4ff7-88b8-17c3e5109388` HTTP 200, `data.delivery.latitude/longitude = null`, khớp DB. Request ID `3de8fb73-19d0-4eb7-bfc6-60a08f4de19b` |
| Delivery assignment | `bcdb19fe-e061-4b3a-a569-cdbe74ae86e9`; đã có attempt, bắt đầu 23:10:38, hoàn tất 23:11:05 |
| Driver GET thật | **Chưa kiểm được bằng phiên đúng chủ sở hữu.** Profile tên `auth-staging-driver` thực tế là Customer; profile `staging-driver-browser` về login. Không dùng Admin hoặc token tự tạo để bypass |
| Driver mapper source | Sau khi có attempt, target lấy từ delivery snapshot. Với dữ liệu DB này mapper sẽ cho `taskLocation.kind=RECEIVER`, tọa độ null; đây là kết luận từ code, không gắn nhãn response Live đã quan sát |

### Trace source từ tạo đơn tới marker

1. `shipment-form-fields.tsx:30`: Confirm của LocationPicker ghi `deliveryLatitude`, `deliveryLongitude`, `confirmedAddressFingerprint` vào form. LocationPicker giữ draft đến khi user xác nhận; không ghi canonical tỉnh/phường từ GPS.
2. `shipment-form.ts:97`: `deliverySnapshot(values)` chỉ đưa coordinate vào payload khi fingerprint khớp địa chỉ hiện tại. `create-shipment-page.tsx:65` gửi dưới `deliveryAddress.latitude/longitude`.
3. `CreateShipmentDto.deliveryAddress` dùng `QuoteAddressDto`: optional nhưng nếu có phải đủ cặp number, đúng range, tối đa sáu chữ số thập phân. Không dùng alias `lat/lng`.
4. `ShipmentsService.create:84,111` gọi snapshot helper rồi lưu `deliverySnapshot` JSONB cùng transaction. Helper ở dòng 443 copy `address.latitude/longitude`, chỉ default null khi thiếu. Không tìm thấy business command ghi lại deliverySnapshot sau create trong source hiện tại.
5. Customer shipment mapper ở dòng 382 trả snapshot dưới `delivery`.
6. `DeliveryService.response:809`: trước start, target là **destination Warehouse**; sau start/có attempt, target là **receiver snapshot**. `delivery` text trong Driver response cố ý không chứa geo; geo được trả trong `taskLocation` qua `task-location.response.ts`.
7. `delivery-detail-page.tsx` đưa `assignment.data.taskLocation` vào `DriverTaskMap`. Frontend Live `driver-routes-C4f_TBUH.js` cũng đọc đúng field này.
8. `driver-task-map-model.ts:33`: target hợp lệ sinh `task-receiver`, GPS mới sinh `driver-current-location`, khác ID/tone/label. GPS stale bị ẩn mà target vẫn giữ. Navigation dùng cặp destination nếu có, nếu thiếu dùng address. Không geocode trên mỗi lần mở page; không dùng GPS Driver thay destination.

### Root cause: điều gì đã chứng minh, điều gì chưa

**Nguyên nhân trực tiếp của việc không có pin là snapshot DB không có tọa độ. Chưa đủ bằng chứng xác định chính xác vì sao request gốc không tạo được snapshot tọa độ.** Không được sửa response mapper để đoán hoặc lấy vị trí kho/GPS bù vào.

| Phân loại | Kết luận |
|---|---|
| A — frontend không gửi | **Có nhánh tái hiện được ở source hiện tại:** confirm → sửa địa chỉ → schema vẫn pass → serializer bỏ tọa độ. Live bundle chứa cùng nhánh. Chưa chứng minh shipment cụ thể đã đi qua nhánh này |
| B — backend không snapshot | Source hiện tại copy cặp tọa độ và test create pass. Chưa chứng minh backend Live tại thời điểm request gốc giống source này; không có payload gốc/Live SHA để loại trừ tuyệt đối |
| C — DB có, response bỏ | Không phù hợp dữ liệu shipment này: DB đã null trước response |
| D — API có, UI đọc sai | Không thấy lỗi field mapping trong source/Live frontend. Driver HTTP thật chưa được quan sát; không thể dùng giả thuyết này giải thích DB null |
| E — legacy thiếu tọa độ | Bản ghi thực sự thiếu coordinate, nhưng được tạo mới tối 03/10. **Không mặc định gọi là legacy** để đóng issue |

Audit reproducer local chạy schema + serializer thật xác nhận: input có coordinate/fingerprint đúng thì payload giữ cặp số; đổi số nhà thì `safeParse.success=true` nhưng payload không còn hai field. Đây là hành vi được test cũ chấp nhận, không phải DTO tự đổi số thành null. Chưa chạy trọn browser POST capture thành công trên Live: lần đầu selector sai, lần tiếp theo phiên không mở được form. Không có POST tạo shipment nào được gửi từ probe.

### Plan sửa tối thiểu sau khi xác định case

- Với nhánh A đã chứng minh: khi coordinate từng xác nhận nhưng fingerprint đã stale, chặn báo giá/create và hiển thị lỗi yêu cầu xác nhận lại; dùng chung `getConfirmedCoordinate`/fingerprint, không duplicate policy. Nếu vẫn cho phép tạo không tọa độ theo contract hiện tại, đó phải là trạng thái chưa chọn rõ ràng; không âm thầm biến lựa chọn đã xác nhận thành missing.
- Files trọng tâm: `frontend/src/features/shipments/shipment-form.ts`, `shipment-form-fields.tsx`, `create-shipment-page.tsx`; tests `frontend/test/address-location.test.mjs` và browser create flow. `address-location-model.ts`/LocationPicker chỉ sửa nếu tái hiện ra lỗi ở chính shared helper.
- Backend `shipments.service.ts`, `QuoteAddressDto`, `DeliveryService`, task-location mapper **chưa có bằng chứng cần sửa để giữ cặp coordinate hợp lệ**. Bổ sung regression assertion theo flow create → Driver response thay vì thêm mapper workaround. Nếu payload gốc chứng minh đã gửi coordinate nhưng DB null, quay lại backend deployed artifact/DTO/create để sửa đúng B.
- `driver-task-map.tsx`, model và navigation đã hỗ trợ destination riêng/GPS riêng/fallback. Reuse; chỉ sửa UI nếu test chỉ ra marker hoặc field sai. Giữ ngữ nghĩa trước start tới kho, sau start tới người nhận theo contract đã có.
- **Migration: NO.** JSONB snapshot đã có latitude/longitude; không backfill bằng geocoding, không đọc saved address hiện tại để viết lại shipment cũ. `SHP-20261003-B61E02E5` giữ fallback cho tới khi có một quy trình correction có bằng chứng và audit riêng; không tự tạo quy trình đó trong task này.
- **Backward compatibility:** vẫn đọc snapshot cũ null/missing; API optional coordinate không tự đổi thành bắt buộc cho toàn client. Validation stale confirmation ở UI bảo vệ thao tác mới, không làm hỏng shipment đã tồn tại.
- Bước còn thiếu để chốt A/B cho shipment: payload/HAR gốc nếu có, thao tác sau xác nhận của user, và response Driver đúng ownership. Đã hỏi user; không yêu cầu gửi token/cookie.

### Test plan bắt buộc cho bản fix

1. Create có confirmed coordinate → DTO → snapshot DB đúng cặp → owned Driver API sau start có `taskLocation` receiver đúng → browser hiện destination marker.
2. Sửa contact/phone sau confirm vẫn giữ pin; sửa street/ward/city làm confirmation stale thì yêu cầu xác nhận lại trước create; không overwrite province/ward.
3. Cập nhật saved address không thay snapshot shipment đã tạo.
4. Destination và GPS Driver có ID/label/tone riêng; GPS missing/stale không xóa destination.
5. Reload/F5 refetch cùng assignment vẫn có destination; legacy null/missing dùng warning và navigation address; coordinate hợp lệ dùng coordinate trong navigation.
6. Driver khác không đọc được assignment. Trước start vẫn tới warehouse; sau start mới dùng receiver theo contract hiện tại.

## Verification và phần chưa làm

- Backend focused: **72/72 PASS**, 4 suites (`ShipmentsService`, `DeliveryService`, `WarehousesService`, `LineHaulPolicy`). Không kết nối DB staging từ các unit tests.
- Frontend focused: **18/18 PASS** (`address-location`, `driver-task-map`). Lần sandbox chặn spawn EPERM đã chạy lại thành công bằng escalation.
- Audit reproducer: confirmed pair preserved, stale schema accepted + coordinates omitted, two distinct markers, legacy fallback, coordinate-based navigation PASS. JSON round-trip marker equality chỉ là model check, **không phải browser F5 E2E**.
- Đọc coverage G2/G3: manifest locking, route/capacity, concurrent dispatch/arrival/receive có E2E hiện có; **không chạy PostgreSQL mutation E2E vào staging**. Bản sửa cần chạy lại trên DB disposable.
- Driver HTTP thật và browser create/Driver reload còn chưa verified. Không có xác nhận sửa xong hoặc staging PASS cho hai issue.
- Invariants liên quan: C01–C06, C08–C10, C12, C14–C18. Audit giữ history/snapshot/ownership, không bypass authorization hoặc ghi lịch sử vận chuyển giả.
- Tracked files thay đổi trong task: báo cáo này và `PROJECT_STATE.md`. Scripts/evidence local nằm trong ignored `test-results/`, không chứa token/password trong report.
- Evidence: `test-results/logistics-integration-audit/{database.json,api.json,live.json,coordinate-contract.json,create-ui.json}` và các frontend chunks tải trực tiếp. Các audit scripts đứng ở `test-results/logistics-*.mjs`.
