# Bảo mật và giới hạn vận hành

Tài liệu mô tả cơ chế đã có trong source và các việc còn cần triển khai trước môi trường dữ liệu hành chính thật. Không thay thế kiểm thử bảo mật độc lập hoặc xác nhận nghiệp vụ. Chi tiết tích hợp nguồn nằm trong [ADAPTERS.md](ADAPTERS.md).

## Ranh giới tin cậy và dữ liệu

Portal và DOM là đầu vào cần kiểm tra; extension là collector trong trình duyệt của người đã đăng nhập; central API là nơi xác thực/phân quyền và xác định dữ liệu hợp lệ trước database. Quyền truy cập portal không tự động cấp quyền đọc mọi dữ liệu central. Mỗi request central kiểm tra tài khoản hiện còn active và scope từ database.

Người dùng tự đăng nhập 11 portal. Source không lưu username/password của portal, không vượt CAPTCHA/OTP/SSO, không đọc cookies hoặc token portal. Extension không có quyền `cookies`, không chặn network để lấy session, không có bridge `window.postMessage` giữa webpage và worker. Chỉ gửi trường hồ sơ được phép; query/hash của source URL bị loại.

`metadata` được kiểm tra JSON, giới hạn độ sâu 8, không có tham chiếu vòng, không có `__proto__`/`prototype`/`constructor`. Tên key chứa các biến thể password/cookie/session/token/authorization/secret/OTP/credential/private key/CSRF/API key bị chặn đệ quy. Giới hạn hiện đo `JSON.stringify(...).length <= 16384` ký tự JavaScript; đây không phải phép đếm byte UTF-8. Cơ chế này không tự nhận diện mọi bí mật bị giấu trong tên field tùy ý hoặc text: người tích hợp vẫn phải không đưa credentials vào hồ sơ/evidence.

Field canonical được allowlist; field lạ và trường kết quả do server tính bị bỏ khỏi normalization đầu vào. Chuỗi canonical tối đa 1.000 ký tự, loại ký tự điều khiển không hợp lệ. Timestamp được chuẩn hóa UTC từ ISO có múi giờ hoặc định dạng Việt Nam đã xác định UTC+07. Đầu vào invalid bị báo lỗi theo record; server kiểm tra cả record sau khi merge update với dữ liệu cũ.

## Xác thực central

Mật khẩu tài khoản trung tâm dài 12–256 ký tự, lưu dưới dạng salt riêng 16 byte và `scrypt` với `N=16384`, `r=8`, `p=1`, key 64 byte. Kiểm tra hash dùng `timingSafeEqual`. Username không tồn tại vẫn đi qua dummy scrypt để hạn chế khác biệt thời gian đơn giản. Không có mật khẩu mặc định public; `npm run setup` tạo admin với `ADMIN_PASSWORD` nếu được cấu hình hoặc một mật khẩu ngẫu nhiên, in đúng lúc khởi tạo. Giữ bí mật output này; tài khoản đã có được giữ nguyên.

Session token và collector token đều có entropy từ `randomBytes(32)` và chỉ lưu SHA-256 của token trong database. Session CSRF token ngẫu nhiên riêng được gắn với session. API public user không trả passwordHash. Log lỗi request chỉ ghi request ID/event/error type cho lỗi nội bộ; audit thông thường lưu hành động và các chi tiết cho phép, không lưu token/password/cookie.

Session mặc định 8 giờ; `SESSION_HOURS` được giới hạn 1–24 giờ. Collector token mặc định 30 phút; `COLLECTOR_TOKEN_MINUTES` được giới hạn 5–60 phút. Collector token chỉ được gọi `POST /api/collector/sync`; `VIEWER` không được cấp token. Thay role/scope/active của user qua API quản trị xóa cả session và collector tokens của user đó. Logout xóa session hiện tại và thu hồi tất cả collector token của user trong cùng transaction.

Cookie `gs_session` có `HttpOnly`, `SameSite=Strict`, path `/`, Max-Age theo session; `Secure` được thêm trong production. Các thao tác đổi dữ liệu dùng session phải có `X-CSRF-Token` đúng. Origin được kiểm tra khi gửi mutating request; collector dùng Bearer token riêng. API token không được đặt trong URL.

Hiện chưa có MFA, SSO central, quên/reset mật khẩu tự phục vụ, đổi mật khẩu self-service, trang quản lý/revoke từng collector token hoặc chính sách khóa tài khoản bền vững. Có giới hạn request đăng nhập theo IP kết nối, không phải cơ chế khóa tài khoản đầy đủ.

## HTTPS và HTTP server

`NODE_ENV=production` yêu cầu `APP_ORIGIN` dùng HTTPS. Node server hiện là HTTP server, mặc định bind `127.0.0.1`; production cần reverse proxy kết thúc TLS và giữ backend trong mạng riêng/loopback. Đặt Host forwarding đúng với `APP_ORIGIN`. Không dùng `allowAnyHost` trong production; đó là tùy chọn của factory cho môi trường kiểm thử.

Production bật HSTS `max-age=31536000`, cookie Secure. Mọi response có nosniff, Referrer-Policy `no-referrer`, X-Frame-Options `DENY`, Permissions-Policy chặn camera/microphone/geolocation và CSP chỉ dùng tài nguyên self, không cho object/frame embedding/base URI ngoài self. Response JSON và export có `Cache-Control: no-store`. Static file được resolve trong web root và kiểm tra prefix, không phục vụ database, `.env` hay server source qua static route.

Collector CORS chỉ áp dụng `/api/collector/sync` cho Origin có dạng extension Chromium hợp lệ; Bearer authentication và scope vẫn bắt buộc. CORS không đóng vai trò xác thực. Chưa cấu hình allowlist một extension ID doanh nghiệp cụ thể; nếu cần managed deployment, thêm chính sách đó và kiểm thử cùng Chrome/Edge được quản lý.

Request timeout 30 giây, headers timeout 15 giây, keepalive timeout 5 giây. Central collector body tối đa 2MiB; JSON body thông thường tối đa 15MiB; login và source mutation tối đa 4KiB; rule/user payload có giới hạn riêng nhỏ hơn. Không chấp nhận body ngoài `application/json` cho các route đọc JSON.

## RBAC và phạm vi dữ liệu

Quyền nằm ở backend, không chỉ ở UI. `scopeWhere()` bổ sung source/agency/department/officer vào truy vấn danh sách, dashboard, báo cáo, alerts, notifications và catalogs; lookup hồ sơ/history kiểm tra `hasAccess()`. Upsert kiểm tra cả dữ liệu hiện tại và record sau cập nhật, không cho user sửa một hồ sơ nằm ngoài scope rồi chuyển hồ sơ vào scope của mình.

| Role | Phạm vi tối thiểu và thao tác hiện có |
|---|---|
| `SYSTEM_ADMIN` | Toàn hệ thống; tạo/sửa user; đọc audit; cấu hình rule/calendar; bật/tắt nguồn; đọc/sync/import/acknowledge |
| `CENTRAL_ADMIN` | Source được cấp, thêm scope tùy chọn; đọc/sync/import/acknowledge; xem settings và bật/tắt nguồn được cấp |
| `AGENCY_LEADER` | Danh sách source và `agencyId` bắt buộc; đọc/sync/import/acknowledge trong scope |
| `DEPARTMENT_LEADER` | Danh sách source và `departmentId` bắt buộc; đọc/sync/import/acknowledge trong scope |
| `OFFICER` | Danh sách source và `officerId` bắt buộc; đọc/sync/import/acknowledge trong scope |
| `VIEWER` | Danh sách source, các scope ID tùy chọn; chỉ đọc dữ liệu được cấp; không token/sync/import/acknowledge |

Đây là role matrix đang thực thi, chưa phải permission engine tùy biến từng hành động. Cấp thêm agency/department/officer ID nếu vai trò cần giới hạn hẹp hơn. ID phải khớp catalog/source thực tế; không dùng tên hiển thị để cấp quyền. SQL filter dùng bind parameters; sort/order nằm trong allowlist. Pagination server giới hạn tối đa 100 hồ sơ/trang; export giới hạn 10.000 dòng.

`VIEWER` nhận applicantName đã mask theo từng phần tên, không nhận `metadata` của hồ sơ và metadata change trong history. ApplicantName change trong history được mask. Báo cáo export dùng cùng `caseView()`. Các role khác được xem PII trong scope, vì vậy cần cấp đúng role và hạn chế xuất file. Sync job chi tiết của user không phải SYSTEM_ADMIN được giới hạn user đã thực hiện; source record count được tính theo scope. Source last-error/last-success của user không phải SYSTEM_ADMIN cũng lấy từ job của user, không xác nhận login state của portal.

## Đồng bộ, chống trùng và lịch sử

Khóa đối chiếu là source + sourceRecordId/sourceCaseId/caseCode, không dùng caseCode toàn cục. Alias mâu thuẫn hoặc thay đổi ID nguồn không nhất quán được trả lỗi, không tự gộp hồ sơ. `lastSourceUpdateAt` cũ hơn bản lưu được skip nếu cả hai bên có timestamp. Record không có timestamp nguồn vẫn chưa có cơ chế bảo đảm thứ tự giữa nhiều collector đồng thời; cần chính sách provenance/version trước khi nhiều người sync cùng hồ sơ.

Mỗi record có transaction riêng; rollback record lỗi không bỏ dữ liệu record hợp lệ. Batch có ID để trả lại kết quả trước theo user/source/ID. Server ghi sync job, case changes, alert history, notification và audit. Alert một hồ sơ được deduplicate theo case; acknowledge không mất khi mức cảnh báo giữ nguyên, mức thay đổi có thể mở/escalate lại theo mã hiện tại.

Audit gồm login, cấp token, sync/import, export, cấu hình, acknowledge và user updates. Case history có thể chứa PII nên áp dụng scope và mask giống chi tiết. SQLite audit hiện là bảng trong cùng database; chưa có append-only storage/tamper evidence, lịch retention hoặc export audit ra SIEM.

## CSV/XLSX và file không tin cậy

`server/import.mjs` parse nội bộ không chạy macro/formula, không fetch external relationship, không ghi nội dung ZIP ra filesystem. Chỉ nhận `.csv` UTF-8 hoặc `.xlsx`; không hỗ trợ `.xls`/`.xlsm`, ZIP64/multi-disk/encrypted workbook. Base64 được kiểm tra cấu trúc và kích thước trước decode.

| Giới hạn | Mã hiện tại |
|---|---|
| File upload đã decode | 10MiB |
| Tổng kích thước ZIP expanded | 32MiB |
| Số ZIP entries | 2.000 |
| Dòng dữ liệu import/export | 10.000 |
| Cột | 200 |
| XML nesting | 64 mức |
| XML nodes mỗi part | 1.000.000 |
| Preview trả về UI | Tối đa 20 dòng dữ liệu |

ZIP kiểm tra đường dẫn an toàn, tên trùng, header/local consistency, spans chồng lấn, kích thước và CRC; inflate có `maxOutputLength`. XML từ chối DTD, external entity và processing instruction không hỗ trợ; parser có giới hạn cấu trúc. Workbook chỉ đọc sheet đầu tiên. Formula cell bị từ chối kể cả khi có cached value; người dùng cần chuyển thành giá trị trước import. External relationship không được dereference; parts quan trọng có quan hệ external bị chặn.

CSV export thêm prefix cho chuỗi bắt đầu bằng công thức `=`, `+`, `-`, `@`, kể cả khi bị che bởi whitespace/control, và escape quotes/delimiters. XLSX export dùng inline strings cho text để chuỗi dạng công thức vẫn là literal, escape XML và không tạo macro. Giới hạn memory/CPU này không thay antivirus hoặc sandbox process cho môi trường upload không tin cậy quy mô lớn; importer hiện chạy trong Node process của API.

## Rate limiting

Các bộ đếm hiện nằm trong memory của một process, theo `req.socket.remoteAddress` + nhóm route:

| Nhóm | Giới hạn |
|---|---|
| API nói chung | 600 request/phút |
| Login | 10 request/15 phút |
| Cấp collector token | 10 request/phút |
| Collector sync | 30 request/phút |
| Import | 10 request/phút |
| Export | 5 request/phút |

HTTP 429 báo cần chờ. Source/session/role validation vẫn áp dụng khi dưới ngưỡng. Trong kiến trúc reverse proxy, nhiều user có thể cùng `remoteAddress` của proxy và dùng chung bucket. Không tự tin cậy `X-Forwarded-For` chưa cấu hình. Trước multi-instance cần trusted-proxy policy và rate limit phân tán ở proxy/gateway hoặc shared store; process restart hiện reset bộ đếm.

## Quyền tối thiểu của extension

Manifest dùng `storage`, `activeTab`, `alarms`; content script là `ISOLATED`, top frame, trên exact portal hostnames. Có 11 nguồn và 12 hostname vì MOC có alias người dùng cung cấp. Không `<all_urls>`, wildcard domain, remote script hay web-accessible module.

Central origin production được khai báo đúng origin bằng `EXTENSION_CENTRAL_ORIGIN` lúc build và yêu cầu optional permission khi người dùng lưu kết nối. Localhost/127.0.0.1 là quyền tùy chọn phát triển; HTTP bị chặn cho host khác. Worker nhận lệnh chỉ từ popup/options extension; content script nhận lệnh collector chỉ từ cùng extension, không xử lý thông điệp từ webpage. Website không được yêu cầu worker fetch một URL bất kỳ hoặc truy cập token qua cầu nối.

Token và pending records ở `chrome.storage.session` với `TRUSTED_CONTEXTS`; cấu hình local storage cũng giới hạn trusted contexts. Worker state gửi tới popup loại token và batches; popup chỉ biết có token hay chưa, cùng summary. Token không đồng bộ bằng chrome.storage.sync. Fetch đến central dùng `credentials: omit`, `redirect: error`, Bearer central token riêng, timeout và bounded retry. Pending job lỗi không cho đổi central origin trong khi vẫn giữ batches, tránh gửi token mới về central cũ.

Session memory không phải kho được mã hóa chống người có quyền máy hoặc DevTools extension. Browser restart/reload/disable/update xóa session, không bền qua restart. Người vận hành phải bảo vệ tài khoản hệ điều hành, browser profile và extension đã cài; chỉ phân phối build được review.

## Deadline, risk và dữ liệu chưa xác nhận

Ngày hẹn chính thức của nguồn là căn cứ; countdown không được nhập làm deadline. Engine dùng gia hạn hợp lệ nếu có, rồi dueAt hiện tại; dueAt được gửi rõ `null` không quay về ngày hẹn cũ để tự kết luận overdue. Original due được giữ cho traceability. Hoàn thành chỉ so `completedAt` với official due khi đủ cả hai; thiếu timestamp trở thành completion `UNKNOWN`/needsReview.

Mặc định `UNKNOWN`, `PAUSED`, chờ bổ sung và chờ người dân là `NEEDS_REVIEW`, không tự quyết định tính/không tính hạn. Calendar chưa confirmed không cho tính SLA bằng ngày làm việc. Nguồn đã có dueAt thì không tự tính lại bằng thứ Bảy/Chủ nhật/ngày lễ. Ngưỡng cảnh báo và trọng số risk là cấu hình vận hành, không phải thời hạn pháp lý. Rule/risk được giải thích bằng triggeredRule/riskReasons; không có LLM/AI quyết định hồ sơ trễ.

Chưa có quy tắc pháp lý riêng cho từng thủ tục, lịch nghỉ/làm bù đã xác nhận, pause accounting hoặc gia hạn tự suy diễn. Các phần này cần dữ liệu/chính sách nghiệp vụ được xác nhận trước khi bật; không coi tính năng cấu hình mở là bằng chứng quy tắc đã đúng.

## Database, backup và triển khai

Database SQLite dùng foreign keys, WAL, busy timeout và migration có bảng version. `npm run backup` dùng online backup API của Node SQLite; không ghi đè file backup đã tồn tại. Lệnh có thể chọn đường dẫn đích qua `npm run backup -- <path>`. Backup mặc định đặt trong `data/backups/`, chứa dữ liệu dân cư/case history và hash xác thực; cần quản lý cùng mức quyền với database.

Không copy riêng file SQLite đang chạy và coi đó là backup đầy đủ trong chế độ WAL. Dùng lệnh backup, chuyển bản sao tới kho được cấp quyền, kiểm tra restore ở môi trường cách ly. Source chưa có encryption at rest, mã hóa backup, backup schedule, rotation, retention, restore UI hoặc replication tự động; phải cấu hình ở hạ tầng và có quy trình vận hành. Đặt ACL database/backup chỉ cho service account và quản trị được phép. Không đặt database dưới web root.

Production cần HTTPS proxy, secret/config qua môi trường được bảo vệ, database volume riêng, thu thập log không có PII/credentials ngoài nhu cầu và giám sát engine sweep/backup. Không đưa `.env`, token, mật khẩu khởi tạo, private key, database thật hoặc fixture chưa xử lý PII vào repository. Demo dùng database riêng và dữ liệu minh họa; không dùng tài khoản/dữ liệu demo để nghiệm thu nguồn thật.

## Việc còn cần trước production dữ liệu thật

1. Nghiệm thu ít nhất một adapter bằng DOM/API thật, phiên có quyền, logged-out blocking, timezone và pagination; kiểm thử Chrome/Edge trực tiếp.
2. Chốt role/scope, quyền thu thập/xuất hồ sơ, dữ liệu tối thiểu và quy trình lưu giữ/xóa/ẩn PII. VIEWER mask là cơ chế hiện có, chưa phải đánh giá đầy đủ mọi PII của cơ quan.
3. Chốt nghiệp vụ pause/chờ/bổ sung/gia hạn/lịch và provenance của workflow trước khi đánh giá SLA/risk từ các trường đó.
4. Triển khai TLS, ACL/encryption theo hạ tầng, backup/restore định kỳ, retention, theo dõi audit và giới hạn request phù hợp trusted proxy.
5. Bổ sung self-service/password recovery/MFA/SSO và token revoke nếu mô hình vận hành yêu cầu; đánh giá chính sách collector-token khi central logout.
6. Kiểm thử tải với lượng hồ sơ thực, nhiều collector đồng bộ, queue/recalculation và contention SQLite; xem xét PostgreSQL khi cần nhiều instance/ghi đồng thời. Chưa có số liệu benchmark chứng minh đáp ứng 100.000 hồ sơ.
7. Hoàn thiện redacted fixture/provenance, mapping editor có audit và isolated importer hoặc scanning nếu nhận upload ngoài nhóm được cấp quyền.

Đây là các phần chưa được source hiện tại tự động bảo đảm; không có chứng nhận production/security/legal compliance nào được suy ra chỉ từ việc lint/test/build đã pass.
# Google và Google Sheet

Chế độ `AUTH_MODE=google` xác minh chữ ký Google ID token, issuer/audience, hạn dùng, nonce, email đã xác minh; luồng code dùng PKCE và state một lần gắn với cookie trình duyệt. Không tự liên kết tài khoản nội bộ chỉ vì trùng email; định danh ổn định dùng Google `sub`. Đăng nhập mật khẩu nội bộ bị chặn trong chế độ Google.

Quyền được đọc từ Sheet riêng tư và kiểm tra trên backend cho mỗi session/token. Toàn bộ bảng quyền phải hợp lệ; email thiếu/khóa bị từ chối. Cập nhật quyền thu hồi session và collector token. Đọc Sheet thất bại thì chặn truy cập cho đến lần đồng bộ thành công, không cấp quyền từ cấu hình nội bộ cũ.

Service account và OAuth secret chỉ đặt trên máy chủ. `secrets/` và `.env` được loại khỏi source build. Tab `GS_Data` chứa dữ liệu nghiệp vụ gồm hồ sơ và nhật ký; không lưu mật khẩu/hash mật khẩu, session, collector token hoặc khóa Google vào workbook. Mọi người được chia sẻ workbook có thể xem dữ liệu ở đó ngoài cơ chế phân quyền của ứng dụng; chỉ chia sẻ workbook cho quản trị viên tin cậy và service account. Người dùng thường truy cập qua ứng dụng.

