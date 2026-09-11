# CONSTITUTION — Business Rules (NON-NEGOTIABLE)

## C01 — Backend Is Source Of Truth
Frontend không quyết định: role, permission, shipment status, driver assignment, warehouse transition, shipping-fee payer/status/payment/collection/remittance/settlement/dispute eligibility, COD status, line-haul capacity, schedule availability, planning recommendation hay business eligibility. Browser payment return chỉ hiển thị trạng thái; chỉ webhook/IPN đã verify mới được mark paid. Backend validate lại mọi request; percentage/progress/availability/recommendation UI không được dùng để quyết định overload, reservation hoặc manifest ownership.

## C02 — No Generic Status Update
Cấm generic status/data mutation cho Shipment, WarehouseTransfer, ShippingFeeTransaction, ShippingFeePayment, LineHaulTrip và LineHaulVehicle. Status/lịch chỉ đổi qua business command rõ nghĩa như `confirmShipment · assignPickupDriver · pickupShipment · warehouseCheckIn · dispatchTransfer · warehouseReceive · startDelivery · completeDelivery · failDelivery · create/confirmShippingFeePayment · remit/settle/dispute/resolveShippingFee · schedule/reschedule/unscheduleTrip · prepareTrip · dispatchTrip · arriveTrip · cancelLineHaulTrip · activate/markMaintenance/deactivateLineHaulVehicle`.

## C03 — Shipment Is A State Machine
Transition centralized, cấm arbitrary jump (vd `PENDING → DELIVERED` phải reject).

## C04 — Authorization = Role + Resource Scope
Không chỉ check role. Customer A không đọc được shipment Customer B. Driver chỉ thao tác shipment được assign cho mình. Warehouse Staff chỉ thao tác trong scope warehouse của mình.

## C05 — Preserve History
Không hard delete: Shipment, TrackingEvent, AuditLog, DriverAssignment, DeliveryAttempt, WarehouseTransfer, LineHaulVehicle đã có lịch sử, LineHaulTrip, LineHaulTripTransfer, CODTransaction, ShippingFeeTransaction, ShippingFeePayment, ShippingFeePaymentEvent, ShippingFeeDispute.

## C06 — Tracking ≠ Audit
`TrackingEvent` = lifecycle vận chuyển, customer xem được. `AuditLog` = internal action history, staff/admin only. Không trộn.

## C07 — Money Is Integer
VND nguyên (vd `30000`, không `30.5`). Backend tự tính phí; shipping-fee payment, collection và remittance phải bằng đúng snapshot `expectedAmount`.

## C08 — Snapshot Historical Data
Shipment snapshot: sender, receiver, addresses, package, pricing, shipping-fee payer, COD. Sửa profile/config/address sau đó không đổi shipment cũ. Line-haul snapshot manifest weight và vehicle capacity tại READY để thay đổi Fleet tương lai không viết lại bằng chứng chuyến cũ.

## C09 — Critical Commands Must Be Idempotent
Retry không tạo duplicate: delivery, COD collection, shipping-fee payment/webhook/collection/cancellation/remittance/settlement/dispute/resolve, line-haul schedule/reschedule/unschedule/READY/dispatch/arrival/receive, tracking event, assignment, notification, queue job.

## C10 — Concurrency Must Be Safe
2 staff thao tác cùng shipment không silently overwrite. Dùng Prisma transaction / conditional update / version / unique constraint / lock khi cần. Trip dispatch phải commit hoặc rollback cùng vehicle, toàn bộ WarehouseTransfer và Shipment trong manifest; không được để partial movement state.

Payment create/webhook phải khóa và revalidate payment + fee + Shipment, exact amount/payer/ownership/reference. Unique merchant/client/provider/event keys và payload digest ngăn duplicate/replay; callback terminal xung đột bị reject thay vì overwrite lịch sử.

Manifest line-haul khóa từ `READY`; chỉ `PLANNED` được đổi transfer/driver/vehicle/route/schedule. Reservation Driver/Vehicle dùng window half-open `[start,end)` và PostgreSQL exclusion constraint: overlap khi `newStart < existingEnd && newEnd > existingStart`, window liền nhau hợp lệ. Trip `PLANNED` chưa schedule không giữ tài nguyên; reservation tương lai không đổi Vehicle sang `IN_USE`.

Driver không được đồng thời thực hiện line-haul `READY|IN_TRANSIT` và pickup/delivery assignment active, kể cả profile có nhiều capability. Schedule race phải có một winner; READY/dispatch revalidate Driver/User/capability, Vehicle status/capacity, last-mile ownership và schedule conflict dưới lock. Chỉ Dispatch mới đặt Vehicle `IN_USE`.

Mọi add transfer vào cùng trip phải serialize trên trip row trước khi tính tổng tải; validation dùng integer grams và invariant `active manifest weight <= vehicle capacity`. READY/dispatch revalidate lần cuối trong transaction. Xe thiếu positive capacity không eligible; giảm Fleet capacity dưới active manifest hoặc đổi capacity khi xe `IN_USE` phải reject.

Recommendation G3C3 chỉ là read model. Create Trip từ recommendation phải khóa Driver/Vehicle/Transfers và revalidate route, transfer/shipment state, last-mile ownership, capacity cùng schedule conflict trong một transaction; stale input không được tạo trip/reservation/association một phần.

## C11 — Socket Is Delivery Mechanism Only
Không phải source of truth. Reconnect → API refetch → restore state.

## C12 — Redis Is Disposable
Mất Redis, shipment vẫn chính xác trong PostgreSQL.

## C13 — Queue Failure Must Not Corrupt Business State
Vd: Shipment DELIVERED nhưng email job fail → shipment vẫn DELIVERED, queue retry riêng.

Provider timeout/failure không được rollback hoặc xóa Shipment, không được tạo duplicate payment. External provider call không nằm trong database transaction; retry dùng cùng idempotency key.

## C14 — Thin Controllers
Controller: validate → authorize → call service/use-case → return response. Business logic không nằm trong controller.

## C15 — DTO ≠ Prisma Model
Không trả passwordHash, refreshTokenHash, internal metadata.

## C16 — No Business Logic Duplication
Một rule = một source: `ShipmentTransitionPolicy · PricingService · AssignmentPolicy · CancellationPolicy · ShippingFeesService`.

## C17 — No Core Hardcoding
Không hardcode userId, driverId, warehouseId, shipping fee, coordinates, production account.

## C18 — Tests Are Part Of Feature
Feature business-critical chưa có test = chưa DONE.

---

## ROLES

| Role | Được làm |
|---|---|
| **CUSTOMER** | register/login/logout, profile, saved addresses, quote, create shipment, xem shipment và payer/status phí vận chuyển của mình, cancel (nếu eligible), tracking, timeline, notifications. **Không**: assign driver, sửa status/fee/COD, xem audit nội bộ. |
| **DRIVER** | xem assignment, accept/reject, pickup, update location, start/complete/fail delivery, upload proof, thu phí vận chuyển đúng assignment/lifecycle, bàn giao đúng khoản phí mình đã thu, collect COD, xem history. |
| **WAREHOUSE_STAFF** | scan tracking code, check-in, verify package, ghi weight/dimensions, mark damaged, sort, tạo/xử lý transfer, check-out, xem line-haul trip thuộc kho mình, xác nhận arrival đúng kho đích và receive transfer sau arrival. |
| **DISPATCHER** | confirm shipment, xem workload và payer/status phí vận chuyển, assign/reassign driver, assign warehouse, xử lý failed delivery, schedule redelivery, start return workflow; lập/xem/hủy-before-departure, schedule/reschedule/unschedule, quản lý manifest, Mark Ready và Dispatch line-haul trip. Dispatcher không xác nhận destination arrival hoặc tự thu phí. |
| **ADMIN** | toàn bộ operational management (users, driver capabilities, line-haul fleet/trips, warehouses, pricing, shipments, shipping-fee reconciliation/dispute, COD, audit, analytics, config) nhưng **vẫn không bypass domain lifecycle**, chỉ settle fee đã `REMITTED` và không có shortcut thu phí. |
