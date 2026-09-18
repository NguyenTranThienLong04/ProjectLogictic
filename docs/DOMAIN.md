# DOMAIN — Models, Lifecycle, Business Flows

## ENTITIES (fields rút gọn, xem Prisma schema thực tế để biết type chính xác)

- **User**: id, email, phone, passwordHash, fullName, role, isActive, timestamps
- **CustomerAddress**: id, customerId FK, label, contactName, phone, address, ward, district, city, lat/lng, isDefault
- Address compatibility (2026-09-18): `district` vẫn là string trong CustomerAddress/API và address snapshots; `''` biểu thị địa chỉ hai cấp không có district. DTO CreateAddress/QuoteAddress chấp nhận chuỗi rỗng, tối đa 100 ký tự; không bỏ cột/migration/backfill, không sửa snapshot cũ. UI mới dùng province → ward; legacy district giữ để hiển thị, không làm hierarchy canonical. Không thay đổi geo persistence, pricing hay assignment policy.
- **DriverProfile**: id, userId FK unique, operatingWarehouseId FK?, employeeCode unique, vehicleType, vehiclePlate, capabilities (`PICKUP|DELIVERY|LINE_HAUL`[]), status (`OFFLINE|AVAILABLE|BUSY|SUSPENDED`), isOnline, isAvailable
- **Warehouse**: id, code unique, name, address, lat/lng, isActive
- **Shipment**: id, trackingCode unique, customerId FK, senderSnapshot, receiverSnapshot, pickupSnapshot, deliverySnapshot, packageSnapshot, pricingSnapshot, codAmount, totalFee, shippingFeePayer (`SENDER|RECEIVER`), status, currentWarehouseId FK?, timestamps (createdAt/confirmedAt/pickedUpAt/deliveredAt/cancelledAt), version. Snapshot dùng JSONB nếu thực sự immutable; quan hệ chính vẫn relational.
- **DriverAssignment**: id, shipmentId FK, driverId FK, type (`PICKUP|DELIVERY`), status, assignedById FK, assignedAt/acceptedAt/completedAt/cancelledAt, reason
- **TrackingEvent** (append-only): id, shipmentId FK, status, type, title, description, visibility, warehouseId?, actorId?, lat/lng?, createdAt
- **AuditLog**: id, actorId?, actorRole, action, entityType, entityId, before JSONB, after JSONB, metadata JSONB, ip, userAgent, createdAt
- **WarehouseTransfer**: id, shipmentId FK, fromWarehouseId FK, toWarehouseId FK, status, createdById FK, createdAt/dispatchedAt/receivedAt
- **LineHaulVehicle**: id, vehicleCode unique, licensePlate unique, vehicleType, capacityWeightGrams? (integer grams; nullable chỉ cho legacy migration), status (`AVAILABLE|IN_USE|MAINTENANCE|INACTIVE`), version, timestamps
- **LineHaulTrip**: id, tripCode unique, originWarehouseId FK, destinationWarehouseId FK, driverId FK, vehicleId FK, status (`PLANNED|READY|IN_TRANSIT|ARRIVED|CANCELLED`), scheduledStartAt?, scheduledEndAt?, plannedDepartureAt? (legacy), plannedDistanceMeters?, plannedDurationSeconds?, routeMetricMode?, routeProvider?, routeCalculatedAt?, preparedManifestWeightGrams?, preparedVehicleCapacityWeightGrams?, departedAt?, arrivedAt?, cancelledAt/reason?, createdById FK, version, timestamps
- **LineHaulTripTransfer**: id, tripId FK, warehouseTransferId FK, isActive, assignedById/assignedAt, removedById?/removedAt?; association history giữa chuyến và transfer, không thay thế `WarehouseTransfer`
- **DeliveryAttempt**: id, shipmentId FK, driverId FK, attemptNumber, status, failureReason?, startedAt/completedAt
- **ShipmentProof**: id, shipmentId FK, type (`PICKUP|DELIVERY`), driverAssignmentId FK? unique, deliveryAttemptId FK? unique, fileUrl?, note?, receiverName?, latitude/longitude?, capturedAt, createdById FK, createdAt (dùng chung cho pickup và delivery, xem mục SHIPMENT PROOF)
- **CODTransaction**: id, shipmentId FK, expectedAmount, collectedAmount, status, collectedByDriverId FK, collectedAt/remittedAt/settledAt
- **ShippingFeeTransaction**: id, shipmentId FK unique, payer (`SENDER|RECEIVER`), expectedAmount, paidAmount?, collectedAmount?, remittedAmount?, status (`PENDING|PAYMENT_PENDING|PAID|COLLECTED|REMITTED|SETTLED|DISPUTED|CANCELLED`), paidAt?, collectedByDriverId FK?, remittedByDriverId FK?, settledById FK?, collectedAt/remittedAt/settledAt/cancelledAt?, timestamps. Đây là ledger phí vận chuyển độc lập, không phải `CODTransaction`.
- **ShippingFeePayment**: id, shippingFeeTransactionId FK, merchantReference unique, provider/providerReference?, clientRequestId, payer + amount snapshot, status (`CREATING|PENDING|SUCCEEDED|FAILED`), initiatedById FK, created/expires/completed/failed timestamps. Unique `(transaction, clientRequestId)` và provider reference; không lưu card/payment secret hoặc raw provider payload.
- **ShippingFeePaymentEvent** (append-only): id, paymentId FK, provider + eventId unique, eventType (`SUCCEEDED|FAILED`), amount, payloadDigest, occurredAt/receivedAt. Đây là bằng chứng webhook/IPN đã normalize và chống replay.
- **ShippingFeeDispute** (append-only): id, shippingFeeTransactionId FK, fromStatus (`COLLECTED|REMITTED`), reason, openedById/openedAt, resolvedById/resolvedAt?, resolutionNote?. Mỗi transaction chỉ có tối đa một dispute chưa resolve.
- **Notification**: id, userId FK, type, title, message, data JSONB, readAt, createdAt

---

## SHIPMENT LIFECYCLE (canonical, không cho frontend tự chọn status)

```
PENDING → CONFIRMED → AWAITING_PICKUP_ASSIGNMENT → PICKUP_ASSIGNED
→ PICKUP_IN_PROGRESS → PICKED_UP → AT_ORIGIN_WAREHOUSE → IN_TRANSIT
→ AT_DESTINATION_WAREHOUSE → AWAITING_DELIVERY_ASSIGNMENT → DELIVERY_ASSIGNED
→ OUT_FOR_DELIVERY → DELIVERED
```
Exception states: `CANCELLED · DELIVERY_FAILED · RETURN_REQUESTED · RETURN_IN_TRANSIT · RETURNED · DAMAGED · LOST`

## CANCELLATION
Customer cancel được khi status ∈ `PENDING | CONFIRMED | AWAITING_PICKUP_ASSIGNMENT`. Từ `PICKED_UP` trở đi → dùng Return Workflow, không cancel. Lưu `cancelledBy, cancelledAt, reason, previousStatus`.

## DRIVER ASSIGNMENT
Entity riêng, không overwrite `shipment.driverId`. Reassignment = cancel assignment cũ (lưu reason) → tạo assignment mới → audit → notification. Driver phải active, không suspended, available.

### OPERATING AREA + LOCATION-AWARE CANDIDATE (Operational Realism Phase B)

- `DriverProfile.operatingWarehouseId` là FK tới kho vận hành. Cột nullable để migration additive/an toàn cho profile cũ; API tạo profile mới bắt buộc chọn một Warehouse active. Profile cũ chưa cấu hình kho không eligible.
- Service area pickup tối thiểu được suy ra từ `operatingWarehouse.city` (so sánh normalized). Pickup candidate phải đồng thời: User role DRIVER + ACTIVE, DriverProfile `AVAILABLE` + online + available, kho vận hành active/cùng city với pickup snapshot, và có GPS hiện tại theo TTL 20 giây.
- Delivery candidate phải thỏa cùng trạng thái vận hành/GPS và `operatingWarehouseId === Shipment.destinationWarehouseId`. Điểm xếp hạng delivery là tọa độ destination Warehouse, không phải delivery address.
- `CustomerAddress.latitude/longitude` (lat/lng) được persist qua API. Flow: `CustomerAddress → Create Shipment từ saved pickup address → pickupSnapshot.latitude/longitude → Shipment historical snapshot → AssignmentCandidatesService → pickup distance ranking`. `ShipmentsService.create()` đọc địa chỉ thuộc Customer và copy tọa độ qua `pickupSnapshot()` tại thời điểm tạo; snapshot địa chỉ là immutable historical data. Customer sửa saved address sau đó không thay đổi tọa độ Shipment cũ; ranking đọc snapshot, không đọc lại saved address. Shipment cũ/pickup address thiếu tọa độ hoặc destination Warehouse thiếu tọa độ trả lỗi nghiệp vụ `ASSIGNMENT_TARGET_LOCATION_REQUIRED`; không đoán hoặc backfill tọa độ lịch sử. Delivery coordinate vẫn optional; nếu cung cấp phải là cặp latitude/longitude hợp lệ.
- Sau khi eligibility pass, candidate dùng `RouteProvider` backend từ GPS hiện tại của Driver tới pickup location hoặc destination Warehouse. `ROAD_ROUTE` dùng road distance + planned duration; provider timeout/unavailable/malformed dùng `HAVERSINE_FALLBACK`, ghi rõ **“khoảng cách ước tính”** và `durationSeconds = null`. Candidate có road metric được ưu tiên khi rank; không auto-assign.
- GPS thiếu, stale, malformed hoặc Redis read unavailable được xem là `DRIVER_CURRENT_LOCATION_REQUIRED`: Driver không eligible nhưng endpoint/command không trả 500. Redis vẫn không phải source of truth.
- Candidate endpoint chỉ hỗ trợ Dispatcher/Admin quyết định. Không auto-assign. Command assign/reassign luôn tải lại Driver, operating area và GPS ở backend trước transaction mutation; frontend không tự xác lập eligibility.
- Không đổi operating Warehouse khi Driver còn assignment active. Assignment vẫn dùng conditional version/status update để chỉ một command đồng thời thắng (C10).

### DRIVER REJECT FLOW

Khi pickup driver từ chối assignment:

1. Chỉ driver đang sở hữu assignment active mới được reject; `reason` là bắt buộc.
2. Trong cùng transaction, assignment chuyển `REJECTED` và lưu `rejectedAt/reason`; shipment dùng conditional version update để quay về `AWAITING_PICKUP_ASSIGNMENT`.
3. Driver trở lại `AVAILABLE` nếu user còn active, profile không suspended và đang online; nếu không thì giữ trạng thái `OFFLINE` hoặc `SUSPENDED` tương ứng.
4. Ghi `AuditLog` cho hành động reject (internal, không trộn vào public tracking theo C06).
5. Tạo Notification idempotent cho các user `DISPATCHER` đang active để shipment không bị treo và có người reassign.

Retry cùng command không được tạo thêm audit, notification hoặc thay đổi state lần nữa. Reassignment sau đó vẫn tuân theo rule cancel assignment cũ → tạo assignment mới → audit → notification.

## SHIPMENT PROOF

Phase 3 và 5 dùng **một entity chung `ShipmentProof`** cho cả pickup và delivery, thay vì tạo `PickupProof` riêng hoặc dùng tên `ProofOfDelivery` cho dữ liệu pickup, tránh duplicate entity/policy theo C16.

Field set đã chốt và migrate (`20260817180000_phase3_dispatcher_pickup`):

```
id
shipmentId FK
type PICKUP | DELIVERY
driverAssignmentId FK nullable unique
deliveryAttemptId FK nullable unique
fileUrl nullable
note nullable
receiverName nullable         // chỉ áp dụng cho DELIVERY
latitude/longitude nullable
capturedAt                 // server timestamp
createdById FK             // driver thực hiện command
createdAt
```

Ràng buộc:

- `PICKUP`: bắt buộc `driverAssignmentId`, `deliveryAttemptId = null`; mỗi pickup assignment chỉ có tối đa một proof.
- `DELIVERY`: bắt buộc `deliveryAttemptId`, `driverAssignmentId = null` và `receiverName`; mỗi delivery attempt chỉ có tối đa một proof.
- PostgreSQL có `CHECK` constraint cho quan hệ loại trừ trên; service validation không thay thế DB invariant.
- `ShipmentProof(shipmentId)` có index phục vụ truy vấn proof theo shipment.
- Record proof là bắt buộc khi hoàn tất pickup/delivery; ảnh, note và tọa độ là optional trong MVP. Tọa độ có thể được bổ sung bởi luồng GPS Phase 6 mà không đổi entity.
- Nếu có ảnh, backend chỉ nhận file qua `StorageService` abstraction và tự lưu `fileUrl`; không tin URL tùy ý từ frontend, không lưu binary trong PostgreSQL.
- `createdById` luôn lấy từ authenticated driver; service phải xác nhận driver đó sở hữu đúng assignment/shipment, không nhận hoặc tin actor ID từ client (C04).
- Tạo proof cùng shipment transition/tracking/audit trong một transaction. Retry `pickupShipment()`/`completeDelivery()` khi proof đã tồn tại phải trả idempotent success với proof hiện có, không trả unique-constraint error cho client (C09).

## WAREHOUSE FLOW
```
PICKED_UP → Origin Check-in → Sorting → Transfer Created → Transfer Dispatched
→ IN_TRANSIT → Destination Receive
```
Không đổi `currentWarehouseId` mà không tạo `WarehouseTransfer`. Warehouse đích không được nhận transfer không phải của mình.

- Khi pickup hoàn tất, `originWarehouseId` được snapshot từ `operatingWarehouseId` của pickup Driver đã được backend xác nhận; `currentWarehouseId` vẫn là `null` cho đến origin check-in. Lookup/check-in tại kho khác origin phải trả `Forbidden`, kể cả staff đó hợp lệ tại kho của họ.
- Scan/lookup tracking code là read-only. Origin check-in chỉ chạy sau khi staff xác nhận package verification và gửi khối lượng/kích thước thực tế; retry không tạo thêm tracking/audit.
- Sorting dùng command `routeDestination`. Transfer liên kho chỉ được tạo khi destination đã confirm, khác origin/current warehouse và khớp destination của Shipment.
- Create Transfer tạo một `WarehouseTransfer(PENDING)` append-only và chưa đổi Shipment/current inventory. Mỗi Shipment chỉ có tối đa một transfer `PENDING|IN_TRANSIT`.
- Dispatch là command riêng: `PENDING → IN_TRANSIT`, đồng thời Shipment → `IN_TRANSIT` và `currentWarehouseId = null`. Transfer chưa gắn trip có thể dùng standalone dispatch; transfer đang có association active phải được dispatch qua `dispatchTrip`, không được tách khỏi transaction của trip. Retry create/dispatch/receive trả kết quả đã commit mà không duplicate transfer/tracking/audit.
- `WarehouseTransfer` tiếp tục là nguồn lịch sử canonical của việc chuyển từng Shipment. `LineHaulTrip` gom các transfer cùng tuyến vào một manifest xe và orchestration G2 tái sử dụng chính lifecycle service của transfer; không tạo transfer hay history song song.

### LINE-HAUL FOUNDATION & EXECUTION (Phase G1–G2)

- Role vẫn là `DRIVER`. `DriverProfile.capabilities` là tập không rỗng; profile cũ và profile tạo mới mặc định `PICKUP + DELIVERY`. Admin có command riêng để bật/gỡ `LINE_HAUL`; một Driver có thể có nhiều capability. Assignment pickup/delivery và trip line-haul đều revalidate capability tại backend.
- `vehicleType/vehiclePlate` cũ trên `DriverProfile` tiếp tục mô tả phương tiện last-mile của tài xế. Xe tải liên kho là aggregate độc lập `LineHaulVehicle`; `vehicleCode` và `licensePlate` được chuẩn hóa, unique ở PostgreSQL. Xe từng có trip không bị hard delete; Admin dùng command `activate`, `mark-maintenance`, `deactivate`.
- Một trip bắt buộc có hai Warehouse active khác nhau, User tài xế role `DRIVER` + active, profile không `SUSPENDED` + có `LINE_HAUL`, và vehicle đúng trạng thái `AVAILABLE`. Trạng thái online/GPS của last-mile không phải điều kiện để lập kế hoạch line-haul G1.
- Trip operational là `PLANNED|READY|IN_TRANSIT`; ownership tài nguyên theo thời gian của `PLANNED` được quy định ở G3C2 thay vì khóa Driver/Vehicle vô thời hạn. `tripCode` là mã đọc được và unique; create có idempotency theo `(createdById, clientRequestId)`.
- `LineHaulTripTransfer` giữ lịch sử gán/gỡ. Chỉ `WarehouseTransfer(PENDING)` có đúng `fromWarehouseId/toWarehouseId` như tuyến trip mới được gán trong G1. Mỗi transfer chỉ có tối đa một association active qua partial unique index; remove/cancel chuyển association sang inactive thay vì xóa.
- Manifest chỉ được gán/gỡ khi trip `PLANNED`. `prepareTrip` revalidate driver/User/capability, vehicle, hai Warehouse active, manifest không rỗng, tuyến transfer, trạng thái `WarehouseTransfer(PENDING)` và Shipment đang ở origin; transition `PLANNED → READY` khóa manifest. Retry READY trả state đã commit, không tạo thêm audit.
- `dispatchTrip` chỉ nhận `READY` và chạy trong một PostgreSQL transaction: trip `READY → IN_TRANSIT` + `departedAt`, vehicle `AVAILABLE → IN_USE`, từng `WarehouseTransfer PENDING → IN_TRANSIT`, từng Shipment → `IN_TRANSIT` với `currentWarehouseId = null`, cùng tracking/audit. Row lock, conditional version update và partial unique indexes ngăn double dispatch, lost update và owner conflict.
- Trong `IN_TRANSIT`, trip/manifest/driver/vehicle/route là read-only. Command cancel chỉ hợp lệ trước departure ở `PLANNED|READY`; cancel/breakdown/rescue sau departure chưa có policy và phải reject thay vì tự suy diễn recovery workflow.
- `arriveTrip` chỉ nhận `IN_TRANSIT`; Admin hoặc Warehouse Staff active đúng destination mới xác nhận được. Transaction đặt trip `ARRIVED` + `arrivedAt` và release vehicle `IN_USE → AVAILABLE`. `ARRIVED` là terminal state canonical của trip, không thêm `COMPLETED`; release xe phản ánh xe đã tới bãi và không phụ thuộc tiến độ scan dỡ hàng.
- Arrival của trip không receive Shipment. Sau `ARRIVED`, destination Warehouse Staff nhận từng transfer bằng command canonical: `WarehouseTransfer IN_TRANSIT → COMPLETED`, Shipment `IN_TRANSIT → AT_DESTINATION_WAREHOUSE`, `currentWarehouseId = destinationWarehouseId`; command readiness hiện có mới tiếp tục sang `AWAITING_DELIVERY_ASSIGNMENT`. Sai kho là `Forbidden`; retry receive không duplicate history.
- Driver đang thực hiện trip `READY|IN_TRANSIT` không được giữ pickup/delivery assignment active, và ngược lại. Trip `PLANNED` tương lai chưa phải execution ownership; READY/dispatch và last-mile assign command revalidate dưới Driver row lock. Candidate queries chỉ hỗ trợ UX, không thay thế backend policy.

### LINE-HAUL WEIGHT CAPACITY (Phase G3C1)

- `LineHaulVehicle.capacityWeightGrams` là positive integer grams và bắt buộc với create/update mới. Field giữ nullable để migration additive không đoán capacity cho xe legacy; xe null/zero không eligible, không được activate hoặc dùng cho trip operational mới cho tới khi Admin cấu hình.
- Nguồn tải authoritative là `Shipment.packageSnapshot.verifiedWeightGrams` sau origin check-in; dữ liệu legacy chưa có verified value dùng chính `packageSnapshot.weightGrams`. Cả hai phải là positive safe integer. Không đọc lại form, Customer profile hay catalog mutable và không tạo nguồn package weight thứ hai.
- Manifest weight là tổng đúng một lần cho mỗi `LineHaulTripTransfer.isActive = true`; association history inactive không được tính. Backend trả current `manifestWeightGrams`, `vehicleCapacityWeightGrams`, `remainingCapacityWeightGrams` và display-only `capacityUtilizationPercent`.
- Add transfer khóa row trip trong transaction, tính current active weight + candidate weight bằng integer grams rồi reject nếu vượt capacity trước khi tạo association/audit. Vì mọi add/remove cùng trip lấy cùng row lock, hai add đồng thời không thể cùng commit thành overload.
- Create/select vehicle yêu cầu `AVAILABLE` và capacity hợp lệ; availability theo thời gian được kiểm tra khi schedule. Giảm capacity dưới bất kỳ active manifest nào bị reject; capacity không được đổi khi xe `IN_USE`.
- `prepareTrip` và `dispatchTrip` revalidate `manifestWeightGrams <= capacityWeightGrams` dưới lock. Lần đầu `PLANNED → READY` snapshot `preparedManifestWeightGrams` và `preparedVehicleCapacityWeightGrams`; retry không viết lại. Snapshot này giữ bằng chứng lịch sử nếu Fleet capacity được đổi sau khi trip kết thúc, còn current aggregate vẫn phản ánh manifest association hiện tại.
- Shipment đã có length/width/height snapshot, nhưng G3C1 không định nghĩa cube/volume capacity. Không suy diễn volumetric policy, bin packing hoặc optimization từ các dimensions này.

### LINE-HAUL SCHEDULING + RESOURCE AVAILABILITY (Phase G3C2)

- Schedule là cặp nullable `scheduledStartAt/scheduledEndAt`; hai field phải cùng null hoặc cùng có giá trị và `scheduledEndAt > scheduledStartAt`. Khoảng reservation là half-open `[start,end)`: overlap khi `newStart < existingEnd && newEnd > existingStart`, nên hai window liền nhau được phép.
- Chỉ trip `PLANNED` được `schedule`, `reschedule` hoặc `unschedule`. Đây là ba business command riêng dùng `expectedVersion`; không có generic update. Mỗi thay đổi thành công ghi `AuditLog` với before/after window và Driver/Vehicle liên quan; retry cùng state không tạo thêm audit.
- Trip `PLANNED` chưa schedule không giữ Driver/Vehicle. Nhiều trip có thể dùng cùng tài nguyên nếu window không overlap. PostgreSQL GiST exclusion constraints trên Driver và Vehicle là lớp chống race cuối cùng; service còn khóa trip → Driver → Vehicle, re-read và conditional update để hai Dispatcher đồng thời chỉ có một winner.
- Schedule/reschedule revalidate User Driver active, profile không `SUSPENDED`, có `LINE_HAUL`, Vehicle `AVAILABLE` với capacity hợp lệ, và không có reservation overlap. Reservation tương lai không đổi Vehicle sang `IN_USE`; chỉ command Dispatch mới làm `AVAILABLE → IN_USE`.
- READY bắt buộc có schedule và READY/Dispatch đều revalidate lại Driver, Vehicle, active last-mile assignment, capacity và schedule conflict dưới execution locks. Driver bị suspend/capability bị gỡ, Vehicle chuyển maintenance/inactive, hoặc conflict phát sinh sau schedule đều làm transition fail closed; PLANNED reservation vẫn được giữ để Dispatcher xử lý bằng command rõ nghĩa.
- Availability endpoint trả từng Driver/Vehicle là `AVAILABLE|BUSY|UNAVAILABLE` kèm trip conflict theo window; đây là read model hỗ trợ người điều phối, không phải nguồn enforcement. Admin/Dispatcher xem toàn mạng; danh sách/board của Warehouse Staff vẫn scope theo origin/destination Warehouse.
- G3C2 chỉ là manual scheduling. Không có auto-scheduling, shift/payroll, route optimization, transfer scoring, automatic assignment hay shipping-fee settlement.

### LINE-HAUL SUGGESTED PLANNING (Phase G3C3)

- G3C3 là read model tư vấn deterministic `G3C3_RULES_V1`, chỉ dành cho Admin/Dispatcher. Recommendation không được lưu như quyết định, không tự tạo/schedule/READY/dispatch trip và không thay đổi WarehouseTransfer; Dispatcher phải review và bấm xác nhận.
- Input là origin, destination, thời điểm bắt đầu sớm nhất và kết thúc muộn nhất (horizon tối đa 7 ngày). Chỉ Warehouse active khác nhau, `WarehouseTransfer(PENDING)` chưa có association active, đúng route, và Shipment thực sự `AT_ORIGIN_WAREHOUSE` tại origin với destination snapshot khớp mới đi vào candidate set.
- Driver candidate bắt buộc User `DRIVER/ACTIVE`, profile không `SUSPENDED`, có `LINE_HAUL`, không giữ pickup/delivery assignment active và không chạy trip `READY|IN_TRANSIT`. Vehicle candidate bắt buộc `AVAILABLE` và có positive integer capacity hợp lệ. Mọi scheduled conflict dùng đúng half-open overlap policy G3C2; resource xung đột bị loại khỏi window tương ứng.
- Window bắt đầu từ `earliestStartAt`, bước 30 phút. Nếu route có `plannedDurationSeconds`, window duration = duration đường bộ + 30 phút xử lý, làm tròn lên 30 phút và tối thiểu 60 phút. Khi provider disabled/failure hoặc thiếu ETA, dùng fallback vận hành 180 phút và nói rõ không có ETA; missing Warehouse coordinates giữ distance/duration nullable.
- Mỗi Vehicle gom transfer theo `createdAt ASC, id ASC` (kiện chờ lâu nhất trước), bỏ qua kiện không vừa và tiếp tục xét kiện sau; không được vượt capacity. Policy này là group suggestion đơn tuyến, không phải bin packing hay multi-vehicle/network optimizer.
- Score tối đa 100 điểm: capacity utilization tối đa 45 (`round(utilization% × 0.45)`), consolidation tối đa 20 (`4 điểm/transfer`), window sớm tối đa 20 (giảm 2 điểm mỗi slot), route metric quality `10 ROAD_ROUTE | 5 HAVERSINE_FALLBACK | 0 missing coordinates`, và Driver operating-Warehouse khớp origin 5. Tie-break: score, utilization, transfer count, start time, employee code, vehicle code, Driver ID, Vehicle ID.
- Chọn recommendation chỉ prefill Create Trip bằng route/Driver/Vehicle/window/transfer IDs. `POST /line-haul/trips` khóa và revalidate Driver, Vehicle, last-mile ownership, schedule conflicts, mọi Transfer/Shipment route-state-location và tổng integer weight trong một transaction; stale recommendation rollback toàn bộ. Create chỉ trả `PLANNED`; không có automatic dispatch.
- Route provider disabled vẫn tạo suggestion bằng Haversine distance và policy duration fallback. G3C3 không có ML/AI, dynamic pricing, multi-hop, traffic prediction, shipping-fee settlement hay automatic operational transition.

### LINE-HAUL GPS POLICY (Phase G3A)

- Line-haul GPS là state tạm thời theo trip, chỉ tồn tại khi `LineHaulTrip.status = IN_TRANSIT`; lifecycle của trip vẫn lấy PostgreSQL làm source of truth. Driver được xác định từ access token, không nhận `driverId` từ client.
- Write yêu cầu User role `DRIVER` active, DriverProfile không `SUSPENDED`, có `LINE_HAUL`, sở hữu đúng `tripId` và trip đang `IN_TRANSIT`. `PLANNED`, `READY`, `ARRIVED`, `CANCELLED`, Driver khác hoặc thiếu capability đều reject và không broadcast.
- Current location dùng Redis `linehaul:trip:location:{tripId}`, TTL 20 giây, cadence 5 giây; không lưu từng GPS point vào PostgreSQL. Missing/malformed/stale/Redis-unavailable là non-current state hợp lệ, không được suy diễn tọa độ.
- Người xem: Admin/Dispatcher toàn mạng; Warehouse Staff active chỉ khi kho của họ là origin hoặc destination; Driver owner chỉ cho trip của mình khi cần UI; Customer và Driver khác không được đọc/subscribe.
- Arrival commit trước, sau đó xóa key best-effort và kết thúc Socket room. Active map lọc bằng PostgreSQL nên location cũ không thể làm trip `ARRIVED` trông như còn chạy, kể cả khi Redis cleanup tạm thời lỗi.
- G3A không có route polyline, road distance, ETA, navigation nội bộ, reroute, optimization hoặc scheduling. Các năng lực này không được suy ra từ GPS point.

### ROAD ROUTE + ETA POLICY (Phase G3B1)

- Business service chỉ gọi `RouteMetricsService`/`RouteProvider` với tọa độ đã đi qua authorization và domain scope; không có public endpoint nhận hai tọa độ tùy ý. Contract provider trả `distanceMeters`, `durationSeconds`, provider identifier và `calculatedAt`.
- Canonical mode là `ROAD_ROUTE | HAVERSINE_FALLBACK`. Road-route success có distance + planned duration; fallback chỉ có Haversine distance và **không có ETA**. Không tự cộng traffic heuristic và không gọi duration này là traffic-aware.
- Candidate pickup/delivery loại toàn bộ Driver không eligible trước khi gọi route. Batch route được pre-sort theo Haversine, giới hạn concurrency/call count và cache theo provider/mode + tọa độ làm tròn; cache Redis chỉ là optimization, không ảnh hưởng assignment ownership hay Shipment state.
- `LineHaulTrip` snapshot planned metric đúng một lần trong transition `PLANNED → READY`: `plannedDistanceMeters`, `plannedDurationSeconds?`, `routeMetricMode`, `routeProvider`, `routeCalculatedAt`. Dispatch/retry không tính lại hoặc thay đổi snapshot lịch sử. Warehouse thiếu tọa độ giữ snapshot nullable và không làm hỏng lifecycle.
- Trip detail `IN_TRANSIT` có thể tính remaining metric từ current line-haul GPS tới destination Warehouse. Chỉ `CURRENT` GPS mới được dùng; missing/stale/unavailable trả remaining metric `null`. Provider failure trả Haversine remaining distance với ETA unavailable.
- Production route provider chưa được chọn canonical nên `ROUTE_PROVIDER=DISABLED` là bắt buộc. Adapter OSRM chỉ là opt-in development/self-host evaluation; không biến public demo thành production dependency. G3B1 không có polyline, reroute, deviation detection, navigation, optimization hay automatic scheduling.

### ROUTE GEOMETRY + CONTROLLED REROUTE (Phase G3B2)

- `RouteProvider` có thể trả geometry chuẩn hóa dưới dạng ordered `{ latitude, longitude }[]`; adapter chịu trách nhiệm chuyển schema upstream. Business/UI không hiểu encoded polyline hay schema Google/Mapbox/OSRM. Geometry hợp lệ có 2–2.000 điểm; response thiếu, sai tọa độ hoặc quá giới hạn bị từ chối và không được thay bằng đường thẳng giả.
- Lần đầu `PLANNED → READY`, hệ thống tạo `LineHaulTripRoute` planned v1 cùng snapshot metric G3B1. Fallback Haversine vẫn tạo v1 với `geometry = null`; READY không phụ thuộc provider. Retry READY, cache refresh và dispatch không sửa hoặc tạo lại planned v1.
- Route history là append-only theo `(tripId, version)`. `PLANNED` chỉ có v1; reroute tạo `REROUTE` v2+ và `LineHaulTrip.currentRouteId` là nguồn authoritative duy nhất cho tuyến đang dùng. Không lưu raw provider payload hay credential.
- Deviation là operational state riêng `ON_ROUTE | DEVIATED | UNKNOWN`, không phải `LineHaulTripStatus`. Chỉ trip `IN_TRANSIT` + GPS còn current + current-route geometry mới được đánh giá. Canonical policy: khoảng cách gần nhất tới polyline vượt `LINE_HAUL_ROUTE_DEVIATION_METERS` (mặc định 500 m) trong 3 mẫu liên tiếp mới thành `DEVIATED`; một mẫu dưới ngưỡng reset counter và thành `ON_ROUTE`. GPS stale/missing, geometry thiếu hoặc Redis không chắc chắn trả `UNKNOWN`.
- G3B2 không tự reroute. Chỉ Admin/Dispatcher có command `recalculateTripRoute`: dùng GPS current đã capture làm origin và giữ nguyên destination Warehouse hiện tại. Không đổi transfer, shipment, vehicle, driver hay ownership.
- Provider call chạy ngoài transaction. Transaction commit khóa/revalidate trip vẫn `IN_TRANSIT`, actor, trip version, destination identity/coordinates và current route; GPS capture phải vẫn còn fresh. Một sample GPS mới hơn trong lúc calculate không làm sai route đã tính từ sample captured, nhưng sample captured quá TTL thì commit bị từ chối. Provider failure/timeout hoặc concurrent command không tạo fake/history thừa và không phá current route. Audit được ghi cùng route version mới; planned v1 luôn còn nguyên.
- `ROUTE_PROVIDER=DISABLED` tiếp tục là production policy: lifecycle/GPS/fallback G3B1 hoạt động, route geometry unavailable, deviation `UNKNOWN` và reroute unavailable rõ ràng. G3B2 không có turn-by-turn, automatic destination change, multi-stop/vehicle optimization, scheduling, traffic prediction hay shipping-fee settlement.

### `currentWarehouseId` semantics
- Chỉ có giá trị khi kiện hàng **đang nằm tại một kho cụ thể** (`AT_ORIGIN_WAREHOUSE`, `AT_DESTINATION_WAREHOUSE`, hoặc trước khi dispatch khi đã check-in).
- Khi transfer được **dispatch** → shipment chuyển `IN_TRANSIT` và `currentWarehouseId = null` (không thuộc inventory kho nào).
- Khi transfer được **receive** tại kho đích → `currentWarehouseId` được set lại thành kho nhận.
- Lịch sử from/to warehouse **không mất**: nằm ở entity `WarehouseTransfer` (append-only theo C05), không suy ra vị trí hiện tại từ field này khi status là `IN_TRANSIT`.

## DELIVERY
```
DELIVERY_ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
                                      ↘ DELIVERY_FAILED
```
Mỗi lần giao = 1 `DeliveryAttempt` mới (không overwrite attempt cũ). Failure reason enum: `RECIPIENT_UNAVAILABLE · RECIPIENT_REJECTED · WRONG_ADDRESS · INVALID_PHONE · ADDRESS_NOT_FOUND · VEHICLE_ISSUE · WEATHER · OTHER`.

### Driver task map and navigation

- Pickup Detail của Driver chỉ nhận task target từ pickup snapshot của assignment thuộc chính Driver đó.
- Delivery Detail trước khi có `DeliveryAttempt` dùng destination Warehouse làm task target; từ khi bắt đầu giao và có attempt, target chuyển sang receiver snapshot. Backend chọn target theo lifecycle và không trả tọa độ receiver trong payload trước khi bắt đầu giao (C01, C04).
- Tọa độ pickup/receiver là snapshot optional, phải có đủ latitude + longitude và không được tự geocode/đoán. Warehouse dùng tọa độ quan hệ Warehouse hiện tại; dữ liệu cũ thiếu tọa độ phải hiển thị trạng thái no-location trung thực.
- Vị trí Driver lấy lại từ API GPS đã được xác thực và scoped cho chính Driver. Marker stale từ 20 giây trở lên phải ẩn; nhịp gửi 5 giây, TTL 20 giây và Socket contract không thay đổi.
- “Mở chỉ đường” chỉ deep-link sang map provider ngoài. Hệ thống không tự tính tuyến đường, turn-by-turn, route distance hay ETA.

## RETURN FLOW
Delivery fail không tự kết thúc shipment. Dispatcher chọn `REDELIVERY` hoặc bắt đầu `RETURN_REQUESTED → RETURN_IN_TRANSIT → RETURNED` (có tracking history riêng).

### Return warehouse and receipt policy

- Khi Dispatcher tạo `RETURN_REQUESTED`, kho nhận hàng trả mặc định là `originWarehouseId` của Shipment. Đây là quan hệ kho lưu lúc origin check-in, **không** suy diễn từ snapshot địa chỉ.
- Dispatcher có thể chỉ định kho trả khác. Lưu override này vào `Shipment.returnWarehouseId` khi tạo `RETURN_REQUESTED`; field tồn tại sau migration phải được xem là snapshot workflow, không đổi trong lúc hàng đang trả.
- Return workflow tái sử dụng **warehouse receive authorization/idempotency pattern**, không tạo `DriverAssignmentType.RETURN`, `ShipmentProof` type mới, `WarehouseTransfer` mới, hay entity return mới. `DriverAssignment` hiện chỉ dùng cho `PICKUP|DELIVERY`.
- `RETURN_REQUESTED → RETURN_IN_TRANSIT`: chỉ driver của `DeliveryAttempt` cuối cùng có `FAILED` mới thực hiện command `start-return`. Backend xác nhận driver gọi lệnh đúng `driverId` của attempt đó, driver/user còn active, và status là `RETURN_REQUESTED` (C04). Backend còn truy vấn tường minh: không được tồn tại `DriverAssignment` `PICKUP|DELIVERY` có status active (`PENDING|ACCEPTED`) với `assignedAt` sau `completedAt` của failed attempt; nếu có, ownership đã bị assignment mới thay thế và command bị từ chối. Driver vẫn đang giữ hàng sau failed delivery nên không cần assignment mới.
- Start return chạy trong **một transaction**: conditional-version update Shipment sang `RETURN_IN_TRANSIT`, giữ `currentWarehouseId = null` suốt thời gian driver giữ hàng, tạo `TrackingEvent` public `RETURN_IN_TRANSIT` (“Return started”) và `AuditLog` internal có actor/timestamp. Retry command phải idempotent, không tạo event/audit lần hai.
- `RETURN_IN_TRANSIT → RETURNED`: chỉ `WAREHOUSE_STAFF` active, đúng scope của `returnWarehouseId`, mới được nhận. Backend kiểm tra destination warehouse trước khi transition (C04), theo cùng pattern `warehouseReceive()`; kho khác phải bị `Forbidden`.
- Nhận hàng trả chạy trong **một transaction**: set `currentWarehouseId = returnWarehouseId`, conditional-version update Shipment sang `RETURNED`, tạo `TrackingEvent` public type/status `RETURNED`, và `AuditLog` internal có actor/timestamp. `note` optional; ảnh không bắt buộc ở MVP. Retry receive khi Shipment đã `RETURNED` phải idempotent, không tạo tracking/audit lần hai.

## COD
Nếu `codAmount = 0` → không tạo COD workflow. Nếu > 0:
```
PENDING → COLLECTED → REMITTED → SETTLED
```
Exception: `DISPUTED`. Duplicate delivery request không được duplicate COD collection. Không mark `SETTLED` nếu amount mismatch.

## SHIPPING FEE RESPONSIBILITY, PAYMENT, COLLECTION & RECONCILIATION (Phase E + H1 + H2 + H3)

- `Shipment.shippingFeePayer` là historical snapshot bắt buộc khi Customer tạo vận đơn: `SENDER` = **Người gửi trả phí**, `RECEIVER` = **Người nhận trả phí**. Backend validate enum; frontend không được suy đoán payer.
- Payer chỉ xác định trách nhiệm thanh toán. Đổi `SENDER ↔ RECEIVER` với các input khác giữ nguyên không làm thay đổi quote, `totalFee`, pricing formula hoặc integer-VND rule.
- Payer được lưu trực tiếp trên Shipment và immutable sau create. Thay đổi Customer profile, saved address hoặc PricingConfig không được cập nhật payer của vận đơn cũ; Phase E không có generic endpoint hay command đổi payer.
- Migration Phase E backfill vận đơn cũ thành `SENDER` để giữ dữ liệu đầy đủ và tương thích lịch sử. Database default `SENDER` chỉ là compatibility strategy; create API vẫn bắt buộc client gửi lựa chọn rõ ràng.
- `codAmount` tiếp tục chỉ là tiền thu hộ hàng hóa. `CODTransaction.expectedAmount/collectedAmount` lấy đúng `Shipment.codAmount`, không cộng `totalFee`, kể cả khi payer là `RECEIVER`.
- Khi tạo Shipment, backend tạo đúng một `ShippingFeeTransaction.PENDING`; `payer` lấy từ `Shipment.shippingFeePayer`, còn `expectedAmount` snapshot từ `Shipment.totalFee` đã tính theo `pricingSnapshot`. Mọi amount là integer VND và không thay đổi theo pricing config tương lai.
- `SENDER`: chỉ pickup Driver active đang sở hữu `PICKUP` assignment được thu, trong cùng transaction hoàn tất pickup (`PICKUP_IN_PROGRESS → PICKED_UP`). `RECEIVER`: chỉ delivery Driver active đang sở hữu delivery assignment/attempt được thu, trong cùng transaction giao thành công (`OUT_FOR_DELIVERY → DELIVERED`). Không có action thu độc lập hay generic status update.
- Backend yêu cầu amount được gửi và bằng tuyệt đối `expectedAmount`. Amount sai, actor sai ownership/RBAC, payer sai lifecycle hoặc trạng thái fee không hợp lệ đều bị từ chối trước khi Shipment transition.
- Collection dùng conditional update `PENDING → COLLECTED`, unique `shipmentId`, actor/timestamp và `AuditLog`. Retry cùng actor/amount tại cùng business command trả kết quả đã commit mà không tạo collection/audit/POD/event thứ hai; mọi duplicate hoặc conflicting retry bị từ chối.
- Delivery thất bại không thu phí `RECEIVER`. Hủy Shipment chỉ chuyển fee còn `PENDING` sang `CANCELLED` với timestamp/audit; fee đã thu không được viết lại.
- `ShippingFeeTransaction` và `CODTransaction` là hai aggregate/ledger tách biệt. Thu phí vận chuyển không tạo, cộng tiền vào, đổi status hay sửa amount COD; delivery success vẫn tạo COD đúng bằng `Shipment.codAmount` theo policy COD hiện tại.
- Sau collection, lifecycle canonical là `COLLECTED → REMITTED → SETTLED`; `DISPUTED` là exception có kiểm soát. `CANCELLED` chỉ còn là terminal state của fee chưa thu khi Shipment bị hủy.
- Chỉ Driver đã thu khoản phí (`collectedByDriverId`) được dùng command `remit`; amount phải là positive integer VND và bằng tuyệt đối `expectedAmount/collectedAmount`. Transition lưu riêng `remittedAmount`, `remittedByDriverId`, `remittedAt` và AuditLog. Retry cùng actor/amount trả kết quả đã commit; actor/amount khác bị reject.
- Chỉ Admin dùng command `settle`, và chỉ khi transaction đang `REMITTED`, collection/remittance đều khớp tuyệt đối expected amount và không có dispute active. Transition lưu `settledById/settledAt` cùng audit; retry không tạo audit thứ hai.
- Admin có command `dispute` riêng cho `COLLECTED|REMITTED`; reason 3–500 ký tự là bắt buộc. Mỗi lần mở tạo một `ShippingFeeDispute` append-only snapshot `fromStatus`; không overwrite dispute cũ và không cho settle trực tiếp từ `DISPUTED`.
- Admin phải dùng command `resolve` với resolution note bắt buộc. Resolve đóng đúng dispute active rồi khôi phục transaction về chính `fromStatus` (`COLLECTED` hoặc `REMITTED`); sau đó lifecycle bình thường mới được tiếp tục. Mỗi lần dispute/resolve có AuditLog và retry idempotent.
- Reconciliation Admin dùng PostgreSQL aggregate theo status trên cùng payer/search scope, có phân trang/filter. Driver chỉ đọc ledger mình đã thu; Customer chỉ thấy payer, amount, status và các timestamp thanh toán cần thiết, không thấy collector/remitter/settler, dispute reason hoặc audit nội bộ.
- H3 online payment chỉ áp dụng cho shipping fee: Customer sở hữu Shipment và đúng payer được tạo payment khi lifecycle có thể hoàn tất nghĩa vụ mà không cần refund (`SENDER` ở `PICKUP_IN_PROGRESS`, `RECEIVER` ở `OUT_FOR_DELIVERY`). Flow ledger là `PENDING → PAYMENT_PENDING → PAID`; webhook thất bại đã xác thực đưa fee về `PENDING` để retry an toàn.
- Browser return/result chỉ GET trạng thái đã normalize; không được mutate hoặc mark paid. Chỉ webhook/IPN qua provider abstraction, verify signature trên raw body, exact amount, provider reference, shipment/payment ownership và replay/idempotency mới được commit `PAID`.
- `PAID` là nghĩa vụ shipping fee đã hoàn thành và được map an toàn vào pickup/delivery hiện tại: business command tiếp tục mà không thu tiền mặt. Nếu client vẫn gửi amount thu tiền cho fee đã `PAID` thì reject duplicate. COD vẫn tạo/thu/đối soát đúng `Shipment.codAmount`, hoàn toàn không bị payment shipping fee sửa đổi.
- Provider call nằm ngoài database transaction. Merchant reference và client request key là unique/idempotent; timeout giữ payment durable để retry cùng key, không mất Shipment và không tạo payment active thứ hai. PostgreSQL lưu normalized status/reference/event digest/audit, không lưu card/payment secret hay raw provider data.
- Chưa có provider canonical/credential được duyệt: production bắt buộc `PAYMENT_PROVIDER=DISABLED`; `TEST` adapter chỉ dùng development/test. H3 không làm wallet, invoice hoặc refund.

## PRICING
`POST /pricing/quote` nhận pickup/delivery/weight/dimensions/packageType/COD → trả `baseFee/distanceFee/weightFee/codFee/surcharge/discount/totalFee`.

Policy chính thức của Phase 2 (toàn bộ tiền là integer VND theo C07):

```
baseFee = 30_000                         // bao gồm 1 kg đầu
excessKg = ceil(max(0, weightGrams - 1_000) / 1_000)
weightFee = excessKg * 5_000
codFee = ceil(codAmount * 0.5%)
surcharge = 0                            // Phase 2 chưa có rule surcharge
discount = 0                             // Phase 2 chưa có rule discount
distanceFee = 0                          // distance-based pricing thuộc Optional Advanced
totalFee = baseFee + weightFee + codFee + surcharge - discount
```

Backend **luôn tính lại** khi Create Shipment, không tin phí/total từ frontend. Pricing config được version hóa ở backend/DB, không nằm trong controller; cấu hình khởi tạo phải biểu diễn đúng policy trên. Shipment lưu pricing snapshot bất biến để thay đổi config sau này không làm đổi phí lịch sử. Phase 7 tái sử dụng quy tắc làm tròn `codFee` này; Optional Advanced chỉ được thay `distanceFee` khi có policy mới được duyệt.

## TRACKING CODE
Dùng `trackingCode` (vd `SHP-20260816-A8F9C2`) cho public tracking, không expose UUID. Yêu cầu: unique, indexed, khó đoán.

## PUBLIC TRACKING
`GET /tracking/:trackingCode` chỉ trả public data. Không expose: customerId, internal audit, internal note, staff private info, cost nội bộ, driver info nhạy cảm. Có rate limit.
