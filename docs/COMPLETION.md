# Báo cáo hoàn thiện TTHC Monitor — cập nhật 09/10/2026

## Tài khoản do admin cấp — 09/10/2026

- Web App đã triển khai **phiên bản 7**, giữ URL `/exec`; API deployment đọc lại xác nhận phiên bản 7. Source backup tại `data/apps-script-backups/2026-10-09T06-57-43-512Z/`; 23 file remote đọc lại khớp source local.
- Bỏ Google/email OAuth khỏi đăng nhập dashboard. Form tên tài khoản/mật khẩu, admin cấp tài khoản với một mật khẩu mặc định, đặt lại mật khẩu và yêu cầu đổi lần đầu. Không có đăng ký công khai; quyền/phạm vi vẫn kiểm tra ở backend.
- Tài khoản **admin / SUPER_ADMIN / ACTIVE** đã được cấp trên workbook thật, giữ user_id và 11 cột dữ liệu cũ. Thêm USERS!L:Q; cấu hình mật khẩu mặc định mã hóa tại SETTINGS!A5:C5, audit tại AUDIT_LOGS!A5:H5. Readback kiểm tra toàn bộ giá trị mới và dữ liệu admin cũ đạt. Không ghi mật khẩu plaintext hoặc khóa/pepper vào Sheet/audit.
- Credentials bàn giao riêng tại `data/account-bootstrap-private/credentials.json`, bị loại khỏi Git/build. Admin dùng mật khẩu khởi tạo riêng; mật khẩu mặc định cho các tài khoản tiếp theo hiện qua UI khi admin cấp/đặt lại.
- Kiểm tra local: **npm.cmd run check PASS — lint, TypeScript, 225/225 tests, build**, thêm 1/1 regression khôi phục giới hạn đổi mật khẩu sau admin reset. GAS browser smoke toàn bộ và auth-only PASS; extension browser smoke PASS.
- Regression bao gồm KDF đối chiếu độc lập Node crypto, default password mã hóa, quyền admin/phạm vi, đổi mật khẩu bắt buộc, thu hồi phiên/collector khi reset/disable, không hồi sinh phiên sau bật lại, interleaving reset/đổi mật khẩu/cấp collector và khôi phục sau giới hạn thử sai.
- Edge trên deployment thật lúc **13:59 (UTC+7)**: HTTP200, form tên tài khoản/mật khẩu, không có nút Google, configured=true, không thiếu property, không có JavaScript error.
- Đăng nhập **admin thật lúc 14:00 (UTC+7)** PASS: username=admin, role=SUPER_ADMIN, mustChangePassword=true; dashboard.summary bị PASSWORD_CHANGE_REQUIRED như thiết kế, đăng xuất thành công. Giữ mật khẩu khởi tạo và yêu cầu đổi lần đầu để chủ tài khoản tự đặt mật khẩu riêng. Báo cáo: `data/preview/account-admin-live-login-check.json`; ảnh thật: `data/preview/account-admin-first-login-live.png`.
- Phạm vi kiểm chứng live: tài khoản admin, phiên, chặn trước đổi mật khẩu và đăng xuất. Cấp/reset user và dashboard được kiểm thử đầy đủ bằng fixture local; chưa tạo tài khoản thử hoặc hồ sơ thử trên workbook thật. Cả 11 adapter portal tiếp tục WAITING_FOR_SAMPLE.

Hướng dẫn hiện hành: README.md và GOOGLE_SETUP.md. Các mục ngày 07–08/10 dưới đây là lịch sử triển khai Google OAuth, không phải luồng đăng nhập hiện tại.

## Cập nhật đăng nhập admin ngày 08/10/2026

- Web App đã cập nhật **phiên bản 6**, giữ URL `/exec`. Backup source trước sửa tại `data/apps-script-backups/2026-10-08T06-20-00-970Z/`; đọc lại bản cuối tại `data/apps-script-backups/2026-10-08T06-22-59-407Z/verified-remote/`, 23 file khớp local.
- Đã sửa đăng nhập bị hủy do `popup.closed` khi Google tách WindowProxy, thêm nút hủy và bảo vệ khỏi response cũ sau hủy. Cấu hình chưa đủ thì nút đăng nhập khóa; hướng dẫn admin liệt kê tên property thiếu/sai, không trả secret.
- `verifyAdminLogin_` là hàm Editor private, owner-only, kiểm tra 8 Properties, crypto roundtrip, 11 schema, HMAC và danh tính SUPER_ADMIN ACTIVE hiện có; không ghi Sheet hoặc tự cấp phiên.
- `npm.cmd run check` **PASS: lint, TypeScript, 210/210 tests, build**; 43 kiểm thử Apps Script. Browser login và toàn bộ smoke dùng GAS/RPC/cipher thật với Google/Sheets giả lập đạt. Bao gồm hủy trước callback, response thành công đến sau hủy, Google popup báo closed giả, khôi phục phiên khi reload, logout, whitelist deny và proof sai/thiếu/storage bị chặn.
- Ban đầu `/exec` thiếu 6 Properties. Đã sửa ACL thư mục/file cấu hình riêng để Windows Administrator đọc được; chủ dự án đã nạp cấu hình và gửi log Editor ngày 08/10/2026: `CRYPTO_VERIFIED` rồi `ADMIN_LOGIN_SETUP_VERIFIED`, execution completed lúc 14:10:49.
- Kiểm tra Edge ẩn danh trên `/exec` thật lúc **14:11 (UTC+7)** với `--require-ready`: **PASS**, HTTP200, `configured: true`, `setupIssues: []`, nút đăng nhập bật, không lỗi JavaScript, login/callback cùng origin và storage. Báo cáo tại `data/preview/admin-login-live-check.json`.
- Còn cần đăng nhập Google thật bằng admin đã cấp để nghiệm thu OAuth/dashboard. Kiểm tra Editor và readiness Web App không thay thế việc đăng nhập Google thật.

## Báo cáo nền ngày 07/10/2026

Theo yêu cầu mới, bản đang hoàn thiện chỉ dùng thành phần không cần trả phí: Apps Script, Google Sheets, OAuth định danh Google và extension Load unpacked. Cloud KMS được thay bằng AES-SIV từ `@noble/ciphers` 2.4.0 đóng gói trong Apps Script; khóa/pepper ở Script Properties. Không cần billing, Secret Manager, VPS, domain riêng, Docker hoặc Vercel.

Đã hoàn tất bản miễn phí: cipher AES-SIV thật trong source/test, clasp backup/push/readback **23 file**, Web App **phiên bản 4**, kiểm tra Edge ẩn danh **HTTP200** và giao diện đăng nhập không lỗi JavaScript. Workbook có 11 tab ứng dụng, 3 SETTINGS, 11 SOURCES và **một SUPER_ADMIN ACTIVE cho ithoangcuong@gmail.com**; hàng tài khoản/nhật ký mã hóa đọc lại và giải mã kiểm chứng đạt. Chủ dự án còn cần nạp Script Properties và tạo OAuth client miễn phí; chưa nghiệm thu đăng nhập Google/nghiệp vụ/portal live. Cả 11 extractor chờ mẫu thật.

## A. Source đã audit

Dự án đầu vào có Node.js24, SQLite, ES modules, TypeScript engine, web HTML/CSS/JS, Google OIDC/service-account Sheets integration, MV3 extension, importer/exporter, migration và158 test baseline. Không có Apps Script/clasp trước yêu cầu này. Không có Git repository hoặc AGENTS.md trong workspace được kiểm tra. Bản README cũ nhận định thư mục trống là lịch sử trước đó, không phải trạng thái hiện tại.

Audit remote đúng Script ID người dùng: chỉ có `Code.js` với `myFunction()` trống và manifest V8 mặc định. Đã lưu bản sao trước push tại `data/apps-script-backups/2026-10-07T00-35-12-093Z/`; thư mục `verified-remote/` chứa 22 file đọc lại sau push.

| Phân loại | Kết quả và xử lý |
| --- | --- |
| KEEP | Server Node, tests, SQL migrations, importer/exporter, shared domain/legacy registry; giữ để tương thích/hồi quy. |
| REFACTOR | Dùng lại phong cách CSS/UI, chuyển transport sang google.script.run; extension thêm endpoint Apps Script, allowlist, nguồn đúng11host. |
| BROKEN so với kiến trúc yêu cầu | Node /api và ES module web assets không chạy trực tiếp trên HTML Service; local-password flow/role cũ không đáp ứng bản Google-only. Thêm target Apps Script thay vì phá source legacy. |
| MISSING đã bổ sung | Apps Script modules, USERS whitelist/RBAC6role, hashed/encrypted Sheets schema, setup/bootstrap, dashboard freshness/cache, OAuth callback proof, clasp config/snapshot tooling. |

## B. Kiến trúc cuối

Một MV3 extension →11sourceadapter → whitelist/normalizer → Apps Script collector doPost → token scope + USERS ACTIVE → Cases/Deadline/Alerts → GoogleSheetsRepository → HTML Service UI/RPC. Google account xác minh qua server OAuth code exchange và userinfo HTTPS; token Google không lưu. Repository abstraction cô lập SpreadsheetApp khỏi nghiệp vụ. AES-SIV chạy trực tiếp trong Apps Script, không gọi API mã hóa có phí; khóa dài 64 byte, pepper và OAuth secret giữ riêng trong Script Properties.

## C. File đã tạo

- `apps-script/Code.gs`, `Router.gs`, `Auth.gs`, `Permissions.gs`, `Users.gs`, `Cases.gs`, `Deadline.gs`, `Alerts.gs`, `Dashboard.gs`, `Reports.gs`, `Sources.gs`.
- `apps-script/Crypto.gs`, `SheetRepository.gs`, `Settings.gs`, `Audit.gs`, `Utils.gs`, `Setup.gs`, `appsscript.json`.
- `apps-script/CryptoVendor.gs`, `scripts/build-crypto-vendor.mjs`, `crypto-vendor-entry.mjs`, `docs/vendor/noble-ciphers-LICENSE.txt` cho cipher nguồn mở được pin phiên bản.
- `apps-script/Index.html`, `Styles.html`, `Scripts.html`, `OAuthCallback.html`.
- `.clasp.json` local liên kết Script ID người dùng, `.clasp.example.json`, `.claspignore`.
- `scripts/check-apps-script.mjs`, `push-apps-script.mjs`, `apps-script-browser-smoke.mjs`.
- `scripts/prepare-google-admin.mjs` chuẩn bị kế hoạch ghi tài khoản mã hóa từ metadata Google thật; không tự ghi Google/đưa secret vào kế hoạch.
- `tests/apps-script-foundation.test.mjs`, `apps-script-business.test.mjs`, `helpers/apps-script.mjs`, `extension-gas.test.mjs`, `extension-browser-smoke.mjs`.
- Extension registry11source, normalizer riêng và adapter skeleton `mof.mjs`, `moha.mjs`, `moc.mjs`, `moit.mjs`, `mae.mjs`, `moh.mjs`, `moet.mjs`, `moj.mjs`, `bvhttdl.mjs`, `bdttg.mjs`.
- `docs/APPS_SCRIPT.md`, `COMPLETION.md`, `LEGACY_NODE.md`, `GOOGLE_SETUP.md` với URL/ID thật và các bước cấu hình miễn phí, tạo admin trước OAuth.

## D. File đã sửa

`README.md`, `.gitignore`, `package.json`, `package-lock.json`, `scripts/check.mjs`, `scripts/build.mjs`; extension manifest/build, adapters base/registry/tphcm, background worker, content collector/bundle, popup/options, transport sync, extension README; `docs/ADAPTERS.md`, `tests/collector.test.mjs`. Thay KMS provider bằng cipher miễn phí, bỏ scope cloud-platform, cập nhật version metadata, tests/harness và hướng dẫn. `.dockerignore` giới hạn build context để không gửi tệp cấu hình riêng. `deploy/README.md` ghi rõ Node/Docker/nginx là tùy chọn legacy. Không xóa dữ liệu SQLite hiện có. Giai đoạn tạo schema đã thêm 11 tab còn thiếu vào workbook GC-TTHC, giữ Sheet1 lúc đó; không seed hồ sơ mô phỏng.

## E. Chức năng hoàn thành trong source

Google-only UI, proof-bound OAuth callback, whitelist deny, admin cấp email/role/scope/enable/disable, kiểm tra quyền server, token collector riêng có hạn/thu hồi. Setup/bootstrap owner-only một lần. Batch1–200, validation whitelist/type/datetime/source/hostname, mapping nguồn đã xác nhận, dedup source/aliases, stale observation skip, merged record validation, optimistic revision/lock, rollback và interruption marker.

Deadline48h lấy SETTINGS, completion timing, review khi thiếu dữ liệu/paused/chờ bổ sung, không gia hạn tự suy diễn. Alert WARNING/OVERDUE/STALE_DATA/NEEDS_REVIEW và lỗi sync, dedup/ack đúng quyền. KPI, biểu đồ native, nhóm top10, trang hồ sơ/chi tiết/lọc/tìm/phân trang, nguồn/cán bộ/báo cáo ngày-tuần-tháng/CSV/settings/audit/sync. `lastObservedAt`, `lastSyncedAt`, stale và tỷ lệ quan sát24h tách rõ. Loading/empty/error/denied/retry; desktop1366/1440/1920 và mobile390 được kiểm tra.

Các lỗi security phát hiện/sửa có regression: forwarded OAuth URL, invalid token expiry, stale actor sau disable, cache scope, client normalizedStatus tự nhận COMPLETED, sparse chronology/steps/extension, CSV formula, payload ngoài whitelist. Scope hợp lệ 100 đơn vị hoạt động qua hồ sơ/dashboard/cache; scope JSON vượt 45.000 ký tự bị từ chối trước ghi USERS. Drilldown dùng khóa nhóm đầy đủ ngay cả khi nhãn hiển thị được rút gọn. Mapping từ Editor bắt buộc owner và evidence, từ chối label không khớp sau trim hoặc key prototype. Không có production mock fallback, tự tạo account Google hoặc fake realtime.

## F. Adapter hoạt động thật

**Không có extractor portal nào được kiểm chứng live.** Core nhận diện host, parser DOM cấu hình có bằng chứng, visibility, whitelist và batch transport được kiểm tra bằng fixture synthetic. Không coi fixture hoặc normalization là adapter portal đã hoạt động thật.

## G. Adapter chờ sample

TPHCM, MOF, MOHA, MOC, MOIT, MAE, MOH, MOET, MOJ, BVHTTDL, BDTTG đều WAITING_FOR_SAMPLE. Cần URL danh sách, DOM/JSON được phép đã khử PII/credential, login marker độc lập, sample response và phân trang. Chưa có mẫu thì không đoán selector/endpoint; hướng dẫn ở ADAPTERS.md.

## H. Google Sheet schema

11tab: USERS, CASES, ALERTS, SOURCES, SOURCE_MAPPING, STATUS_MAPPING, SETTINGS, SYNC_LOGS, AUDIT_LOGS, DASHBOARD_CACHE, COLLECTOR_TOKENS. Headers và field chính xác tại APPS_SCRIPT.md/SheetRepository.gs. Các tab đã được tạo trên [GC-TTHC](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit) qua Google Drive/Google Sheets connector, đọc lại khớp 11 schema, 3 SETTINGS và 11 SOURCES. Header freeze/format được xác nhận qua API, chưa kiểm tra fit bằng native UI. CASES chưa có hồ sơ thật; trạng thái tạo admin cập nhật ở mục N sau readback. Dữ liệu nhạy cảm dùng AES-SIV có xác thực; email/case/scope/group/search/token lookup dùng HMAC. Chưa migrate Permissions/GS_Data/SQLite cũ hoặc ciphertext KMS từ triển khai khác.

## I. Script Properties

SPREADSHEET_ID, BOOTSTRAP_EMAIL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, WEB_APP_URL, DATA_ENCRYPTION_KEY, DATA_ENCRYPTION_KEY_ID, EMAIL_PEPPER, LOOKUP_PEPPER; DATA_ENCRYPTION_PREVIOUS_KEYS và VERIFIED_STATUS_MAPPING_JSON tùy chọn. Không còn yêu cầu KMS_KEY_NAME/KMS_PREVIOUS_KEY_NAMES hoặc Cloud KMS IAM. SPREADSHEET_ID đã xác nhận là `18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU`; BOOTSTRAP_EMAIL là `ithoangcuong@gmail.com`; WEB_APP_URL ở bên dưới.

File cấu hình riêng `data/admin-bootstrap-private/script-properties.txt` đã chuẩn bị các giá trị thật cho 7 Properties trước OAuth, có kiểm tra quyền truy cập file và không được đóng gói. Chủ dự án cần chép chính các giá trị đó vào Editor. Không tạo lại khóa/pepper khi đã có tài khoản/dữ liệu mã hóa. Chưa xác nhận Properties đã được lưu trên Google; OAuth client/secret chưa được tạo. Không đưa secret vào source/chat/Sheet/extension.

## J. Chạy trong VS Code

Node24 → `npm.cmd install --cache ./.npm-cache` → `npm.cmd run check`; browser `npm.cmd run test:browser:gas` / `test:browser:extension`. Apps Script UI chạy tại deployment `/exec`, không dùng npm start của Node legacy. Local browser harness có nhãn synthetic riêng.

## K. Clasp push

Script ID đã liên kết: `10R_pm-x2OKH4P8BepiUNVauH8ONRBCDy-m0iQZW09_YyrCJsRNbXl9wz`. Clasp login đã hoàn tất. Bản miễn phí đã backup → push **23 file** → pull vào thư mục riêng → đối chiếu toàn bộ source/manifest **PASS**, tại `data/apps-script-backups/2026-10-07T06-09-33-651Z/verified-remote/`. Wrapper xử lý manifest với `--force` sau backup và đối chiếu nội dung thay vì chỉ exit code. Clasp không có push --dry-run; dùng status/file syntax check.

## L. Deploy Web App

Deployment hiện tại **phiên bản 4**: [Web App /exec](https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec). API xác nhận WEB_APP, ANYONE_ANONYMOUS và USER_DEPLOYING, giữ URL cũ. Fresh Edge ẩn danh trả **HTTP200**, title TTHC Monitor, tải HTML Service thật và hiển thị thông báo thiếu cấu hình OAuth, không lỗi JavaScript. Ảnh thật `data/preview/apps-script-live-login.png` đã xem; lỗi HTTP403 trước đây không lặp lại ở lần kiểm tra này. Public render PASS; chưa có đăng nhập Google/nghiệp vụ live PASS.

Điền URL trên vào WEB_APP_URL và OAuth redirect; cấu hình khóa/pepper và tài khoản admin trước vận hành. Google-only backend authorization vẫn bắt buộc dù trang login public. Phiên bản triển khai mới phải được cập nhật khi source thay. Cần nghiệm thu cùng-origin localStorage callback thật; browser chặn storage sẽ bị từ chối an toàn.

## M. Cài extension

`npm.cmd run extension:build`; Chrome/Edge Developer mode → Load unpacked `extension/`. Không xuất bản Chrome Web Store trong cấu hình này vì đăng ký nhà phát triển có phí. Nhập `/exec` và collector token từ dashboard. Portal người dùng tự login; token không phải Google/portal token. Chưa có mẫu source thì thu thập bị chặn với lý do rõ.

## N. Bootstrap admin

**Đã tạo admin ithoangcuong@gmail.com**, SUPER_ADMIN/ACTIVE/phạm vi toàn hệ thống. Google Sheets batchUpdate ghi `USERS!A2:K2` và `AUDIT_LOGS!A2:H2` trong cùng batch, giữ headers và dữ liệu khác. Readback khớp kế hoạch; giải mã email/tên, HMAC email và nội dung audit bằng thư viện thật **PASS**. `created_by`/actor ghi `OWNER_AUTHORIZED_TOOL`, không giả nhận đã chạy Editor. Không có email/tên plaintext, khóa hoặc pepper trong Sheet. Đây là tạo tài khoản thật trước OAuth, chưa là đăng nhập thành công.

Chủ dự án chép Properties có sẵn → Editor chạy **verifyCrypto_** → setupTthcMonitor_. Nếu USERS đã có SUPER_ADMIN thì bootstrap đóng; nếu chưa có, chạy **bootstrapAdmin_**. Hàm owner-only/private suffix `_`, không cần OAuth client để tạo admin. Tạo tài khoản chưa cho phép đăng nhập khi OAuth chưa cấu hình. Giữ ít nhất một SUPER_ADMIN ACTIVE; backup workbook và khóa/pepper riêng. `verifyCrypto_` không ghi Sheet/không trả ciphertext, log CRYPTO_VERIFIED khi đạt.

## O. Test đã chạy

Baseline158test và bản trước195test đã đạt. Bản miễn phí có **37 test Apps Script**: foundation10, business18, crypto9; các kiểm tra crypto dùng cipher thật thay cho HTTP stub. Hai vector RFC5297 A.1/A.2 độc lập khớp; kiểm tra JSON/Unicode30.000byte, sửa nonce/keyID/tag/body, khóa thiếu/sai, previous keys, nonce dùng lại, giới hạn và không gọi HTTP đều **PASS**. Repository10.000row/batch cập nhật100row và các regression quyền/OAuth vẫn đạt.

Bản miễn phí `npm.cmd run check` **PASS: lint JS/Apps Script, TypeScript, 204/204 tests, build**. Bundle được đối chiếu với dependency pin; Node original package ↔ Apps Script IIFE tương thích trên 10 kích thước 0–30.000 byte. Kiểm tra secret không có trong source Apps Script/dist đạt. Không gọi test local là nghiệm thu OAuth/portal/Apps Script live; roundtrip bằng Properties thật trong Editor còn chờ chủ dự án.

Chrome/Edge browser test với **RPC/source production và encrypted synthetic fixtures** PASS: OAuth pending/actual callbackHTML, proof thiếu/sai bị từ chối trước exchange, storage bị chặn, whitelist denial, KPI/source drilldown/search/pagination/detail,11skeleton, ack,CSV,usercreate/disable/settings,VIEWERscope/deny,responsive và không có JSerror. Synthetic DOM collector browser PASS: visible rows/text, không đọc PII ngoài mapping, UTC+07,lastObservedAt,loginmarkerẩn bị chặn. Screenshots `data/preview/apps-script-*.png` có nhãn synthetic.

`gas:push`/readback23 file PASS, deployment API version4/access/url đọc lại; public browser HTTP200/giao diện login PASS. Sheets schema/seed và tài khoản/audit mã hóa readback PASS. `npm audit` vẫn báo3high ở devdependency clasp/micromatch/braces; chi tiết trong APPS_SCRIPT.md. Không claim audit sạch hoặc module AES-SIV 2.4.0 đã audit độc lập.

## P. Lỗi/TODO và điều kiện bên ngoài

- Chủ dự án lưu file cấu hình riêng vào Script Properties, cấp quyền trong Editor, chạy verifyCrypto_ và nghiệm thu đăng nhập.
- Tạo OAuth client/secret/redirect bằng project không billing; tài khoản admin không thay thế cấu hình đăng nhập Google.
- Nghiệm thu OAuth callback storage trên HTML Service origin thực; thiếu storage failclosed.
- Cung cấp mẫu portal đã khử PII và mapping status/field có bằng chứng; hiện11adapter chờ mẫu.
- Load test Apps Script/Sheets thật, thời gian cipher local, quota miễn phí, concurrent collector và vận hành10k; chưa cam kết50k+. Không tự nâng gói hoặc bật trả phí vượt quota.
- Sheets không có ACID nhiều tab; marker cần chủ dự án kiểm tra phục hồi sau gián đoạn. Chưa có migration tự động legacy→GAS hoặc rotation pepper/toàn bộciphertext.
- Theo dõi dependency advisory devtool clasp; production Apps Script/extension không bundle clasp/braces.

Hướng dẫn thao tác tại README.md, APPS_SCRIPT.md và GOOGLE_SETUP.md. Bản mã miễn phí đã kiểm thử/đồng bộ/triển khai, public UI và tài khoản admin thật đã kiểm chứng. Script Properties, authorization, OAuth và portal chưa nghiệm thu không được ghi là hoàn tất. Khóa và pepper do chủ dự án bảo vệ/sao lưu; mất chúng có thể mất khả năng đọc ciphertext/backup.
