# REALTIME — Socket, GPS, Simulation, Notifications

## SOCKET ROOMS
```
user:{userId} · shipment:{shipmentId} · shipment-location:{shipmentId} · driver:{driverId} · warehouse:{warehouseId} · dispatcher:operations · linehaul-trip:{tripId}
```
Events tối thiểu: `shipment.updated · tracking.created · assignment.created · driver.location.updated · linehaul.location.updated · linehaul.route.deviation.changed · linehaul.route.updated · linehaul.trip.ended · notification.created`.

Backend kiểm tra authorization trước khi cho join room. Payload chỉ chứa data người nhận được phép xem.

`dispatcher:operations` chỉ được backend auto-join cho `DISPATCHER|ADMIN`; client không có API để tự join. `shipment:{shipmentId}` vẫn yêu cầu ownership check trước khi join.

`linehaul.trip.subscribe` chỉ join `linehaul-trip:{tripId}` khi trip đang `IN_TRANSIT` và actor là `ADMIN|DISPATCHER`, Driver đang sở hữu trip với capability `LINE_HAUL`, hoặc Warehouse Staff active thuộc origin/destination. Customer, Driver khác và Warehouse khác luôn bị từ chối. Khi arrival commit, server phát `linehaul.trip.ended` rồi buộc toàn bộ socket rời room; reconnect phải gọi API và subscribe lại theo C11.

## DRIVER LOCATION
```
Driver GPS → React App → NestJS → Redis → Socket.io → Customer/Dispatcher Map
```
PostgreSQL không cần lưu mọi GPS point. Redis key: `driver:location:{driverId}` với TTL. Có thể persist sampled history sau này nếu cần.

Driver gửi location mỗi **5 giây**. Redis current-location key có TTL **20 giây** (4× interval): đủ chịu 2–3 nhịp gửi bị trễ hoặc mất tạm thời trên mạng di động mà không báo offline giả, nhưng vẫn coi location là stale nhanh khi driver thực sự mất kết nối. Đây là contract dùng chung cho REAL và SIMULATION provider.

Phase B tái sử dụng đúng current-location key và validation TTL này cho assignment candidate. Missing/stale/malformed/Redis-unavailable read được ánh xạ thành “không có GPS hiện tại” và loại khỏi eligibility, không phát sinh 500. Candidate reads không đổi interval 5 giây, TTL 20 giây, Socket room/event/payload hay REAL/SIMULATION provider contract.

Customer nhận tọa độ **chính xác** của driver nhưng chỉ cho Shipment do họ sở hữu và chỉ khi Shipment đang `OUT_FOR_DELIVERY`. Backend chỉ broadcast `driver.location.updated` vào room customer-only `shipment-location:{shipmentId}` sau khi xác nhận trạng thái này; room `shipment:{shipmentId}` không mang GPS để driver khác hoặc membership cũ không thể nhận vị trí. Khi `DELIVERED` hoặc `DELIVERY_FAILED` (và mọi trạng thái khác), ngừng broadcast location. Không expose vị trí pickup driver cho receiver/customer vì có thể rò vị trí người gửi. Dispatcher/Admin dùng room vận hành riêng để xem driver map.

## LINE-HAUL LOCATION (Phase G3A)

- Driver provider xác định context từ backend trước khi gửi. Active trip `PLANNED|READY|IN_TRANSIT` giữ context line-haul; chỉ `IN_TRANSIT` được POST vào endpoint trip-scoped. Nếu không có active line-haul trip, provider tiếp tục dùng endpoint last-mile hiện có. Một sample không bao giờ được fan-out sang cả hai context.
- Redis key canonical: `linehaul:trip:location:{tripId}`; payload lưu `tripId`, `driverId` phục vụ ownership/debug nội bộ, `latitude`, `longitude`, `capturedAt`; TTL vẫn là **20 giây**, nhịp gửi vẫn **5 giây**. Không persist GPS point vào PostgreSQL.
- `linehaul.location.updated` chỉ phát vào `linehaul-trip:{tripId}` sau khi Redis `SET EX 20` thành công. Payload public chỉ có `tripId`, `latitude`, `longitude`, `capturedAt`; không có Driver/User/Shipment/customer data.
- Map API chỉ query trip `IN_TRANSIT` từ PostgreSQL rồi ghép current Redis state. Kết quả phân biệt `CURRENT|MISSING|STALE|UNAVAILABLE`; stale từ 20 giây trở lên không có current marker. Trip ngoài `IN_TRANSIT` đọc riêng trả `DISABLED`. Redis read failure là state `UNAVAILABLE`, không HTTP 500.
- Arrival là lifecycle source of truth: sau transaction `IN_TRANSIT → ARRIVED` commit, service best-effort xóa key, phát `linehaul.trip.ended` và evict room. Dù Redis delete fail, API active map không còn trả trip và mọi write mới bị backend reject; key còn sót tự hết hạn theo TTL.
- Dispatcher/Admin xem toàn bộ active line-haul; Warehouse Staff chỉ xem trip có origin hoặc destination đúng WarehouseProfile; Customer và unrelated Driver/Warehouse không có quyền read/subscribe.

## BASIC LINE-HAUL ETA (Phase G3B1)

- Planned Warehouse → Warehouse duration/distance là snapshot PostgreSQL khi trip chuyển `READY`; đây không phải realtime state và Socket không được dùng làm source of truth.
- Khi trip `IN_TRANSIT`, trip detail có thể ghép current GPS hợp lệ với destination Warehouse rồi gọi route abstraction để trả remaining distance và `ETA dự kiến`. Kết quả road provider được cache ngắn hạn; Haversine fallback không có ETA.
- G3B1 không thêm Socket event ETA, không broadcast provider identifier, không tạo traffic heuristic và không đổi cadence 5 giây/TTL 20 giây của GPS. UI refetch detail 20 giây khi cần; G3B2 mới xử lý polyline/rerouting.

## LINE-HAUL ROUTE STATE (Phase G3B2)

- Mỗi GPS write hợp lệ tái sử dụng current route geometry đã snapshot. Khoảng cách tới segment polyline gần nhất được tính ở backend; React chỉ render state đã authorize. Redis key `linehaul:trip:deviation:{tripId}:route:{version}` giữ counter + current operational state với TTL 60 giây và không thay PostgreSQL route history.
- `linehaul.route.deviation.changed` chỉ phát khi state thật sự đổi, không phát mỗi sample. Payload: `{ tripId, state, distanceFromRouteMeters, detectedAt }`. Ba sample liên tiếp vượt ngưỡng canonical mới chuyển `DEVIATED`; sample về tuyến chuyển `ON_ROUTE`; reroute đang có state xác định phát reset `UNKNOWN`.
- `linehaul.route.updated` chỉ là invalidate/refetch signal nhỏ `{ tripId, routeVersion, calculatedAt }`; geometry tối đa 2.000 điểm không được fan-out qua Socket. Client refetch authorized trip/location detail rồi thay polyline mà không reload trang.
- Cả hai event chỉ đi vào room `linehaul-trip:{tripId}`, kế thừa chính xác scope G3A: Admin, Dispatcher, Warehouse Staff origin/destination và owning LINE_HAUL Driver. Customer, unrelated Warehouse/Driver không join nên không nhận operational route data.
- Provider disabled/timeout không tạo route/deviation event giả. GPS và `linehaul.location.updated` vẫn hoạt động; geometry unavailable và deviation `UNKNOWN` là trạng thái hợp lệ.

## LOCATION SIMULATION (dev only)
Modes: `REAL | SIMULATION` (env `VITE_LOCATION_MODE`). Simulator có: route, start, pause, resume, stop, speed 1x/2x/5x. Quan trọng: simulation vẫn đi qua **cùng API, cùng Redis, cùng Socket, cùng Map** — không bypass backend. Production không hiện simulator.

Trong G3A, simulator tái sử dụng provider này và chọn endpoint theo backend context; nó không inject marker trực tiếp và không tạo route polyline/ETA.

## NOTIFICATIONS
Channels: `IN_APP · EMAIL`. Events: shipment created/confirmed, driver assigned, picked up, warehouse arrived, out for delivery, delivered, delivery failed, return started. In-app hỗ trợ unread count, list, mark read/mark all read, realtime qua Socket.io. Email chạy qua BullMQ.
