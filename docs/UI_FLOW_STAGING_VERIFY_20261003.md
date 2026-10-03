# Staging verify-only — 2026-10-03

Kiểm tra trực tiếp khoảng 21:30–21:36 giờ Việt Nam:

- Backend: https://logistics-staging-api.onrender.com
- Frontend: https://logistics-staging-web.onrender.com
- Không sửa product code, không migration/reset/seed, không tạo transfer hoặc nhập kho.

## Kết quả

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| Backend Live SHA | UNKNOWN | `/api/v1/health/version` trả 404, cả URL thường và cache-busting |
| Frontend Live SHA | UNKNOWN | `/release.json` trả HTTP 200 nhưng content-type/text là HTML fallback, không phải metadata |
| Health / live / ready | PASS | Cả ba HTTP 200; PostgreSQL `up`, Redis `up` |
| Transfer fix | FAIL — asset Live vẫn là logic cũ | Modal vẫn giữ object, POST trực tiếp `C.destinationWarehouseId`, không có query `warehouse-transfer-context` hoặc refetch trước submit |
| Driver notification fix | FAIL — asset Live vẫn là logic cũ | Bell vẫn `onClick:()=>!e.readAt&&a.mutate(e.id)`; notification center không có task navigation |
| Dimension | FAIL | Backend vẫn `IsInt`; UI không có precision/max validation, chi tiết dưới đây |
| Staging overall | BLOCKED | Bản đang được phục vụ ở hai URL này chưa thể xác nhận là bản chứa các fixes |

Frontend entry `/assets/index-BGj12pP4.js`, 203,774 bytes, SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`; trùng fingerprint đã ghi trong báo cáo P0 trước bản sửa. Đã kiểm tra lại bằng cache-busting. Đây là **asset hash, không phải Git SHA**. Workspace HEAD `a6545a29fcab174e6f72c4af2226e0ad44a348fe` không được dùng thay Live SHA.

Các module thực tế đã đọc:

- `warehouse-workspace-page-CMNqAeHV.js`: open modal vẫn `me(e)`; submit `toWarehouseId:C.destinationWarehouseId`; `ci-width` chỉ có `min:1`, không step/max/error.
- `empty-state-De-z7GFy.js`: shared AccountLayout/NotificationBell vẫn chỉ mark-read; không có mapping `PICKUP_ASSIGNMENT_CREATED`.
- `notifications-page-hwCzdxUT.js`: chỉ mark-read/read-all, tiêu đề không mở task.

## Dimension — HTTP thật và UI thật

Khôi phục thành công session **ADMIN** qua refresh HTTP 200. Gửi bốn request tới check-in với một UUID shipment không tồn tại, cùng weight 1000 / dài 20 / cao 10. UUID hợp lệ về format nhưng lookup luôn dừng trước mutation; không dùng shipment thật để tạo check-in thử nghiệm.

| Width | Kỳ vọng validation | Response thật | Đánh giá |
|---|---|---|---|
| 14.8 | Chấp nhận | 400 `VALIDATION_FAILED`, `widthCm must be an integer number` | FAIL |
| 14.85 | Từ chối | 400 `VALIDATION_FAILED`, `widthCm must be an integer number` | Backend reject PASS; UI inline FAIL |
| 301 | Từ chối tại DTO | 404 `SHIPMENT_NOT_FOUND` | FAIL: đã vượt qua dimension validation |
| 15 | Chấp nhận | 404 `SHIPMENT_NOT_FOUND` | Validation PASS; không phải successful check-in |

Request IDs tương ứng: `ff484227-c0a5-481f-84c8-a408ef3a6f04`, `06c0b129-e6de-4c93-a931-a3705d729114`, `9f277387-5477-445d-8b2b-fe2486af3fe7`, `4dec692b-0179-44bb-8968-6a43c0a7a9e0`.

Trên Chrome thật, mở Warehouse workspace → SG01 → Kiểm hàng cho shipment có sẵn `SHP-20261003-48FF366D`, nhập lần lượt 14.8 / 14.85 / 301 / 15. Tất cả vẫn bật nút Xác nhận nhập kho, không có inline error, `step=null`, `max=null`. Đã bấm **Hủy**; capture xác nhận **0 POST nghiệp vụ** từ browser. Không giả API response.

## Giới hạn tương tác

- API read tồn kho ba kho không có shipment `AT_ORIGIN_WAREHOUSE` phù hợp để tạo transfer; không seed hay thay trạng thái để dựng case. Vì vậy kết luận Transfer FAIL dựa trên asset Live còn nguyên logic lỗi; không tuyên bố đã chạy trọn stale-destination E2E trên staging.
- Profile `auth-staging-driver` thực tế restore role CUSTOMER, nên không dùng để suy ra Driver PASS. Profile `staging-driver-browser` về login. CDP 9222 chỉ có Lenovo Vantage; 9223–9226 không hoạt động. Không có session Driver hợp lệ để click task thật. Notification FAIL là kết luận từ code thực sự đang phục vụ, không phải click E2E.
- Session Admin refresh qua luồng auth bình thường; không thay tài khoản/mật khẩu/quyền. Không đánh dấu notification đã đọc vì chưa có session Driver hợp lệ.
- Timeout backend ban đầu đã hết ở lần kiểm tra lại; không coi timeout ban đầu là readiness failure cuối cùng.

Evidence local, ignored: `test-results/ui-flow-staging-verification/{public.json,contracts.json,dimension-ui.json,browser-preflight.json}`, các module JS tải từ Live và ảnh `dimension-*.png`. Không chứa access token/password trong report.

Bước cần thiết tiếp theo: đối chiếu đúng service/branch/commit của deploy thủ công với hai URL trên; xác nhận artifact có các fixes và metadata, sau đó verify lại. Task này không tự deploy hoặc sửa code.
