# PHASE 1 RELEASE CLOSURE — audit 2026-10-03

**PHASE 1 FUNCTIONAL: PASS trong phạm vi chức năng đã kiểm chứng. RELEASE INTEGRITY: BLOCKED. STAGING DEPLOYMENT: BLOCKED.**

Ngày báo cáo: 2026-10-03, Asia/Saigon. Đây là audit chỉ đọc hệ thống; thay đổi trong task chỉ là tài liệu. Không sửa business logic, dependency/lockfile, migration SQL, manifest, checksum DB, cấu hình runtime hoặc workflow; không migration/reset/reapply, push, dispatch CI hay deploy. Không tạo request forgot/reset mới, gửi email hoặc chạy exploit trên staging.

Báo cáo này cập nhật việc phân loại blocker của [P0 staging report](PHASE1_P0_STAGING_20261003.md), không thay thế bằng chứng functional trước đó. Working tree đầu task đã có sửa `PROJECT_STATE.md` và báo cáo P0 chưa tracked; giữ nguyên các nội dung đó ngoài phần cập nhật trạng thái. Invariants liên quan: C04/C16 bảo vệ auth/secret, C05 giữ lịch sử, C09 email retry, C10 integrity, C18 bằng chứng kiểm thử/release.

**Kết quả quan trọng:** “3 moderate” là snapshot CI ngày 2026-09-29. Audit online ngày 2026-10-03 hiện có **9 package findings: 5 moderate + 4 high**; `--omit=dev` có **8: 5 moderate + 3 high**. Vì vậy không thể đóng dependency gate chỉ bằng waiver ba finding cũ. Một finding mới ở Engine.IO có đường runtime tương ứng trong source và phải được xử lý.

## 1. Dependency audit

### Phạm vi và tính tái lập

- Source kiểm tra: `9b0ad498fa2364593472fabf714a36f8c7660549`; remote main: `68869cbc30ce93574fa4e50fb228ed53c05f2b9d`. Hai SHA có cùng application source, dependency và schema; khác năm file test/tool được liệt kê ở mục 3.
- SHA-256 của `package-lock.json` trên workspace: `9dc36888338f455198a0dd845bc68ca0dee49d1e090d406add37cfcb3cc1caf7`. Các version dưới đây được đối chiếu cả lockfile và `node_modules/*/package.json`. Đây không phải inventory đã chứng minh của Render Live.
- Local: Windows, Node `v24.13.1`, npm `11.8.0`; canonical CI trước đó: Ubuntu/Node `22.23.2`. Audit local không thay thế toàn bộ CI.
- `npm config get offline` trả `true`. Lần đầu `npm audit --json` trả 0 là kết quả offline, **không được tính là PASS**. Ép online trong sandbox gặp `ECONNREFUSED 127.0.0.1:9`; chạy lại với quyền network trả findings dưới đây. Không thay npm config.
- Hai lệnh online đều exit **1**: `npm audit --offline=false --registry=https://registry.npmjs.org --audit-level=low --json` và cùng lệnh với `--omit=dev`.
- Raw JSON, thời điểm, exit codes và lock hash được lưu trong [npm audit evidence](PHASE1_RELEASE_CLOSURE_20261003_NPM.json), capture `2026-10-03T01:19:34.3085707Z` (08:19 Asia/Saigon).
- `npm ls` nhìn thấy Multer `2.3.0`, đồng thời báo `ELSPROBLEMS` vì parent khai báo exact `2.2.0`; root đã có override `2.3.0`. Không diễn giải cảnh báo đó thành package `2.2.0` đang cài. Cần kiểm tra lại dependency tree bằng `npm ci` trên Node 22 trong task nâng dependency sau này.

### Exact findings của CI “3 moderate”

Ba package entries nhưng chỉ **hai advisory độc lập**. Không finding nào trong ba mục này là dev-only.

| Package / installed = locked | Direct/transitive; loại dependency; path | Advisory / CVE; affected range | Fixed version; breaking risk | Phân loại usage |
|---|---|---|---|---|
| `multer@2.3.0` | Transitive **production**. root workspace → `backend` → `@nestjs/platform-express@11.2.1` → `multer@2.3.0` (root override) | [GHSA-3pph-fpjx-jg34](https://github.com/expressjs/multer/security/advisories/GHSA-3pph-fpjx-jg34), **CVE-2026-88932**; `>=2.2.0 <2.4.0` | `2.4.0`, minor. Rủi ro tương thích upload/cleanup cần regression; không cần major để sửa advisory này | **B — present, vulnerable path không được gắn vào request pipeline hiện tại** |
| `@nestjs/platform-express@11.2.1` | Direct **production** của backend; còn xuất hiện qua peer của Nest core/testing, không vì thế thành dev-only | Finding kế thừa từ Multer ở trên, **không có CVE riêng**. npm parent range `11.1.28–11.2.5` hoặc `12.0.0-alpha.0–12.0.2` | `11.2.6` là patch tối thiểu được log CI đề xuất; audit hiện đề xuất `11.2.7`. Registry xác nhận cả hai dùng exact Multer `2.4.0`, peer Nest core/common `^11.0.0`. Root override cũ phải được xử lý cùng lúc | **B — cùng đường Multer**, không đếm thành lỗ hổng thứ ba |
| `nodemailer@9.1.1` | Direct **production**: root workspace → `backend` → `nodemailer` | [GHSA-6vj9-mwq6-2f5v](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-6vj9-mwq6-2f5v); **không có CVE được công bố trên advisory tại lúc audit**; `>=5.0.0 <10.0.2` | `10.0.2` sửa riêng advisory cũ; CI cũ gợi ý `10.0.12`, hiện npm gợi ý `10.0.13`. Đều là **major** từ 9.x; chỉ report, chưa upgrade | **D — advisory không áp dụng với cấu hình transport hiện tại**, có điều kiện bên dưới; package/version vẫn thực sự bị ảnh hưởng |

**Multer reachability.** Advisory yêu cầu upload qua `diskStorage`, abort ở thời điểm cleanup chưa biết file path, có thể làm đầy đĩa. Tìm trong `backend/src` không có `MulterModule`, `FileInterceptor`, `FilesInterceptor`, `FileFieldsInterceptor`, `AnyFilesInterceptor`, `diskStorage`, `memoryStorage`, `multer` hoặc multipart handler. [Deployment runbook](DEPLOYMENT.md) cũng xác nhận chưa có upload/POD binary pipeline. Nest Express adapter vẫn chạy production, nhưng không tự gắn Multer vào mọi route. Kết luận B là kết luận từ source đã audit, không phải chứng minh rằng package đã được vá hoặc Render đang chạy đúng source đó.

**Nodemailer reachability.** Advisory cũ yêu cầu nhiều direct SMTPS transports cùng hostname nhưng khác TLS `servername`, với khả năng một tenant prime process-global cache. [SmtpEmailSender](../backend/src/modules/notifications/email-sender.ts) tạo duy nhất một transporter từ cấu hình hệ thống; `NotificationsModule` đăng ký sender chung. Không nhận host, TLS servername hoặc transport options từ request/tenant; không có `tls.servername` override. Luồng có thật là forgot → `NotificationJobsService` → `processPasswordReset` → `sendMail`, nhưng điều kiện cross-tenant của advisory không được tạo ra. Nếu sau này thêm per-tenant SMTP/custom TLS identity phải hủy kết luận D và audit lại. Chưa dùng việc SMTP staging có thể disabled làm bằng chứng waiver cho production.

**Đề xuất exact upgrade, chưa thực hiện:**

| Đề xuất | Phạm vi regression bắt buộc |
|---|---|
| Root override `multer: "2.3.0" → "2.4.0"`; backend `@nestjs/platform-express: "11.2.1" → "11.2.7"`. Có thể giữ override ở version mới hoặc loại bỏ sau khi tree đã chứng minh chỉ có bản vá; không để override cũ kéo ngược về 2.3.0 | Clean Node 22 `npm ci`; `npm ls`; full/prod online audit; Nest build/lint/typecheck, route/validation/error envelope, login/refresh cookie/CORS, health và production artifact smoke. Kiểm chứng không xuất hiện upload route ngoài ý muốn. Nếu sau này có upload: bounded abort/storage cleanup regression |
| Nodemailer: candidate review `9.1.1 → 10.0.13`, **major, không thực hiện trong audit**. `10.0.2` không đủ cho các advisory mới hiện có | Node 22 production build/start, ESM default import và TypeScript typings với `@types/nodemailer@8.0.1` hiện tại; SMTP TLS/auth/timeouts, sender/recipient/envelope, deterministic Message-ID, retry/failure, disabled mode và full forgot/reset qua SMTP sink |

[Release notes Nodemailer 10](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0) yêu cầu Node >=20 và chuyển sang TypeScript cùng ESM/CJS builds. Node 22 đáp ứng engine, nhưng không chứng minh import/type/SMTP tương thích. Chưa xác nhận backport 9.x có fix; không tự chọn major upgrade.

### Findings phát sinh trong audit online hiện tại

Raw JSON lưu toàn bộ advisory URL/range/node path; bảng này tách impact khỏi mức severity package. Các kết luận usage là static assessment, chưa phải phê duyệt waiver. Không chạy payload DoS lên staging.

| Package / phiên bản hiện tại | Dependency path / runtime assessment | Phân loại và hành động |
|---|---|---|
| **`engine.io@6.6.9` — high** | backend → `socket.io@4.8.3` (cũng qua Nest platform-socket.io) → Engine.IO `~6.6.0`. [GHSA-2gc4-cqfq-p2gv / CVE-2026-102599](https://github.com/socketio/socket.io/security/advisories/GHSA-2gc4-cqfq-p2gv): transport upgrade có protocol mismatch có thể crash process. `ConfiguredSocketIoAdapter` chỉ thêm CORS; Engine.IO defaults `polling,websocket`, `allowUpgrades=true`. Gateway auth ở namespace `/operations` không phải transport-level upgrade guard | **A theo cấu hình source**; release security blocker. Chưa chứng minh version Live hoặc exploit thành công. Đề xuất exact `6.6.10` trong lockfile, nằm trong parent `~6.6.0`; không cần đổi business logic. Regression polling → WebSocket upgrade, auth/revocation/reconnect/GPS/notification, proxy smoke và isolated malformed-upgrade regression. Không waive bằng auth/CORS |
| `axios@1.19.0` — high | Direct frontend; chỉ browser API clients ở `frontend/src/services/api.ts`, không có backend Axios import. Audit có 12 advisories; Node HTTP/data URI/HTTP2/proxy paths không được app backend sử dụng. Browser prototype-pollution gadgets cần đánh giá riêng; không có custom adapter/FormData/prototype mutation được tìm thấy trong product source | Node-only paths **D** theo usage; browser gadgets **B có điều kiện**, không chứng minh an toàn trước một pollution source khác. Đề xuất minor exact `1.20.0`; regression interceptors, auth revision/refresh races, request method/header/body, credentials/CORS/timeouts. Không gộp thành waiver blanket cho cả package |
| `nodemailer@9.1.1` — hiện aggregate high | Thêm GHSA-8vvx-rff5-p5rq (nested arrays), GHSA-g57g-f23g-4646 (quoted recipient), GHSA-v53p-9fqp-m79j và GHSA-prgh-xp8r-p3m5 (parser complexity). Sender chỉ nhận chuỗi `to`; register/create-staff/forgot DTO dùng `IsEmail` + max 254; không có inbound mailparser | Arrays **D**; long-input parser DoS **B/D theo giới hạn input**. Hai mẫu quoted-recipient của maintainer bị `class-validator.isEmail` hiện tại reject trong kiểm tra local. Điều đó chỉ chứng minh các mẫu đó, không chứng minh mọi email legacy/import hợp lệ. Giữ major review `10.0.13`; waiver cũ cho TLS cache **không bao phủ** bốn advisory mới |
| `@nestjs/swagger@11.4.7` + nested `js-yaml@5.3.0` — hai moderate entries | Direct backend Swagger → transitive production js-yaml. [GHSA-r3ph-w7gj-g6xm](https://github.com/nodeca/js-yaml/security/advisories/GHSA-r3ph-w7gj-g6xm) ảnh hưởng YAML load/merge. Swagger code đang dùng `dump`, không nhận YAML để load; startup log user gửi có `swaggerEnabled=false` | **B**. Fixed js-yaml `5.4.1` (minor), registry verified. Có thể review override scoped cho nested copy thay vì tự nâng Swagger major `12.0.2` như npm gợi ý. Cần kiểm tra dependency tree + docs generation; không sửa override hiện có cho js-yaml 3.x/4.x |
| `fast-uri@3.1.7` — moderate | Transitive qua AJV: tooling Nest/Prisma, đồng thời optional peer paths khiến package vẫn xuất hiện trong `--omit=dev`. Product frontend dùng `@hookform/resolvers/zod`, không AJV resolver; backend dùng class-validator | **B ở runtime app, C cho usage tooling được thấy**; không gọi package này dev-only vì production inventory vẫn có. GHSA-hrr3-gc8f-f4qj; patch exact `3.1.8`. Review URI normalization/tool/schema generation trước khi đóng |
| `brace-expansion@1.1.18 / 2.1.4 / 5.0.9` — high | Tất cả bảy affected node paths trong lockfile có `dev:true`: ESLint/Jest/test-exclude/fork-ts-checker. Không còn trong prod audit. GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p | **C**, vẫn là CI/toolchain gate finding. Fixed thresholds cho toàn bộ ba advisory theo ranges hiện tại: `1.1.21`, `2.1.7`, `5.0.12`. Clean install + lint/test/coverage/build; cân nhắc untrusted PR/glob input khi quyết định waiver |

**Waiver policy hiện tại:** `deploy/ci/verify.sh` fail ở audit-level low cho cả full và prod; `.github/workflows/release.yml` có gate fail-closed; [DEPLOYMENT.md](DEPLOYMENT.md) yêu cầu không bypass. Không tìm thấy quy trình tự động chấp nhận moderate/B/C/D. Vì vậy ba finding cũ là **candidates cho documented exception**, không được tuyên bố “đã waived theo policy”. Nếu owner muốn áp dụng phải review chính sách/gate riêng, allowlist theo advisory + dependency/version/path + source scope, lý do reachability, owner, expiry/review trigger, tracking fix và negative tests; mọi finding mới hoặc khác phạm vi vẫn FAIL. Không hạ global audit threshold, không bỏ production audit.

**Release conclusion cho dependency:** ba moderate cũ chưa chứng minh exploitable trong source hiện tại, nhưng gate còn FAIL cho đến khi patch hoặc exception được duyệt. Engine.IO mới là blocker bảo mật có đường runtime; phần phát sinh còn lại phải patch/triage có scope trước release. Chưa có waiver nào được áp dụng.

## 2. H2/H3 checksum history

DB audit `2026-10-03T01:14:20.788Z`, TLS certificate verified, target operator-confirmed `ep-royal-dust-axv3itmx.c-4.us-east-2.aws.neon.tech/neondb`. Session dùng `default_transaction_read_only=on` và `BEGIN ... READ ONLY`; chỉ SELECT/SHOW rồi ROLLBACK. Có 26 successful migrations + một rolled-back Phase 5 row cũ. Không thay ledger.

| Migration ID | Applied staging checksum | Repo file = manifest = earliest available Git snapshot |
|---|---|---|
| `20260907170000_phase_h2_shipping_fee_reconciliation` | `b2054fdfd41eb6a741d300c2627c92aeba5bfb316e51b01b0a317b338f0f4b3f` | `4c8b9dd70fbacfbc53be24045a62d67c3a8d59a882b4c77a8075704792b01adb` |
| `20260907210000_phase_h3_shipping_fee_online_payment` | `f6a01423c46b7bedfc9791ef81d5b530a702928b745e0f03015d180970458386` | `8324e237ba9afd159bb78dcda6a06cf75f238bdef221dac1c86eefe816a21228` |

| Migration | started_at UTC | finished_at UTC | Applied steps |
|---|---|---|---|
| H2 | `2026-09-07T02:59:13.018Z` | `2026-09-07T02:59:17.727Z` | 1 |
| H3 | `2026-09-07T04:33:35.222Z` | `2026-09-07T04:33:40.694Z` | 1 |

**SQL hiện tại:** toàn bộ [H2 SQL](../backend/prisma/migrations/20260907170000_phase_h2_shipping_fee_reconciliation/migration.sql) là 5,431 bytes và [H3 SQL](../backend/prisma/migrations/20260907210000_phase_h3_shipping_fee_online_payment/migration.sql) là 8,064 bytes, đều LF. Phần đầu hiện tại:

```sql
-- H2
-- PostgreSQL requires new enum values to commit before CHECK constraints use them.
BEGIN;
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'REMITTED';
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'SETTLED';
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'DISPUTED';
COMMIT;
-- Remaining file: ledger columns/checks/FKs/indexes and ShippingFeeDispute.

-- H3
-- PostgreSQL requires new enum values to commit before CHECK constraints use them.
BEGIN;
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'PAYMENT_PENDING';
ALTER TYPE "ShippingFeeTransactionStatus" ADD VALUE 'PAID';
COMMIT;
-- Remaining file: payment types, ledger checks, payment/event tables and indexes.
```

Các dòng tóm tắt “Remaining file” chỉ là chú thích báo cáo; SQL đầy đủ authoritative nằm ở hai link và hash trên.

**Byte reconstruction đã thực hiện trong memory, không ghi SQL:** xóa đúng comment mở đầu của I1, dòng `BEGIN;` kế tiếp và dòng `COMMIT;` đầu tiên. SHA-256 của phần còn lại khớp **chính xác cả hai checksum staging**. Không normalize newline, không sửa statement, không thay manifest. Điều này phân biệt được nguyên nhân khỏi giả thuyết đổi thuật toán/tool hoặc CRLF/LF.

**Root cause:** migration SQL đã được bổ sung transaction boundary sau khi apply để fresh replay commit enum values trước các CHECK dùng chúng. [I1 report](PRODUCTION_READINESS_I1.md) và [I2 report](RELEASE_ENGINEERING_I2.md) ghi nhận lần sửa này ngày 2026-09-09. Byte proof độc lập xác nhận mô tả đó. DDL còn lại giống bản historical được tái dựng; transaction/partial-failure behavior có thay đổi nên không được coi là history khớp.

**Giới hạn Git provenance:** repository không shallow, có 23 reachable commits trong các refs hiện có. `git log --all -- <H2/H3 paths>` chỉ có root snapshot `91360bd0aefa416da18bd33c543e83ea0cb766f5` (`chore: republish project snapshot`, author date 2026-09-11T10:44:17+07:00), đã chứa SQL mới. Không có commit lúc apply ngày 09-07 hoặc commit riêng thực hiện sửa I1 trong Git graph hiện tại. Vì vậy **không thể cung cấp original-at-apply commit hoặc exact modifying commit**. Bản historical ở đây là reconstruction có hash khớp ledger, không được gắn nhãn Git original. Không kết luận snapshot commit chính là thời điểm sửa SQL.

**Schema evidence:** check ngày 2026-10-02T05:33:43.793Z trong `test-results/p0-staging/schema-diff.json` có read-only Linux Prisma diff exit 0, `No difference detected`, schema SHA-256 `71efe07c210129ba6e3ef302f71b7a32346e5f7fbf2b7c7c96b14f2ac5e94389`. P0 CI fresh canonical migration replay và operational tests PASS. Audit hiện tại xác nhận historical rows còn nguyên; local canonical manifest check 26/26 PASS. Không gọi schema diff hôm trước là một lần diff mới, và Prisma schema diff không tự chứng minh mọi custom CHECK/index predicate hoặc toàn bộ data invariant. Strict applied-history gate vẫn FAIL.

**LEGACY CHECKSUM EXCEPTION — chỉ là đề xuất sau báo cáo nguyên nhân, chưa implement/approve:**

1. Chỉ bật cho đúng identity của legacy staging DB đã audit; không tự mở cho DB mới, CI disposable hoặc mọi production database.
2. Allowlist đúng hai migration ID ở bảng, **mỗi ID đi kèm cả historical checksum và canonical checksum cụ thể**. Canonical checksum chuẩn vẫn được chấp nhận; chỉ legacy pair đúng mới cho kết quả riêng `PASS_WITH_LEGACY_EXCEPTION`, không đổi thành “MATCH”.
3. Local SQL → manifest và Git baseline vẫn strict. Nếu canonical file/manifest đổi, exception hết hiệu lực; không cập nhật manifest để theo DB. Migration mới và mọi row khác không có exception.
4. Giữ nguyên guard unknown migration, duplicate success, unresolved failure, gap/order và pending policy. Sai một byte ở historical hash, dùng H2 hash cho H3, thêm ID lạ, sai target hoặc hết hiệu lực → FAIL.
5. Record reason, hash reconstruction, apply times, schema/catalog evidence, Git provenance limitation, owner/approval và thời điểm review. Owner phải chấp nhận rõ giới hạn không còn modifying commit; nếu policy bắt buộc Git original thì vẫn BLOCKED tới khi tìm được bản archive/bundle cũ.
6. Trước approval: refresh read-only drift và đối chiếu custom CHECK/FK/partial indexes với canonical disposable replay, ngoài Prisma schema diff; xác nhận compatibility và không partial migration. Dùng target identity và fingerprint lịch sử để tránh áp nhầm DB.
7. Test candidate gate ở môi trường kiểm soát: đúng pair/target PASS_WITH_LEGACY_EXCEPTION; tất cả trường hợp sai trên FAIL; canonical fresh DB PASS; migration mới luôn strict. Chỉ thay tooling/policy, không chạy migration để “repair” staging.

Không `UPDATE _prisma_migrations`, `resolve --applied`, reset/reapply hay edit old SQL. Append migration mới cũng không làm checksum lịch sử tự khớp. Đây là historical-integrity exception có bằng chứng, không phải sửa lỗi bằng che giấu ledger.

## 3. Exact Render release identity

GitHub read-only API check lúc `2026-10-03T01:15:17.076Z`: main và CI SHA bên dưới; run completed/failure; deployments HTTP 200 trả `[]`; commit statuses của main trả `[]`. Không có credential Render trong các env đã kiểm tra hoặc process env; phiên CDP hiện có không có tab Render đã mở. Không dùng GitHub branch SHA để suy ra Render SHA.

| Đối tượng | Exact SHA / image | Bằng chứng và giới hạn |
|---|---|---|
| Live backend `logistics-staging-api` | **UNVERIFIED**, không có image digest | User gửi startup log ngày 09-28 với `application.started`, production, port 10000, `swaggerEnabled=false`, `trustProxyHops=1`, Render “service is live”. Không có SHA/deploy ID/Node version; timezone log không được chỉ định. Log không chứng minh deployment hiện tại chưa đổi |
| Live frontend `logistics-staging-web` | **UNVERIFIED**, không có image digest | GET 2026-10-03T01:18:08.122Z HTTP 200; asset `/assets/index-BGj12pP4.js`, 203,774 bytes, SHA-256 `65f9bbc4c9e9ba91e3787453bcc2b344c0946f07428e1382ddd635716f5bf8f4`. Fingerprint không chứng minh Git SHA. Node build 22.23.3 là log được ghi ở báo cáo P0, không phải runtime Node của static site |
| CI-tested source | `9b0ad498fa2364593472fabf714a36f8c7660549` | [Run 36518532003](https://github.com/NguyenTranThienLong04/ProjectLogictic/actions/runs/36518532003), Node 22.23.2. Functional tests PASS; overall run và release-gate **FAIL**. Không gọi đây là release-approved SHA |
| Remote main | `68869cbc30ce93574fa4e50fb228ed53c05f2b9d` | GitHub branches/main HTTP 200; local main/origin-main cùng giá trị |

CI-tested SHA **khác** main. `git diff --name-only <main> <CI>` chỉ có:

- `backend/scripts/audit-migration-replay.mjs`
- `backend/test/browser/support/journey-helpers.ts`
- `backend/test/operational-flow.e2e-spec.ts`
- `backend/test/p0-auth-races.e2e-spec.ts`
- `backend/test/phase7.e2e-spec.ts`

Runtime tree equivalence không phải commit equality. **Live backend vs frontend; Live vs main; Live vs CI: tất cả UNKNOWN.** Không có bằng chứng để ghi mismatch hay match cho Live pair.

**Cách đóng hiện tại, không deploy:** export Deploy details của từng service đang Live: service/deploy ID, status Live, full commit SHA hoặc image digest, deploy time và link/log identity; backend đọc riêng `RENDER_GIT_COMMIT` và `process.version` từ runtime nếu operator có shell. Chỉ xuất allowlisted fields, không dump env. Static frontend cần build/deploy record gắn đúng current Live artifact. Không yêu cầu redeploy chỉ để lấy SHA.

**Đề xuất tối thiểu cho release sau, chưa implement:** build tạo metadata cố định `{ releaseSha, builtAt, buildNodeVersion }` từ `RENDER_GIT_COMMIT` hoặc CI trusted SHA; frontend ship cùng artifact ở `/release.json`; backend đọc metadata artifact và log một lần startup cùng `runtimeNodeVersion: process.version`. Build time phải được ghi lúc build, không dùng thời điểm startup thay thế. Validate full SHA/đối chiếu trusted build source, không fallback branch HEAD. Với static site runtime là static hosting/browser, không bịa Node runtime. Chỉ expose các trường cho phép; không secret, URL DB, env dump hoặc reset token. Nếu dùng image deploy, bổ sung digest từ platform/OCI artifact. [Render xác nhận `RENDER_GIT_COMMIT`](https://render.com/docs/environment-variables) là commit SHA của service/deploy, thường có ở build và runtime.

## 4. Password-reset email staging

**Phân loại hiện tại: evidence gap về môi trường/SMTP, chưa chứng minh A hoặc B; chưa đủ bằng chứng để chốt C.** User xác nhận chưa biết staging chủ đích gửi thật hay sandbox/tắt; yêu cầu audit từ evidence có sẵn. Fake mailbox là limitation của fixture đã biết, không tự chứng minh SMTP fail, SMTP disabled hay auth reset regression.

| Câu hỏi | Bằng chứng / kết luận |
|---|---|
| Staging có được thiết kế gửi thật? | App hỗ trợ hai mode; env validation mặc định `EMAIL_DELIVERY_ENABLED=false`, chỉ tạo transporter khi true. Runbook release yêu cầu SMTP recovery/delivery PASS. Chưa có Render runtime config attestation nên ý định và mode thực tế **UNKNOWN** |
| Local env có chứng minh mode Live? | Không. Root `.env` là development, có SMTP host/user/password, port 465 nhưng `EMAIL_DELIVERY_ENABLED`, `SMTP_SECURE`, `EMAIL_FROM` không set. `.env.staging.*` cũ có enabled=true nhưng thiếu provider và không phải target runtime được operator chọn. Không in credential, không dùng chúng để suy ra Render config hoặc gửi mail |
| Forgot endpoint nhận request? | `manual-reset.json` ghi HTTP 200. Controller trả cùng message và không trả token cho client; 200 cố ý cũng áp dụng cho unknown/inactive account và các nhánh không giao mail |
| Có tạo token? | Read-only DB hiện có **một** PasswordResetToken thuộc ACTIVE CUSTOMER: created `2026-09-29T03:52:39.235Z`, expires `2026-09-29T04:07:38.823Z`, `usedAt=null`, hash length 64. Chứng minh token persistence đã chạy ở staging; không có request ID correlation đủ để quy chắc row đó cho request cụ thể trong manual report. Token đã hết hạn; không đọc/in tokenHash hay raw token |
| Có enqueue/send job đúng? | Source: controller → service commit hashed token → `enqueuePasswordReset`. Nếu enabled=false sẽ log skip; queue unavailable/enqueue failure được log nhưng request vẫn 200. Nếu enabled, deterministic job `password-reset-<requestId>`, worker gửi qua SmtpEmailSender. Read-only Redis HMGET cho request hiện có không tìm thấy job; wait/active/failed/completed đều 0. **Không thể suy ra chưa từng enqueue hoặc gửi thành công**: job success removeOnComplete=true; failed jobs có retention |
| Reset staging có hoàn tất? | Không. Manual artifact: `resetObserved=false`, old access/refresh còn 200; DB token chưa consumed. Đây là flow chưa thực hiện xong, không phải bằng chứng revocation bị lỗi sau một reset thành công |
| CI full forgot → email → reset E2E? | **Chưa.** `deploy/ci/verify.sh` và `backend/test/setup-env.ts` đặt email disabled. `auth.e2e-spec.ts` gọi HTTP forgot chỉ cho unknown email; với user thật lấy token từ `authService.requestPasswordReset`, rồi gọi HTTP reset, test one-time use và login. Redis trong suite đó mocked. P0 race dùng service reset trực tiếp. Worker unit test gọi `processPasswordReset` với fake EmailSender. Những test này chứng minh các phần auth/race/formatting, không chứng minh full queue/SMTP path |

Source evidence: [AuthController](../backend/src/modules/auth/auth.controller.ts), [AuthService](../backend/src/modules/auth/auth.service.ts), [jobs](../backend/src/modules/notifications/notification-jobs.service.ts), [sender](../backend/src/modules/notifications/email-sender.ts), [auth E2E](../backend/test/auth.e2e-spec.ts), [race E2E](../backend/test/p0-auth-races.e2e-spec.ts), [worker unit test](../backend/src/modules/notifications/notification-jobs.service.spec.ts).

**Điều kiện phân loại cuối cùng:**

- **A / auth reset logic bug:** controlled full-flow chứng minh lỗi tạo/consume token, đổi password, revoke session hoặc race. Chưa có bằng chứng A trong audit này; nếu xuất hiện thì là code release blocker.
- **B / infrastructure blocker:** operator xác nhận phải gửi thật và runtime enabled, rồi config/provider/job logs chỉ ra thiếu/sai SMTP/TLS/sender, authentication/network/recipient rejection hoặc queue failure. Chưa có bằng chứng đủ để quy B; không gọi fake mailbox là SMTP misconfiguration.
- **C / environment limitation:** operator xác nhận chủ đích disabled/sandbox/no real mailbox. Khi đó không gọi là code regression; document mode, lý do, phạm vi và tiêu chuẩn chấp nhận. Hiện mới chứng minh fixture fake, **chưa chứng minh chủ đích C**.

**Kế hoạch verify để đóng, chưa thay tests/config trong task này:**

1. Thêm controlled CI E2E ở scope sau: PostgreSQL/Redis disposable, app/controller/queue/worker/Nodemailer thật, SMTP sink riêng hoặc test harness kiểm soát. HTTP forgot cho ACTIVE fixture → đọc email trong sink → HTTP reset qua link → old access/refresh/password bị từ chối, new login/refresh thành công, replay/expired token fail, non-enumeration, deterministic race và retry/failure. Sink/test helper không được mount trong product runtime; raw token chỉ ở test process, không log/artifact public. Dependency mới nếu cần phải review theo fixed-stack rule.
2. Lấy Render config attestation đã che secret và logs liên quan request ID: enabled flag, provider mode/host classification, port/TLS, sender verified, queue ready và result skip/enqueue/send/fail. Với C, staging acceptance + token + **explicit expected skip** là bằng chứng config path hợp lệ; không biến missing job thành PASS.
3. Nếu cần delivery thực, dùng mailbox sandbox/real test mailbox và normal forgot/reset endpoints. Task audit này không tạo mailbox/account/request mới. Theo runbook hiện tại, SMTP recovery delivery là release criterion; thay bằng CI + documented C cần owner phê duyệt chính sách riêng. Không tự waive requirement.

Không tạo bypass endpoint, public reset token, token-export log hoặc sửa password trực tiếp để “test”.

## 5. Release verdict và action matrix

| Blocker | Root cause | Code issue / Infra / Historical integrity / Evidence gap | Security impact | Release impact | Required action | Needs code change? | Needs deploy? | Can be waived? | Evidence required to close |
|---|---|---|---|---|---|---|---|---|---|
| Dependency audit: ba moderate cũ + findings mới | Pinned vulnerable dependency versions; audit database hiện trả nhiều findings hơn CI cũ; root Multer override còn 2.3.0 | Dependency security + release tooling | Ba cũ B/B/D; **Engine.IO mới A theo source**, nguy cơ crash API; remaining findings có usage constraints | **BLOCKED** | Patch Engine.IO; review exact safe upgrades; Nodemailer major chỉ sau review; triage/exception theo từng advisory; full CI gồm audit/gates chưa chạy | Có: dependency/lockfile và có thể tests/gate ở task sau; không business logic | Có để đưa dependency fix lên Live, **sau audit/review/CI**, không trong task này | Ba cũ là candidates; hiện policy chưa cho waiver. Không blanket-waive Engine.IO | Clean Node 22 tree, full/prod online JSON, bounded regressions, approved scoped exceptions nếu có, canonical gate PASS |
| H2/H3 checksum | I1 thêm comment + transaction boundaries sau apply; reconstructed bytes trùng historical ledger | **Historical integrity**; không thấy schema regression trong evidence hiện có | Mất chain exact SQL-applied identity nếu bỏ qua tùy tiện; chưa có bằng chứng data tampering | Strict gate **BLOCKED** dù schema diff PASS | Review exact-pair legacy exception và provenance limitation; giữ lịch sử; refresh schema/custom catalog evidence | Chỉ tooling/tests/policy nếu chọn exception; không SQL/schema/business change | Không cần app deploy để xử lý/audit history gate | Có thể controlled exception sau approval; không có waiver đang hiệu lực | Exact pairs/target, byte proof, schema + custom constraints, approval/reason và negative gate tests |
| Exact Render frontend/backend release | Startup/asset evidence không chứa deploy SHA/digest; GitHub không có Render deployment records | **Evidence gap** | Không chứng minh code đã audit chính là code Live | Paired release integrity **BLOCKED** | Read-only Render Live deploy metadata cho từng service; runtime Node; đối chiếu CI/main | Không cần nếu platform metadata đủ; metadata logging là đề xuất cho release sau | **Không** để thu metadata hiện tại; logging mới chỉ theo release đã duyệt sau | Không thể waive thành một khẳng định SHA đã được xác minh | Service/deploy ID, Live status, full SHA/digest, timestamps, build/runtime evidence; cùng approved tested release |
| Staging reset email | Fake mailbox; mode/config/provider chưa được attested; CI chưa có full SMTP path | **Evidence gap / environment limitation đã biết ở fixture**; B/C runtime chưa phân biệt, chưa chứng minh A | Account recovery chưa được verify full path; chưa có bằng chứng auth bypass | SMTP/recovery release criterion **BLOCKED** | Controlled CI full flow + runtime config/job evidence; real/sandbox mailbox nếu policy yêu cầu | Cần bổ sung test; product change chỉ nếu sau đó tìm được A | Không cần deploy để audit; nếu B phải đổi runtime config có thể restart/redeploy sau approval | Chỉ C được xác nhận + approved alternative policy; không tự waive A/B | End-to-end reset evidence và revocation; hoặc approved C with CI full E2E + explicit staging skip/config evidence |

**PHASE 1 FUNCTIONAL: PASS** — giữ kết quả P0 business/auth logic trong phạm vi đã test: backend 479, frontend 64, DB/Nest E2E 105/22 suites, browser 8/8 và staging P0 matrix đã ghi ở báo cáo trước. Không tuyên bố full email-delivery E2E, mọi COD payout/physical GPS path hoặc exact Live source đã được chứng minh. Không phát hiện thêm business logic regression trong task audit này.

**RELEASE INTEGRITY: BLOCKED** — CI run vẫn failure; fresh dependency audit FAIL, trong đó Engine.IO có runtime exposure; applied checksum strict FAIL; Live pair chưa định danh. Exception mới chỉ là đề xuất.

**STAGING DEPLOYMENT: BLOCKED** — là verdict chấp nhận release staging, không đồng nghĩa service đang down. Latest GETs 2026-10-03 08:19 Asia/Saigon: live 200, ready 200, DB/Redis up; frontend/asset 200 và fingerprint không đổi. Hai GET backend đầu tiên timeout sau 20 giây, retry 45 giây budget trả 200; chưa xác định nguyên nhân timeout. SHA và recovery delivery criteria vẫn chưa đủ để PASS deployment.

Thứ tự tiếp theo: review báo cáo/exception policy → dependency patch và controlled reset test trong scope riêng → đóng bằng chứng Render/SMTP → chạy toàn bộ canonical CI trên một SHA được freeze → chỉ sau khi gates đạt mới lập/promote paired release. Không staging migration/reset/history rewrite trong kế hoạch này.

## 6. Evidence và checks thực hiện

| Evidence/check | Kết quả và giới hạn |
|---|---|
| Online full/prod npm audit, package/registry metadata | FAIL 9 / 8 entries; [raw JSON](PHASE1_RELEASE_CLOSURE_20261003_NPM.json). Registry xác nhận Multer 2.4.0; platform-express 11.2.6/11.2.7 dependency/peers; Nodemailer 10.0.13 engines/exports; Engine.IO 6.6.10, Axios 1.20.0, js-yaml 5.4.1, fast-uri 3.1.8 tồn tại |
| Current SQL hash / manifest / earliest Git snapshot / historical reconstruction | Hai exact historical matches; canonical current hashes khớp manifest/snapshot. `node backend/scripts/migration-integrity.mjs`: PASS 26 canonical files; lệnh này không yêu cầu Git baseline hoặc DB nên không ghi nó là applied-history PASS |
| Staging PostgreSQL/Redis | SELECT/SHOW trong read-only transactions; Redis chỉ HMGET/LLEN/ZCARD. Thu ledger metadata, reset presence/expiry/status, job absence/counts; không xuất token, password hoặc email address |
| Git/GitHub | Read-only history/ref/diff + authenticated GitHub GET; main/CI verified, run failure, deployments/status empty. Không fetch sửa refs, push, workflow dispatch hay deploy |
| Runtime GETs | Frontend/asset fingerprint; live request ID `71913288-381d-4587-9ce4-8a0e38845562`; ready request ID `70a50d78-1251-4411-ba35-a934bd53cdec`. Body chỉ health, không release metadata |
| Email local check | Hai quoted-recipient samples maintainer bị current email validator reject, normal address accepted. Không gửi SMTP; không gọi đây là full email regression suite |
| Historical functional tests | Kiểm tra retained CI log `test-results/p0-staging/ci-36518532003/1_verify.txt`, source tests và GitHub run. Không rerun application suite, migrate disposable/staging hay build trong task chỉ tài liệu |
| Documentation verification | JSON parse, local report-link checks và `git diff --check`; package/lockfile/migrations/workflow/application source không có diff mới |

Retained local evidence liên quan: `test-results/p0-staging/preflight.json`, `schema-diff.json`, `manual-reset.json`, `release-9b0ad498fa2364593472fabf714a36f8c7660549.json`, `ci-36518532003/1_verify.txt`. Các file này mô tả thời điểm riêng của chúng, không bị overwrite trong audit. Browser profiles/credential-bearing artifacts không được đưa vào tài liệu.
