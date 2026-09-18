# UI — Constitution, Components, Screens

## MANDATORY SKILL
Mọi task UI/UX/page/component/layout/responsive/dashboard/form/modal/table/navigation/color/typography/spacing/accessibility → dùng skill `$ui-ux-pro-max` (Codex Skills, path `.agents/skills/ui-ux-pro-max/`) trước khi thiết kế/sửa. Gõ thẳng `$ui-ux-pro-max` trong prompt để kích hoạt explicit, hoặc để Codex tự nhận diện implicit khi câu lệnh khớp mô tả skill. Không tự bịa rule ngoài những gì skill trả về + rule đã ghi ở file này.

## UI GOAL
Professional, modern, clean, responsive, consistent, accessible, production-oriented — không cảm giác template sinh viên.

## APP DESIGN SYSTEM

- **Style:** Minimalism & Swiss Style — Operational Swiss; variance `2/10`, motion `2/10`, density `8/10`.
- **Typography:** Inter cho heading/body, system sans-serif fallback; weight `400/500/600/700`; scale `12/14/16/18/24/32px`; số liệu dùng `tabular-nums`.
- **Core palette:** primary `#2563EB`, primary strong `#1E40AF`, operational attention/COD `#EA580C`, background `#EFF6FF`, surface `#FFFFFF`, ink `#0F172A`, muted foreground `#475569`, border `#E2E8F0`, focus ring `#2563EB`, destructive `#DC2626`.
- **Spacing:** lưới 4px — `4/8/12/16/24/32/48/64px`; khoảng cách giữa touch target tối thiểu `8px`; control Driver mobile tối thiểu `48px`.
- **Shape/elevation:** control radius `8px`, surface `12px`, overlay `16px`, pill `9999px`; card ưu tiên border, shadow chỉ dùng nhẹ cho dropdown/modal.
- **Motion:** feedback `150ms`, overlay `200ms`; chỉ animate color/opacity/transform và luôn hỗ trợ `prefers-reduced-motion`.

## RESPONSIVE
Kiểm tra Mobile/Tablet/Desktop bắt buộc. Driver UI = mobile-first. Admin/Dispatcher/Warehouse = desktop-first nhưng vẫn responsive.

## SHARED COMPONENTS (ưu tiên tái dùng, không copy UI trùng)
```
Button · Input · Select · Modal · ConfirmDialog · DataTable · Pagination
StatusBadge · EmptyState · ErrorState · LoadingState · PageHeader
SearchFilter · NotificationBell · Timeline · Map
```

### LocationPicker

- `features/locations/location-picker.tsx` là shared/reusable picker của Customer Address và form dùng chung Create Shipment/Báo giá. Reuse `LocationMap` và Leaflet/tile setup hiện có, không khởi tạo Leaflet riêng trong từng form.
- Interaction canonical: **Chọn vị trí trên bản đồ → click map → marker → drag chỉnh vị trí → Xác nhận vị trí → readonly selected coordinate → Thay đổi vị trí**. Hủy giữ giá trị đã xác nhận. Main form không có trường latitude/longitude chỉnh tay; delivery location vẫn tùy chọn theo DOMAIN.
- Dùng semantic tokens, layout responsive, loading/error text và retry bằng đóng/mở picker. Keyboard: focus bản đồ, phím mũi tên pan, Enter chọn tâm; click map là phương án thay thế drag. Không dùng chuyển động bản đồ bắt buộc; giữ label, focus và trạng thái disabled của shared Button.

### STATUSBADGE — CANONICAL COLOR MAPPING

Đây là **nguồn duy nhất** cho màu `StatusBadge` trên toàn app. Implementation phải tra đúng key tại shared component, không tự gán màu trong từng screen. Mỗi badge luôn hiển thị nhãn chữ và chấm trạng thái; màu không được là tín hiệu duy nhất. Các class dưới đây là tổ hợp cố định `background / text / border / dot`.

Return workflow dùng **amber**; operational attention và COD dùng **orange**; shipping-fee pending dùng **indigo** để khoản phí này không bị đọc nhầm là COD. Không đổi các nhóm này thành cùng hue. `DAMAGED` và `LOST` là exception state canonical từ `docs/DOMAIN.md`; mapping UI không cấp quyền tạo transition mới.

Tên enum giống nhau không bắt buộc cùng một shade nếu mức độ ưu tiên nghiệp vụ khác nhau. `WarehouseTransfer.PENDING` và `CODTransaction.PENDING` cùng dùng orange để giữ nghĩa “cần theo dõi”, nhưng transfer dùng shade đậm hơn vì là hàng chờ thao tác vận hành trực tiếp; COD pending là trạng thái tài chính ban đầu nên nhẹ hơn. `WarehouseTransfer.IN_TRANSIT` dùng lại sky của Shipment `IN_TRANSIT` để giữ nhất quán ngữ nghĩa trung chuyển. Badge luôn có nền nhạt, nhãn chữ và dot nên không bị hiểu nhầm với primary blue dùng cho link/nút/focus.

#### Shipment lifecycle

| Status | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `PENDING` | Chờ xác nhận | `bg-amber-50` | `text-amber-800` | `border-amber-200` | `bg-amber-400` |
| `CONFIRMED` | Đã xác nhận | `bg-blue-50` | `text-blue-800` | `border-blue-200` | `bg-blue-400` |
| `AWAITING_PICKUP_ASSIGNMENT` | Chờ phân công lấy hàng | `bg-indigo-50` | `text-indigo-800` | `border-indigo-200` | `bg-indigo-400` |
| `PICKUP_ASSIGNED` | Đã phân công lấy hàng | `bg-violet-50` | `text-violet-800` | `border-violet-200` | `bg-violet-400` |
| `PICKUP_IN_PROGRESS` | Đang lấy hàng | `bg-cyan-50` | `text-cyan-900` | `border-cyan-200` | `bg-cyan-500` |
| `PICKED_UP` | Đã lấy hàng | `bg-emerald-50` | `text-emerald-800` | `border-emerald-200` | `bg-emerald-400` |
| `AT_ORIGIN_WAREHOUSE` | Tại kho xuất phát | `bg-teal-50` | `text-teal-800` | `border-teal-200` | `bg-teal-400` |
| `IN_TRANSIT` | Đang trung chuyển liên kho | `bg-sky-100` | `text-sky-900` | `border-sky-300` | `bg-sky-500` |
| `AT_DESTINATION_WAREHOUSE` | Tại kho đích | `bg-teal-100` | `text-teal-900` | `border-teal-300` | `bg-teal-500` |
| `AWAITING_DELIVERY_ASSIGNMENT` | Chờ phân công giao hàng | `bg-indigo-100` | `text-indigo-900` | `border-indigo-300` | `bg-indigo-500` |
| `DELIVERY_ASSIGNED` | Đã phân công giao hàng | `bg-violet-100` | `text-violet-900` | `border-violet-300` | `bg-violet-500` |
| `OUT_FOR_DELIVERY` | Đang giao hàng | `bg-cyan-100` | `text-cyan-950` | `border-cyan-300` | `bg-cyan-600` |
| `DELIVERED` | Đã giao thành công | `bg-emerald-100` | `text-emerald-900` | `border-emerald-300` | `bg-emerald-600` |
| `DELIVERY_FAILED` | Giao chưa thành công | `bg-orange-500` | `text-slate-950` | `border-orange-600` | `bg-slate-950` |
| `RETURN_REQUESTED` | Đã yêu cầu hoàn | `bg-amber-200` | `text-amber-950` | `border-amber-400` | `bg-amber-600` |
| `RETURN_IN_TRANSIT` | Đang hoàn hàng | `bg-amber-300` | `text-amber-950` | `border-amber-500` | `bg-amber-700` |
| `RETURNED` | Đã hoàn hàng | `bg-amber-100` | `text-amber-900` | `border-amber-300` | `bg-amber-700` |
| `CANCELLED` | Đã hủy | `bg-slate-100` | `text-slate-700` | `border-slate-300` | `bg-slate-500` |
| `DAMAGED` | Hàng hư hỏng | `bg-red-100` | `text-red-900` | `border-red-300` | `bg-red-600` |
| `LOST` | Thất lạc | `bg-red-600` | `text-white` | `border-red-700` | `bg-white` |

#### Warehouse transfer status

| Status | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `PENDING` | Chờ xuất kho | `bg-orange-100` | `text-orange-900` | `border-orange-300` | `bg-orange-500` |
| `IN_TRANSIT` | Đang trung chuyển | `bg-sky-100` | `text-sky-900` | `border-sky-300` | `bg-sky-500` |
| `COMPLETED` | Đã tiếp nhận | `bg-emerald-100` | `text-emerald-900` | `border-emerald-300` | `bg-emerald-600` |
| `CANCELLED` | Đã hủy | `bg-slate-100` | `text-slate-700` | `border-slate-300` | `bg-slate-500` |

#### Line-haul vehicle status

| Status | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `AVAILABLE` | Sẵn sàng | `bg-emerald-100` | `text-emerald-900` | `border-emerald-300` | `bg-emerald-600` |
| `IN_USE` | Đang khai thác | `bg-sky-100` | `text-sky-900` | `border-sky-300` | `bg-sky-500` |
| `MAINTENANCE` | Bảo trì | `bg-orange-100` | `text-orange-900` | `border-orange-300` | `bg-orange-500` |
| `INACTIVE` | Ngừng khai thác | `bg-slate-100` | `text-slate-700` | `border-slate-300` | `bg-slate-500` |

#### Line-haul trip status

| Status | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `PLANNED` | Đã lập kế hoạch | `bg-blue-50` | `text-blue-800` | `border-blue-200` | `bg-blue-500` |
| `READY` | Sẵn sàng xuất phát | `bg-indigo-100` | `text-indigo-900` | `border-indigo-300` | `bg-indigo-500` |
| `IN_TRANSIT` | Đang chạy tuyến | `bg-sky-100` | `text-sky-900` | `border-sky-300` | `bg-sky-500` |
| `ARRIVED` | Đã đến kho đích | `bg-emerald-100` | `text-emerald-900` | `border-emerald-300` | `bg-emerald-600` |
| `CANCELLED` | Đã hủy | `bg-slate-100` | `text-slate-700` | `border-slate-300` | `bg-slate-500` |

#### COD status

| Status | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `PENDING` | Chờ thu COD | `bg-orange-50` | `text-orange-800` | `border-orange-200` | `bg-orange-400` |
| `COLLECTED` | Đã thu COD | `bg-orange-100` | `text-orange-900` | `border-orange-300` | `bg-orange-500` |
| `REMITTED` | Tài xế đã nộp COD | `bg-orange-200` | `text-orange-950` | `border-orange-400` | `bg-orange-600` |
| `SETTLED` | Đã quyết toán COD | `bg-emerald-100` | `text-emerald-900` | `border-emerald-300` | `bg-emerald-600` |
| `DISPUTED` | COD đang tranh chấp | `bg-red-600` | `text-white` | `border-red-700` | `bg-white` |

#### Shipping fee status

| Status | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `PENDING` | Chờ thu phí vận chuyển | `bg-indigo-50` | `text-indigo-800` | `border-indigo-200` | `bg-indigo-500` |
| `PAYMENT_PENDING` | Đang chờ xác nhận thanh toán | `bg-violet-50` | `text-violet-800` | `border-violet-200` | `bg-violet-500` |
| `PAID` | Đã thanh toán trực tuyến | `bg-teal-50` | `text-teal-800` | `border-teal-200` | `bg-teal-500` |
| `COLLECTED` | Đã thu phí vận chuyển | `bg-emerald-100` | `text-emerald-900` | `border-emerald-300` | `bg-emerald-600` |
| `REMITTED` | Tài xế đã bàn giao phí | `bg-blue-100` | `text-blue-900` | `border-blue-300` | `bg-blue-600` |
| `SETTLED` | Đã đối soát phí vận chuyển | `bg-teal-100` | `text-teal-900` | `border-teal-300` | `bg-teal-600` |
| `DISPUTED` | Phí vận chuyển đang tranh chấp | `bg-red-600` | `text-white` | `border-red-700` | `bg-white` |
| `CANCELLED` | Đã hủy thu phí | `bg-slate-100` | `text-slate-700` | `border-slate-300` | `bg-slate-500` |

#### Delivery failure reason

| Reason | Nhãn | Background | Text | Border | Dot |
|---|---|---|---|---|---|
| `RECIPIENT_UNAVAILABLE` | Không liên hệ được người nhận | `bg-amber-50` | `text-amber-800` | `border-amber-200` | `bg-amber-400` |
| `RECIPIENT_REJECTED` | Người nhận từ chối | `bg-red-50` | `text-red-800` | `border-red-200` | `bg-red-400` |
| `WRONG_ADDRESS` | Sai địa chỉ | `bg-violet-50` | `text-violet-800` | `border-violet-200` | `bg-violet-400` |
| `INVALID_PHONE` | Số điện thoại không hợp lệ | `bg-rose-50` | `text-rose-800` | `border-rose-200` | `bg-rose-400` |
| `ADDRESS_NOT_FOUND` | Không tìm thấy địa chỉ | `bg-violet-200` | `text-violet-950` | `border-violet-400` | `bg-violet-600` |
| `VEHICLE_ISSUE` | Sự cố phương tiện | `bg-orange-100` | `text-orange-900` | `border-orange-300` | `bg-orange-500` |
| `WEATHER` | Thời tiết không phù hợp | `bg-sky-100` | `text-sky-900` | `border-sky-300` | `bg-sky-500` |
| `OTHER` | Lý do khác | `bg-slate-100` | `text-slate-700` | `border-slate-300` | `bg-slate-500` |

## MỌI ASYNC UI PHẢI XỬ LÝ
`loading · error · empty · success · disabled` (+ retry nếu phù hợp). Không chỉ làm happy path.

---

## MAIN SCREENS THEO ROLE

| Role | Screens |
|---|---|
| Customer | Login/Register, Dashboard, Create Shipment, Shipping Quote, My Shipments, Shipment Detail, Tracking, Saved Addresses, Notifications, Profile |
| Driver | Dashboard, Assignments, Pickup Detail, Delivery Detail, Map, Proof Of Delivery, Failed Delivery, Delivery History, Shipping Fee Remittance, Profile |
| Warehouse | Dashboard, Inbound, Scan Shipment, Check-in, Sorting, Outbound, Transfers, Inbound Line-haul Trips, Exceptions |
| Dispatcher | Dashboard, Shipments, Pickup Assignment, Delivery Assignment, Driver Availability, Driver Map, Line-haul Trips, Failed Deliveries, Returns, Exceptions |
| Admin | Dashboard, Shipments, Users, Drivers + Capabilities, Line-haul Vehicles/Trips, Warehouses, Pricing, Shipping Fee Reconciliation, COD, Audit Logs, Analytics |

### Shipping fee collection UI (Phase H1)

- Customer Shipment Detail và Dispatcher/Admin Operational Shipment Detail luôn hiển thị surface **Phí vận chuyển** với payer, `expectedAmount`, status và thời điểm thu nếu có. Surface **COD** đứng riêng, dùng đúng nhãn/số tiền/trạng thái COD; không cộng hoặc trình bày thành một khoản chung.
- Driver chỉ thấy input/action thu phí khi backend trả `availableActions.collectShippingFee = true`: SENDER ở Pickup Detail, RECEIVER ở Proof of Delivery. UI không tự suy diễn quyền từ payer/status/assignment.
- Amount là controlled numeric input có label đơn vị VND. Submit disabled khi rỗng/sai; blur hiển thị inline “Số tiền phải đúng …”; backend vẫn validate tuyệt đối. Form dùng semantic `onSubmit`, pending label và ngăn double-submit.
- Pickup/delivery success refetch response authoritative và hiển thị status đã thu. Delivery failed không render action thu RECEIVER fee. Driver mobile giữ control tối thiểu 48px, không overflow ngang; trạng thái có chữ + dot, không dựa riêng vào màu.

### Shipping fee remittance & reconciliation UI (Phase H2)

- Driver route **Bàn giao phí** chỉ đọc ledger backend-scoped theo collector. Khoản `COLLECTED` mới có action bàn giao; modal yêu cầu nhập lại exact integer VND, có validation blur/inline, pending/disabled/error/success và control tối thiểu 48px. `DISPUTED` hiện reason để Driver biết khoản đang bị giữ, nhưng không lộ actor/audit không cần thiết.
- Admin route **Đối soát phí vận chuyển** có search mã vận đơn/tên-email-mã tài xế, filter status/payer, phân trang và summary tổng tiền/số giao dịch theo status. Summary dùng tối đa 3 cột desktop để badge dài không tràn; bảng chuyển thành card trên mobile.
- Mỗi row Admin hiển thị shipment, payer + tên bên trả, collector/remitter, expected/remitted amount, status, collected/remitted/settled timestamps. Số tiền dùng tabular figures; màu luôn đi cùng nhãn.
- Chỉ row `REMITTED` có **Đối soát** và dùng ConfirmDialog. `COLLECTED|REMITTED` có **Tranh chấp** với reason bắt buộc; `DISPUTED` chỉ có **Giải quyết** với resolution note. UI luôn refetch backend authoritative sau command và không tự đổi status optimistic.
- Customer Shipment Detail chỉ thêm remitted/settled timestamp khi có; không render collector/remitter/settler, dispute reason hay AuditLog. Surface Shipping Fee dùng indigo/blue/teal, còn COD giữ orange để hai ledger không bị đọc nhầm.

### Online shipping-fee payment UI (Phase H3)

- Customer Shipment Detail chỉ hiện **Thanh toán phí vận chuyển** khi API authoritative xác nhận Customer sở hữu Shipment, là đúng `SENDER|RECEIVER`, fee `PENDING` và lifecycle eligible. CTA tối thiểu 48px, ghi rõ exact VND; pending khóa double-submit và lỗi có retry.
- Payment Result là route Customer-protected, đọc `reference` rồi poll GET normalized status. Trang hiển thị rõ đang chờ/thành công/thất bại; browser return không gọi mutation hoặc tự suy diễn thành công từ query string.
- Sau khi thấy `SUCCEEDED`, UI invalidate/refetch shipment và hiển thị badge `PAID` cùng `paidAt`. Nếu provider callback còn pending, UI nói rõ có thể quay lại sau; reference dài dùng wrapping và mobile không overflow ngang.
- Dispatcher/Admin chỉ thấy normalized shipping-fee status, online paid amount/time trong surface/ledger hiện có. Không render provider reference, signature, secret hoặc raw provider payload. COD UI, nhãn, amount và actions giữ nguyên.

### Line-haul G2 operational UI

- Trip Detail luôn hiển thị trip code, origin → destination, Driver, vehicle, manifest count, transfer/shipment/package, status và planned/departed/arrived timestamps.
- Action lấy từ `availableActions` backend: `PLANNED` cho sửa manifest/Mark Ready/Cancel; `READY` cho Dispatch/Cancel; `IN_TRANSIT` read-only; `ARRIVED` hiển thị receive progress và receive per transfer cho actor đúng scope.
- Mark Ready, Dispatch, Arrival và Receive đều có confirmation, pending label và disabled state trong lúc request. UI refetch state authoritative sau success/error; không tự suy diễn eligibility hoặc chỉ filter ở frontend.
- Warehouse Staff có danh sách line-haul inbound/outbound scoped theo profile, mở manifest bằng business identifier thay vì nhập UUID. Origin workspace không standalone-dispatch transfer đã gắn trip; destination chỉ cho receive transfer gắn trip sau `ARRIVED`.
- Arrival progress dùng `X/Y kiện đã nhận`; progress bar chỉ bổ trợ và luôn có text. Trip arrival và package receive là hai hành động/feedback tách biệt.

### Line-haul G3A realtime map UI

- Driver có route mobile-first **Chuyến liên kho**: trip code, origin → destination, vehicle, departure, canonical status badge, current vehicle marker và origin/destination markers. GPS controls tối thiểu 48px; `PLANNED|READY` hiển thị disabled rõ ràng.
- Dispatcher/Admin có operational line-haul map toàn mạng; Warehouse Staff dùng cùng component nhưng API chỉ trả trip liên quan kho. Danh sách cạnh map luôn có trip code, Driver, vehicle, route, departure/captured time và freshness text.
- Current marker chỉ render khi payload trẻ hơn 20 giây. `MISSING`, `STALE`, `UNAVAILABLE`, loading và empty dùng text + surface semantic, không dùng màu đơn độc; stale marker phải ẩn.
- Socket là update chính, API refresh 20 giây là reconnect/fallback. Arrival event loại trip khỏi map ngay; UI refetch API authoritative.
- Map tái sử dụng `LocationMap`; origin/vehicle/destination có marker tone và legend chữ riêng. Không render route polyline, road distance hoặc ETA trong G3A.

### Route metric UI (Phase G3B1)

- Pickup/Delivery candidate option hiển thị Driver name + distance + `Thời gian dự kiến` khi backend trả `ROAD_ROUTE`. Road success dùng nhãn dễ hiểu **“đường bộ”**; fallback dùng **“khoảng cách ước tính”** và không render ETA.
- Không hiển thị enum `ROAD_ROUTE|HAVERSINE_FALLBACK` hay technical provider identifier cho Dispatcher. Source luôn có nhãn chữ, không dựa vào màu; option giữ một dòng khi trình duyệt cho phép và dùng stable Driver ID làm key/value.
- Trip Detail có surface riêng cho snapshot kho xuất phát → kho đích: planned distance, `Thời gian dự kiến`, source và calculated time. Khi `IN_TRANSIT`, surface thứ hai hiển thị remaining distance + `ETA dự kiến`; missing/stale GPS hoặc thiếu tọa độ có empty text rõ ràng.
- Fallback phải hiện “Route provider không khả dụng; không có ETA”; không dùng dấu gạch/0 phút để giả duration. Detail refetch mỗi 20 giây khi trip đang chạy, giữ layout responsive và không thêm polyline trong G3B1.

### Line-haul route UI (Phase G3B2)

- Shared `LocationMap` nhận normalized polyline points: tuyến hiện tại là đường liền primary; planned v1 cũ là nét đứt muted sau reroute. Origin, destination và current vehicle markers luôn có label riêng. Nếu geometry unavailable, chỉ render markers và text chính xác `Chưa có dữ liệu tuyến đường`; tuyệt đối không nối origin/destination bằng đường thẳng giả.
- Dispatcher/Admin detail và operations map hiển thị freshness, remaining distance/ETA khi có, route state bằng text + color, khoảng cách khỏi tuyến và detected time. Warehouse dùng cùng map/read model nhưng backend chỉ trả trip thuộc origin/destination scope và không cấp reroute action.
- Owning Driver mobile khi `IN_TRANSIT` thấy current location, destination, current polyline và `Đúng tuyến | Lệch tuyến | Chưa xác định trạng thái tuyến`; đây không phải turn-by-turn navigation. Controls giữ tối thiểu 48px, map/simulator không được overlay hoặc che CTA.
- `Lệch tuyến` mới mở action `Tính lại tuyến` cho Admin/Dispatcher. Action dùng `ConfirmDialog`, pending/disabled/error/success feedback rõ ràng. Khi provider disabled, button không khả dụng và UI giải thích bằng ngôn ngữ sản phẩm, không hiển thị enum/provider identifier thô.
- Sau `linehaul.route.updated`, client refetch detail và thay polyline realtime; history liệt kê v1 `Tuyến kế hoạch`, v2+ `Tuyến tính lại`, đánh dấu route đang dùng. Không tải geometry lớn trực tiếp qua Socket.

### Line-haul capacity UI (Phase G3C1)

- Trip Create/Detail hiển thị xe, sức tải, manifest hiện tại, còn lại và `% tải` từ backend. UI format grams thành kg theo `vi-VN`; không bắt người vận hành đọc raw grams và không dùng percentage để quyết định overload.
- Shared `CapacityIndicator` luôn có text `Còn sức tải | Gần đầy | Đầy tải | Quá tải | Chưa cấu hình`, số `current / capacity`, remaining/overage và accessible progressbar. Mốc gần đầy 80% chỉ là presentation; màu không phải tín hiệu duy nhất.
- Eligible transfer option hiển thị transfer/tracking code + load weight. Candidate backend báo không fit được disable và gắn chữ `Vượt sức tải`; submit vẫn gọi backend validation để xử lý stale response/concurrency bằng actionable error.
- Warehouse origin list/detail hiển thị số kiện, tổng weight, vehicle capacity và trạng thái capacity theo cùng component read-only; Warehouse Staff không có Fleet/manifest mutation shortcut.
- Admin Fleet create/edit nhận kg dễ đọc, chỉ chấp nhận tối đa 3 chữ số thập phân và normalize chính xác sang integer grams. Capacity edit disabled khi `IN_USE`; backend vẫn là enforcement authoritative.
- READY hiển thị prepared weight/capacity snapshot, khóa add/remove controls và giữ layout không tràn ngang ở Dispatcher desktop lẫn Warehouse mobile.

### Line-haul scheduling UI (Phase G3C2)

- Dispatcher/Admin Trip Detail dùng hai input có label `Bắt đầu`/`Kết thúc` kiểu local date-time. End phải sau start; validation, pending, error summary và success feedback đều có text rõ ràng. UI gọi đúng command `Lên lịch | Đổi lịch | Gỡ lịch`, không dùng generic update.
- Khi window hợp lệ, hai danh sách hiển thị Driver và Vehicle bằng business identifier, trạng thái chữ `Rảnh | Bận | Không khả dụng`, conflict trip/time và tài nguyên đang gán. Không nhập hoặc hiển thị UUID như dữ liệu vận hành; nút submit disabled nếu tài nguyên đã gán không còn rảnh, nhưng backend vẫn revalidate khi submit.
- Half-open window `[bắt đầu,kết thúc)` được giải thích ngắn gọn để người điều phối hiểu hai chuyến liền nhau hợp lệ. Future reservation không hiển thị Vehicle như đang chạy; `IN_USE` chỉ xuất hiện sau Dispatch.
- Schedule board dùng bộ lọc ngày và bảng compact gồm ngày, trip, tuyến, Driver, Vehicle, start/end, status. Admin/Dispatcher xem toàn mạng; Warehouse Staff dùng cùng read surface nhưng API chỉ trả trip có origin/destination thuộc kho của họ.
- Loading/error/retry/empty state dùng shared components; danh sách availability có scroll bounded, bảng có horizontal overflow nội bộ khi cần và toàn trang không tràn ở mobile. Màu luôn đi cùng nhãn trạng thái.

### Line-haul suggested planning UI (Phase G3C3)

- Section **Đề xuất kế hoạch** nằm trong workspace Line-haul của Dispatcher/Admin, có input kho xuất phát, kho đích, bắt đầu sớm nhất và kết thúc muộn nhất với label thật, validation inline/error summary và loading/error/retry/empty state đầy đủ.
- Mỗi recommendation card hiển thị hạng + score, Driver, Vehicle, departure window, `CapacityIndicator`, số/mã/weight transfer, distance, duration/ETA nếu có và toàn bộ lý do/điểm do backend trả. Provider disabled/missing ETA phải ghi rõ; không hiển thị provider identifier kỹ thuật.
- `Dùng đề xuất này` là button có `aria-pressed`, chỉ prefill form **Lập chuyến mới**. Surface prefill nhắc lại window và transfer count; người dùng có thể bỏ đề xuất hoặc sửa field (sửa field sẽ bỏ prefill plan để tránh submit nhầm dữ liệu cũ).
- Submit luôn mở `ConfirmDialog`, nói rõ backend sẽ revalidate và không automatic dispatch. Pending disabled, success điều hướng tới Trip Detail authoritative, stale-data error giữ recovery path để Dispatcher tải đề xuất mới.
- Card reflow một cột ở mobile, hai cột khi đủ rộng; số dùng tabular figures, text reason không truncate, màu không là tín hiệu duy nhất, control tối thiểu 44px và không dùng animation cuộn bắt buộc.

## DASHBOARD METRICS (minimum)
```
Total Shipments · Pending · In Transit · Out For Delivery · Delivered
Failed · Cancelled · Delivery Success Rate · Average Delivery Time
COD Collected · COD Unsettled
```
Tính bằng PostgreSQL aggregate query (không load hết data về Node). Chart dùng Recharts.
