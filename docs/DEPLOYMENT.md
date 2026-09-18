# Deployment runbook — Phase I2 staging preparation

I2 chuẩn bị release engineering, không thêm feature và không deploy production. Baseline ứng dụng ở [PRODUCTION_READINESS_I1.md](PRODUCTION_READINESS_I1.md); điều tra migration và kết quả I2 ở [RELEASE_ENGINEERING_I2.md](RELEASE_ENGINEERING_I2.md). Không promote khi bất kỳ gate nào fail hoặc chưa có bằng chứng.

## Release topology and infrastructure

- **Một NestJS instance** trong release đầu tiên. Gateway hiện dùng room/adapter trong process; không có Redis Socket.IO adapter cho nhiều instance. Sticky sessions không thay thế fan-out liên instance và không bảo đảm rate-limit tập trung lúc Redis hỏng. Không scale ngang trước khi giải quyết hai giới hạn này.
- PostgreSQL/Neon riêng cho production; pooled runtime connection, direct migration connection, TLS certificate verification, quyền tối thiểu cho runtime. Migration role cần quyền DDL và `btree_gist` (G3C2). Thiết lập backup/PITR và diễn tập restore trước release.
- Managed Redis standalone tương thích Redis/BullMQ (TCP, Lua, blocking commands, database/key access), policy `noeviction`, TLS `rediss://` và ACL phù hợp. Redis Cluster và HTTP-only endpoint chưa được hỗ trợ/kiểm thử. Giới hạn mạng; queue có reset token còn hạn nên phải được bảo vệ như secret-bearing infrastructure.
- Frontend static host có SPA fallback tới `index.html`, HTTPS và cache asset hash; `index.html` cần revalidation. Reverse proxy chuyển `/api/*` đến Nest và `/socket.io/*` cả WebSocket Upgrade, giữ namespace `/operations`; không rewrite `/api/v1` sai đường dẫn.
- SMTP cho password-reset và email nếu bật; cấu hình sender/domain và xác minh delivery. Tắt SMTP khiến password reset không được giao đến người dùng, dù in-app notification vẫn lưu PostgreSQL.
- Log/metrics, cảnh báo DB/Redis/queue failures, readiness failures, HTTP 5xx và 429. Probe live `/api/v1/health/live`; ready `/api/v1/health/ready`. Live không truy cập dependency; PostgreSQL down → ready 503, Redis runtime down → ready 200 `degraded`. Redis down lúc production startup → fail startup.
- File storage chưa có upload/POD binary pipeline trong release này. Không tạo dependency storage giả; nếu bổ sung upload sau này phải provision qua StorageService và security review riêng.

## Render staging SPA routing

For the existing `logistics-staging-web` Render **Static Site**, configure
**Redirects/Rewrites** in the service dashboard:

| Source | Destination | Action |
|---|---|---|
| `/*` | `/index.html` | Rewrite |

Keep any existing specific API rules before this catch-all. Use Rewrite, not a
redirect: the browser must retain `/shipments/new` for React Router. Render serves
existing assets before applying rewrite rules. See [Render's routing documentation](https://render.com/docs/redirects-rewrites).

The repository's `deploy/nginx.conf` already has SPA fallback, but it is installed
only by the Docker `frontend` target; a Render Static Site does not run that nginx
configuration. Adding a file to the repo alone does not update a manually configured
Render service. Verify the service type/settings before applying this rule; do not
create a second service or change React Router to compensate for hosting.

After saving the rule, run `node deploy/staging-web-smoke.mjs`. It checks `/`, a
direct `/shipments/new` navigation, and a reload of that exact path, with real
Chromium requests. A redirect to the existing login screen is valid SPA/auth behavior;
it does not prove the authenticated shipment form or Leaflet works. Tile verification
must wait until the route passes and an authorized staging session is available.

## Production environment

Template development là `.env.example`; template production/staging đầy đủ là [`deploy/.env.example`](../deploy/.env.example). Inject secrets qua secret manager/runtime environment; không bake vào artifact hoặc `VITE_*`. Không gửi secret trong chat. Staging bình thường chạy `NODE_ENV=production`, routing/payment `DISABLED`, GPS `REAL`; simulation chỉ dùng runner disposable trong CI với development/test mode. Không tạo staging simulation release image.

| Variable | Production value / requirement |
|---|---|
| `NODE_ENV` | `production` (bắt buộc) |
| `DATABASE_URL` | pooled PostgreSQL URL với `sslmode=verify-full`; chỉ runtime |
| `DIRECT_URL` | direct PostgreSQL URL với `sslmode=verify-full`; bắt buộc ở migration job, không cần ở runtime |
| `JWT_ACCESS_SECRET` | secret ngẫu nhiên riêng, tối thiểu 32 ký tự; không placeholder/test secret |
| `FRONTEND_URL` | đúng một HTTPS origin, không path/query/credential |
| `REDIS_URL` | managed `rediss://` URL; production startup yêu cầu kết nối thành công |
| `PORT` | cổng listener nội bộ, mặc định 3000 |
| `TRUST_PROXY_HOPS` | đúng topology; mặc định 0; chặn đường đi trực tiếp vào backend nếu tin proxy headers |
| `REFRESH_COOKIE_NAME` | `__Secure-logistics_refresh` |
| `REFRESH_COOKIE_SAME_SITE` | `lax` cho same-site; `none` chỉ khi topology cross-site thực sự cần và đã test browser cookie policy |
| `PASSWORD_RESET_URL` | URL HTTPS frontend `/reset-password`; mặc định suy ra từ `FRONTEND_URL` |
| `JWT_ISSUER`, `JWT_AUDIENCE` | nhất quán giữa các lần chạy; mặc định `logistics-api`, `logistics-web` |
| `SWAGGER_ENABLED` | `false` |
| `ROUTE_PROVIDER` | **`DISABLED`**; bỏ `ROUTE_PROVIDER_BASE_URL` |
| `PAYMENT_PROVIDER` | **`DISABLED`**; bỏ `PAYMENT_TEST_WEBHOOK_SECRET` |
| `EMAIL_DELIVERY_ENABLED` | `true` khi SMTP đã provision và delivery đã kiểm thử |
| `SMTP_HOST/PORT/SECURE/USER/PASSWORD`, `EMAIL_FROM` | bắt buộc khi bật email; secret không đi qua frontend |
| `VITE_API_URL` | build-time `/api/v1` cho same-origin, hoặc HTTPS API URL kết thúc `/api/v1` |
| `VITE_SOCKET_URL` | build-time `/` cho same-origin, hoặc HTTPS backend origin; client tự thêm `/operations` |
| `VITE_API_DOCS_URL` | để trống nếu docs tắt |
| `VITE_LOCATION_MODE` | build-time **`REAL`** |

Các TTL/timeout/cache/routing/deviation khác có default đã validate ở `env.validation.ts`; `.env.example` liệt kê đầy đủ. GPS cần secure browser context và quyền location. Chỉ biến `VITE_*` mới được đưa vào bundle; không đặt secret dưới prefix này. URL frontend là build-time nên phải rebuild khi đổi API/socket origin.

## Migration and deployment order

1. Freeze/review toàn bộ A→H3 + I1 + I2 thành release commit, bao gồm các file/migration hiện chưa tracked. Dùng lockfile; không deploy từ working tree chưa review. Bảo vệ main/master bằng required check `release-gate` của `.github/workflows/release.yml`; cấm bypass và yêu cầu review thay đổi workflow/manifest. CI không publish image hoặc deploy tự động.
2. Provision staging cùng topology production; inject env staging; restore backup representative vào staging. Xác minh connection role, TLS, extensions, counts, constraint violations và capacity legacy cần cấu hình.
3. Chạy `npm ci`, `npm run db:generate`, unit/E2E/Playwright/lint/typecheck/build/audit. Build không cần DB secret; kiểm tra `backend/dist/main.js` và `frontend/dist/index.html`.
4. Migration/deploy jobs chỉ chạy **Linux/container**. Windows Application Control là giới hạn workstation, không phải điều kiện tắt security hay sửa Prisma cho production. CI chạy Prisma deploy hai lần (lần hai no-op), status, checksum DB chỉ đọc, migration→schema diff và DB→schema diff; SQL replay hai DB độc lập bổ sung kiểm tra CHECK/index/enum. `SHADOW_DATABASE_URL` phải disposable riêng biệt, được Prisma 7 đọc qua `prisma.config.ts`.
5. Staging mới dùng DB sạch và bộ 25 SQL canonical khóa trong `backend/prisma/migrations.manifest.json`. Một migration job duy nhất chạy image target `migration` với `DIRECT_URL`; entrypoint `deploy/migrate.sh` kiểm tra history trước deploy (cho phép pending), deploy, status và checksum sau deploy. Không startup-migrate, `migrate dev`, reset, db push hoặc seed demo. Không chạy job này trên production trong I2.
6. H2/H3 development cũ vẫn mismatch và bị gate chặn. Xem reconciliation trong báo cáo I2: giữ nguyên DB cũ/history, không UPDATE/DELETE `_prisma_migrations`, không dùng `resolve --applied` để che checksum. Không clone nguyên history lệch vào staging rồi triển khai. Nếu enum đã commit nhưng phần sau thất bại, khóa promotion, snapshot và điều tra; không retry mù.
7. Start API với providers disabled, chờ ready; publish frontend có URL production và REAL. Smoke auth/cookie/RBAC, lifecycle/cash shipping fee/COD, Socket reconnect/revocation, GPS freshness, liveness/readiness, reverse-proxy rate limits; xác minh không có simulation UI.
8. Chỉ mở traffic sau khi migration gate, health, SMTP recovery flow và operational smoke đều pass. Drain connections/workers trước khi dừng instance; diễn tập SIGTERM ở runtime đích. I1 Windows process termination không chứng minh Linux graceful shutdown.

Rollback: giữ artifact trước và backup/PITR; chỉ rollback code nếu tương thích schema additive đã áp dụng. Không viết down migration xóa lịch sử nghiệp vụ. Dừng traffic và khôi phục có kiểm soát nếu integrity hoặc migration lỗi; tái kiểm tra trạng thái và outbox/queue trước mở lại.

## Linux CI and artifacts

`.github/workflows/release.yml` dùng Ubuntu + Node 22, PostgreSQL 17 và Redis 7.4 disposable. `deploy/ci/verify.sh` thực thi tuần tự install → lint → typecheck → unit → E2E → production build → migration validation → Playwright/smoke → audit. Migration fixture setup chạy trước E2E; replay release độc lập chạy sau build. `set -euo pipefail` và job cuối `release-gate` chặn fail/cancel/skip. Full Playwright không retry; OSRM/TEST/SIMULATION chỉ dùng trong bài kiểm thử development, không bake vào artifact.

`Dockerfile` có targets `ci`, `migration`, `backend`, `frontend`. Build context loại `.env*`, node_modules, generated client, dist, Git và log. Backend chạy bằng user `node`, chỉ có compiled JS và production dependencies; không Prisma CLI, migration credential hoặc auto migration. Frontend Nginx phục vụ Vite production build cùng origin, SPA fallback, immutable hashed assets; `/api/*` giữ nguyên prefix và `/socket.io/*` chuyển Upgrade với timeout 75s. Backend healthcheck yêu cầu DB và Redis đều `up`, chặn cả HTTP 200 `degraded` khi promotion.

`deploy/ci/containers.sh` build cả ba release targets, deploy migrations vào PostgreSQL disposable, khởi động artifact với `NODE_ENV=production`, test HTTPS frontend/API/socket qua hai proxy và SIGTERM/restart. Certificate CI chỉ được trust riêng bằng `NODE_EXTRA_CA_CERTS`; không tắt TLS verification. Test-only SMTP disabled không chứng minh SMTP staging.

Build reviewable artifacts từ release commit đã pass gates:

```sh
docker build --target backend -t REGISTRY/logistics-backend:RELEASE_SHA .
docker build --target frontend -t REGISTRY/logistics-frontend:RELEASE_SHA .
docker build --target migration -t REGISTRY/logistics-migration:RELEASE_SHA .
```

Chỉ sau registry được provision và quyền publish được cấp mới push/promote; lưu image digest bất biến cùng commit SHA và CI run. Dockerfile đã pin Node/Nginx base-image digests đã test; refresh base phải review và chạy lại gates. Không dùng mutable `latest` để promote.

I3 adds explicit GHCR publication through `workflow_dispatch` with `publish_images=true` on `main` or `master`. Default push/PR/manual runs do not publish. The full Linux gates and container smoke run first; `deploy/ci/publish-images.sh` then tags/pushes those exact tested images without rebuilding, verifies each registry digest, and uploads `staging-images-SHA` with source SHA, run URL and backend/frontend/migration digest references. The final `release-gate` fails if verification or requested publication fails. Use the repository-scoped Actions token with package write permission; no Neon/runtime secrets are needed by CI and no deployment occurs in this workflow.

## Staging provisioning and release checklist

User/operator cần provision qua secret manager/control plane, **không gửi secret trong chat**:

- Git repository/runner Linux, required `release-gate`, registry và quyền push/pull; review/release commit chứa đầy đủ các thay đổi A→I2 đang chưa commit.
- PostgreSQL staging riêng (ưu tiên DB sạch), pooled runtime role, direct migration role có DDL/`btree_gist`, shadow DB disposable riêng; TLS verify-full, network ACL và runtime grants cho bảng/sequence. Không tái dùng DB/history development lệch.
- Redis standalone staging với TLS/ACL, `noeviction`, mạng riêng, BullMQ TCP/Lua/blocking access; theo dõi memory/queue backlog. Queue chứa reset token tạm thời nên cần bảo vệ dữ liệu.
- SMTP host/port/TLS/account, sender/domain và hộp thư kiểm chứng password reset; bật `EMAIL_DELIVERY_ENABLED=true` sau provision.
- DNS + certificate hợp lệ + HTTPS ingress. Topology chuẩn: browser → TLS ingress → frontend Nginx:8080 → backend:3000. Ingress **overwrite** X-Forwarded-For từ client; Nginx append ingress hop; `TRUST_PROXY_HOPS=2`. Chỉ ingress host được truy cập loopback 8080; backend không publish port. Nếu topology khác phải đổi số hop và test anti-spoof trước promotion.
- Random JWT secret riêng, secret rotation/access policy, log/metric sink và alerts; bootstrap Admin theo quy trình tài khoản được kiểm soát (không seed demo).
- Backup/PITR retention, RPO/RTO do operator chốt, người chịu trách nhiệm incident, restore DB mới và diễn tập restore có số liệu đối chiếu.

Checklist áp dụng trên **đúng source SHA, image digest và môi trường staging**; mỗi mục lưu evidence/run URL, thời điểm và operator:

- [ ] Clean release checkout chạy toàn bộ CI, audit và `release-gate` PASS; image digests tương ứng, không gate skip/fail.
- [ ] Migration manifest/Git baseline clean; Prisma replay 25/25, status, checksum và drift PASS; staging preflight không có mismatch/unresolved/unknown rows. Snapshot trước migration; migration job độc quyền.
- [ ] Secrets/SMTP/TLS/roles/network ACL được provision; không có secret trong source, image, frontend hoặc logs.
- [ ] Backup/PITR và restore drill đạt RPO/RTO; giữ previous image digests và export migration history chỉ đọc.
- [ ] Backend start/health `status=ok`, DB/Redis `up`, frontend health OK; shutdown/restart/drain trên staging được quan sát.
- [ ] HTTPS API/frontend/SPA/assets/socket Upgrade + reconnect/revocation PASS; cookie Secure/HttpOnly, Origin/RBAC và forwarding anti-spoof PASS; auth/password reset SMTP delivery PASS; GPS REAL có consent, TTL đúng, providers vẫn DISABLED.
- [ ] Operational smoke cash shipping fee/COD và ownership/lifecycle PASS với tài khoản test staging; không demo seed production.
- [ ] Rollback procedure và incident owner được xác nhận; chỉ mở traffic sau tất cả mục trên.

Sau khi checklist trước deploy đạt và staging action được thực hiện trong release job được kiểm soát, set image digests + `STAGING_ENV_FILE` ngoài repo. Compose không đọc root `.env` development:

```sh
# Environment của runner chứa các image digests và DIRECT_URL staging.
docker compose --env-file /protected/staging-deploy.env -f deploy/staging.compose.yml run --rm migrate
# Chỉ tiếp tục nếu migration job exit 0; không dùng ';' để bỏ qua lỗi.
docker compose --env-file /protected/staging-deploy.env -f deploy/staging.compose.yml up -d --wait backend frontend
```

Không cấu hình production target trong I2. `DIRECT_URL`/shadow chỉ đưa vào migration job, không runtime env file. Một operator/job duy nhất sở hữu promotion; không cho compose chạy đồng thời migrations.

Rollback drill: đóng ingress writes → chờ request/worker đang xử lý và SIGTERM tối đa 45s → nếu schema tương thích thì chọn previous backend/frontend digests và start/health/smoke lại. Nếu migration partial/schema không tương thích/integrity lỗi, giữ DB bị lỗi để điều tra, restore backup/PITR sang **DB mới**, kiểm tra history/checksum/count/FK/CHECK và đối soát queue/email idempotency trước đổi connection/traffic. Không down-migrate, xóa history, hay restore đè DB đang phục vụ. Mọi mất dữ liệu trong RPO phải được operator đánh giá và đối soát.

## Disabled-provider operation

`DISABLED` routing trả Haversine fallback với duration/ETA null; READY và dispatch không cần route provider, planned geometry có thể null, deviation `UNKNOWN`, reroute unavailable. G3C3 dùng window fallback đã ghi trong domain, không giả ETA.

`DISABLED` payment từ chối create/webhook, frontend không có payment action khi backend báo unavailable. H1/H2 thu và đối soát phí bằng tiền mặt tiếp tục độc lập COD. Test HMAC adapter, OSRM test server và GPS simulation chỉ tồn tại trong development/test. Không chọn vendor hoặc nới production validation trong I1.
