# Logistics Operations

Hệ thống logistics modular monolith: Customer tạo vận đơn → Dispatcher phân công pickup → kho xuất phát → trung chuyển/line-haul → kho đích → giao hàng/thất bại/hoàn → đối soát COD và phí vận chuyển riêng biệt.

React/TypeScript/Vite ở `frontend/`; NestJS/Prisma/PostgreSQL ở `backend/`; Redis/BullMQ và Socket.IO hỗ trợ cache, GPS, thông báo. PostgreSQL là nguồn dữ liệu nghiệp vụ duy nhất. Trạng thái A–H3 và release engineering I2 ở [PROJECT_STATE.md](PROJECT_STATE.md); invariant ở [CONSTITUTION](docs/CONSTITUTION.md).

Các phase mới bao gồm phân công theo operating warehouse và GPS còn hạn, transfer create/dispatch tách biệt, đội xe và chuyến liên kho, capacity theo gram, lịch half-open chống trùng, đề xuất kế hoạch cần xác nhận, route history/deviation, shipping-fee collection/reconciliation và payment contract. COD không gộp vào phí vận chuyển.

## Development

1. Dùng Node 22 để khớp Linux CI/container release, chạy `npm ci` tại root.
2. Sao chép `.env.example` thành `.env`, đặt database **development**, secret ngẫu nhiên và URL phù hợp. Không commit `.env`.
3. `docker compose up -d redis` chỉ cung cấp Redis development, không phải cấu hình production.
4. `npm run db:generate`; migration jobs chạy Linux/container theo [runbook](docs/DEPLOYMENT.md), với `DIRECT_URL` đã kiểm tra và history preflight. Runtime dùng pooled `DATABASE_URL`. Không tắt Windows Application Control; DB development H2/H3 lệch checksum vẫn bị gate chặn.
5. Chạy `npm run dev:backend` và `npm run dev:frontend` ở hai terminal. Mặc định API `/api/v1`, frontend cổng 5173.

Đăng ký chỉ tạo CUSTOMER; không có endpoint tạo Admin công khai hoặc account/password production mặc định. Provision Admin đầu tiên phải theo quy trình quản trị đã duyệt; I1 không seed production.

## Verification

```text
npm test
npm run test:e2e --workspace backend
npm run test:browser
npm run lint
npm run typecheck
npm run build
npm audit --offline=false
npm audit --offline=false --omit=dev
git diff --check
```

E2E ghi và xóa dữ liệu fixture: chỉ dùng PostgreSQL/Redis kiểm thử riêng. Xem [TESTING](docs/TESTING.md) cho toàn bộ cases và [audit I1](docs/PRODUCTION_READINESS_I1.md) cho bằng chứng, giới hạn và script chạy cô lập. Playwright dùng Chromium, server development, GPS SIMULATION qua API thật và adapter route/payment test. Chúng không phải cấu hình triển khai.

## Production

Đọc [deployment runbook](docs/DEPLOYMENT.md) trước khi tạo release. Production bắt buộc `ROUTE_PROVIDER=DISABLED`, `PAYMENT_PROVIDER=DISABLED`, `VITE_LOCATION_MODE=REAL`. Hệ thống vẫn vận hành với khoảng cách Haversine, không có ETA/road geometry; phí vận chuyển thu/đối soát theo H1/H2, không có online checkout.

I2 bổ sung Linux CI/release gates, manifest checksum 25 migrations, Docker backend/frontend/migration artifacts và cấu hình staging. Xem [báo cáo I2](docs/RELEASE_ENGINEERING_I2.md). Staging dùng DB sạch; development H2/H3 mismatch vẫn bị chặn, không rewrite history. Chưa triển khai production; TLS/proxy thực tế, secret manager, backup/restore, SMTP và hosted CI trên release commit phải được xác minh trước promotion.
