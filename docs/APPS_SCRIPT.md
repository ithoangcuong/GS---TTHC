# Apps Script: schema, API và vận hành

Kiến trúc: extension read-only → registry/adapter có bằng chứng → whitelist/normalizer → `doPost` collector → tài khoản do admin cấp/RBAC → deadline/alert → GoogleSheetsRepository → dashboard HTML Service. Dashboard đăng nhập tên tài khoản/mật khẩu. Toàn bộ business function nằm trong namespace `TTHC`; public function chỉ có `doGet`, `doPost`, `rpc`. Setup/backup chỉ chạy từ Editor bằng chủ dự án.

## Schema

Headers là thứ tự bắt buộc; `setupSpreadsheet_()` chỉ nối sáu cột credentials vào đúng schema USERS 11 cột cũ, từ chối schema lạ và giữ nguyên các tab khác. Các cột encrypted chứa envelope JSON phiên bản `aes-siv-v1`, định danh khóa và ciphertext có xác thực. HMAC index có namespace riêng cho username/email/case/token và từng nguồn.

| Tab | Cột |
| --- | --- |
| USERS | user_id, email_hash, email_encrypted, display_name_encrypted, role, scope, status, created_at, updated_at, created_by, last_login_at, username_hash, username_encrypted, password_hash, must_change_password, credential_version, password_changed_at |
| CASES | record_id, case_key_hash, case_alias_hashes, source_id, payload_encrypted, crypto_version, alert_index, scope_index, updated_at, last_synced_at, last_observed_at, due_at, received_at, status_index, completion_index |
| ALERTS | alert_id, record_id, source_id, alert_type, status, scope_index, payload_encrypted, crypto_version, created_at, updated_at, acknowledged_by |
| SOURCES | source_id, name, hostname, adapter_version, adapter_status, enabled, last_observed_at, last_synced_at, synced_count, error_count, last_error |
| SOURCE_MAPPING | mapping_id, source_id, payload_encrypted, crypto_version, updated_at |
| STATUS_MAPPING | mapping_id, source_id, source_status, normalized_status, confirmed, updated_at |
| SETTINGS | key, value, updated_at |
| SYNC_LOGS | sync_id, batch_id, source_id, actor_id, status, accepted, rejected, observed_at, created_at, error_code |
| AUDIT_LOGS | audit_id, actor_id, action, target_id, source_id, details_encrypted, crypto_version, created_at |
| DASHBOARD_CACHE | cache_key, payload_encrypted, crypto_version, expires_at, updated_at, revision |
| COLLECTOR_TOKENS | token_id, token_hash, user_id, source_id, hostname, status, expires_at, created_at, revoked_at |

CASES payload chứa model canonical trong yêu cầu và chỉ field whitelist phục vụ giám sát. Metadata tùy ý, thông tin người nộp, CCCD/CMND, địa chỉ, điện thoại, tệp đính kèm và credentials bị từ chối. Các index không chứa mã hồ sơ/tên cán bộ plaintext; scope/group/search dùng HMAC. Timestamps/source/status dùng index để tổng hợp không phải giải mã toàn bộ hồ sơ. Role/scope USERS là thông tin phân quyền cho chủ Sheet; payload email/tên hiển thị được mã hóa.

Khóa/pepper chỉ ở Script Properties; key ID không chứa khóa. USERS bổ sung credentials sau 11 cột cũ, giữ email cũ để bảo toàn dữ liệu; tài khoản mới không cần email. password_hash dùng scrypt N=16384,r=8,p=5, salt riêng và HMAC prehash với LOOKUP_PEPPER. Mật khẩu mặc định ưu tiên DEFAULT_USER_PASSWORD; fallback SETTINGS.defaultUserPasswordEncrypted được mã hóa AES-SIV và không xuất qua settings.get. Session cache gắn credential_version/password_hash, bị vô hiệu khi đổi/đặt lại mật khẩu. Collector chỉ lưu HMAC token, bị thu hồi khi credentials đổi hoặc tài khoản bị tắt.

## Mã hóa miễn phí

`CryptoVendor.gs` đóng gói AES-SIV theo RFC 5297 từ `@noble/ciphers` **2.4.0**, giấy phép MIT tại [vendor/noble-ciphers-LICENSE.txt](vendor/noble-ciphers-LICENSE.txt). Cipher chạy trực tiếp trong Apps Script V8; không có CDN, Cloud KMS, provider mã hóa qua HTTP hoặc phí mỗi lần gọi. `scripts/build-crypto-vendor.mjs` tạo bundle từ dependency được pin và kiểm tra SHA-256/cú pháp. Không dùng crypto tự viết hoặc lưu plaintext khi thiếu khóa.

Khóa AES-SIV dài 64 byte được tạo bằng nguồn ngẫu nhiên mật mã Node.js trên máy quản trị; Script Property `DATA_ENCRYPTION_KEY` chứa đúng 128 ký tự hex. Cipher không đòi hỏi nguồn random của Apps Script cho nonce. Envelope và dữ liệu có xác thực để việc sửa ciphertext hoặc định danh khóa bị từ chối. `verifyCrypto_()` owner-only thực hiện roundtrip bằng cấu hình thực trong Editor, log `CRYPTO_VERIFIED`, không ghi Sheet/không trả ciphertext. `verifyKms_()` giữ làm tên tương thích và cũng chỉ kiểm tra cipher miễn phí.

Envelope gồm `version`, `keyId`, `nonce`, `ciphertext`. Ba phần associated data là tên ứng dụng/phiên bản cipher, key ID và UUID công khai. UUID không tạo khóa hoặc quyết định độ an toàn của cipher; AES-SIV vẫn xác thực khi UUID bị dùng lại. Khi cả plaintext và associated data lặp lại, ciphertext lặp lại có thể làm lộ sự trùng nhau. Hai mẫu chuẩn độc lập RFC 5297 được kiểm tra trong tests; `npm.cmd run crypto:build` tái tạo bundle và lint so sánh bundle với dependency được pin.

Thư viện noble/ciphers có lịch sử audit, nhưng audit năm 2024 cho bản 1 không chứng minh module AES-SIV của bản 2.4.0 đã được audit độc lập. Không gọi module này là đã được kiểm toán độc lập. [Phạm vi audit do tác giả công bố](https://github.com/paulmillr/noble-ciphers/tree/2.4.0#security). Mã hóa với khóa trong Script Properties bảo vệ bản sao Sheet khỏi người chỉ có workbook; người có quyền chỉnh sửa dự án Apps Script vẫn là người quản trị tin cậy, có thể đọc khóa/source. So với KMS, bản miễn phí chuyển trách nhiệm bảo vệ, sao lưu và đổi khóa cho chủ dự án.

## Mapping trạng thái đã kiểm chứng

Trạng thái client `normalizedStatus` không quyết định nghiệp vụ. Server tra `sourceStatus` trong STATUS_MAPPING của đúng nguồn với `confirmed = true`; chưa có mapping thì hồ sơ mới UNKNOWN. Khi source không gửi trạng thái trong một sparse update, giữ trạng thái cũ. Không tự xác nhận label portal dựa trên tên tiếng Việt.

Sau khi có mẫu thật, chủ dự án khai báo Script Property `VERIFIED_STATUS_MAPPING_JSON` (không chứa PII), rồi chạy `configureStatusMapping_()` trong Editor:

```json
{
  "sourceSystem": "TPHCM",
  "evidence": "Mô tả mẫu DOM/JSON đã kiểm chứng và ngày xác nhận",
  "statusMappings": {
    "NHÃN_TRẠNG_THÁI_TỪ_MẪU_THẬT": "PROCESSING"
  }
}
```

Đây là template, không phải label portal thật. Label không được có khoảng trắng đầu/cuối hoặc key `__proto__`, `constructor`, `prototype`; cấu hình lỗi bị từ chối và giữ mapping cũ. Mapping không bật extractor hoặc đổi adapter thành IMPLEMENTED. Nếu đổi mapping, sync lại các hồ sơ được quan sát để cập nhật trạng thái; không suy diễn lại snapshot lịch sử. SOURCE_MAPPING mã hóa cấu hình field mapping và xác nhận policy gia hạn; chỉ khai báo từ dữ liệu nghiệp vụ nguồn đã xác nhận.

## RPC và collector

HTML gọi `rpc(action, payload, sessionToken)` qua `google.script.run`. Thành công `{ok:true,data}`, lỗi `{ok:false,error:{code,message,requestId}}`; UI không nhận stack trace. Session token của hệ thống giám sát, không phải Google token.

| Nhóm | Actions |
| --- | --- |
| Tài khoản | auth.config, auth.login, auth.changePassword, auth.session, auth.logout |
| Hồ sơ | cases.list, cases.detail |
| Tổng hợp | dashboard.summary, statistics.summary, officers.list |
| Cảnh báo | alerts.list, alerts.acknowledge |
| Báo cáo | reports.summary, reports.export |
| Nguồn | sources.list, sources.update, sync.list |
| Users | users.list, users.create, users.update, users.resetPassword |
| Quản trị | audit.list, settings.get, settings.update |
| Token collector | extension.tokens.create, extension.tokens.revoke |

auth.login nhận {username,password}; trả sessionToken, user, permissions, mustChangePassword. auth.changePassword nhận {currentPassword,newPassword} với token và cấp phiên mới. Trước khi đổi mật khẩu mặc định, mọi RPC nghiệp vụ bị PASSWORD_CHANGE_REQUIRED. users.create nhận username/displayName/role/scope/status; trả {user,defaultPassword} chỉ cho admin có quyền cấp. users.resetPassword nhận {id}; kiểm tra quyền/phạm vi, đổi credential_version, thu hồi collector token và yêu cầu đổi lại mật khẩu. Đăng nhập giới hạn số lần thử theo tài khoản và toàn hệ thống; phiên lưu sessionStorage của tab.

Collector gửi JSON POST tới URL `/exec`:

```json
{
  "action": "collector.sync",
  "token": "TOKEN_COLLECTOR_RIÊNG",
  "sourceSystem": "TPHCM",
  "hostname": "motcua.tphcm.gov.vn",
  "batchId": "batch-id-khong-doi-khi-retry",
  "cases": []
}
```

`cases` thực tế cần 1–200 record. Envelope trên mô tả cấu trúc, không phải request có dữ liệu thật. Batch retry giữ ID. Token gắn nguồn/hostname/tài khoản và có hạn; `doPost` không chấp nhận session dashboard thay token collector. ContentService chuyển hướng tới `script.googleusercontent.com`; manifest/CSP chỉ cho các Google origin cụ thể. Không gửi cookies hoặc Google OAuth token từ extension.

## Deadline và cache

Ngưỡng mặc định warningSeconds=172800, staleSeconds=86400. Deadline dùng timestamp nguồn, không countdown. Hoàn thành ≤ hạn → ON_TIME, sau hạn → LATE. Hủy/trả lại không sinh overdue. Thiếu hạn/completedAt/trạng thái chắc chắn → NEEDS_REVIEW. PAUSED/chờ bổ sung không tự cộng thời gian. dueAt:null rút hạn hiện tại, không phục hồi originalDueAt cũ làm kết luận. Gia hạn chỉ khi server configuration và source record được xác nhận.

Danh sách, KPI và cảnh báo đánh giá timestamp lúc đọc; không cần quét/decrypt mọi payload mỗi phút. Cache theo role/scope/filter/revision, hết hạn tại biên deadline/freshness hoặc tối đa 60 giây. Auth đọc USERS trước cache và snapshot kiểm tra lại, nên disable/sửa scope không dùng được cache cũ. Chỉ giải mã payload trong trang hoặc representative của nhóm top10; export hồ sơ tối đa 2.000 để giới hạn thời gian chạy và bộ nhớ. Chưa có benchmark tải thật trong Apps Script; mục tiêu 10k và mở rộng50k còn cần load test trong quota miễn phí.

## Ghi dữ liệu và phục hồi

AES-SIV encrypt/decrypt chuẩn bị bên ngoài lock và chạy trong cùng tiến trình Apps Script, không tạo URL Fetch cho mã hóa. Commit dùng ScriptLock, revision chống concurrent stale update và setValues theo dải dòng liên tiếp. Không appendRow theo từng record. Snapshot giữ trước commit để rollback nếu lỗi trả về; Google Sheets không có ACID nhiều tab. REPOSITORY_PENDING giữ thông tin lần ghi, REPOSITORY_BLOCKED đánh dấu rollback thất bại; không tiếp tục đọc/ghi trên kho chưa kiểm tra. Marker gián đoạn cần chủ dự án phục hồi/kiểm tra bản backup trước khi xóa.

`backupSpreadsheet_()` sao chép workbook, không thay workbook hiện có. Backup dùng dung lượng Drive đang có và không chứa khóa mã hóa. Lưu riêng key ID, khóa hiện tại/cũ và pepper trong nơi được bảo vệ. Mất khóa có thể khiến dữ liệu/backup không giải mã được; mất pepper cần phục hồi/migration chỉ mục. Không tạo lại secret mỗi lần deploy.

Đổi khóa: giữ khóa cũ trong `DATA_ENCRYPTION_PREVIOUS_KEYS` dưới dạng JSON object key ID → khóa 128 hex; đặt key ID mới và khóa mới vào `DATA_ENCRYPTION_KEY_ID` / `DATA_ENCRYPTION_KEY`. Các bản ghi mới dùng khóa mới, bản ghi/backup cũ dùng đúng ID cũ. Không xóa khóa cũ khi vẫn còn dữ liệu dùng nó. Chưa có migration tự động toàn bộ ciphertext/pepper; cần thử trên bản sao trước production.

Source cũ có envelope `kms-v1` không được tự đổi sang plaintext hoặc tự gọi provider trả phí. Nếu có dữ liệu KMS từ một triển khai khác, cần kế hoạch migration riêng trước khi chuyển; workbook hiện tại chưa được dùng để nhập hồ sơ KMS.

## Dependency và giới hạn kiểm tra

Node.js24/TypeScript/Playwright/esbuild phục vụ phát triển, build cipher và hồi quy source cũ; không cần server Node khi Apps Script vận hành. Clasp3.4.1 chỉ là công cụ đồng bộ local. `npm audit` ở lần kiểm tra trước báo3 high do chuỗi clasp→micromatch→braces và [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); advisory chưa có patched version lúc đó. Globs `.claspignore` do dự án kiểm soát và không lấy từ HTTP/client. Không gọi đây là audit sạch; theo dõi bản clasp/braces đã sửa. Không downgrade cưỡng bức sang major2 hay chép crypto từ CDN để che cảnh báo.

Clasp đã liên kết tài khoản chủ dự án. `gas:status` kiểm tra file local; `gas:push` có backup và đọc lại remote, deployment cần chọn phiên bản mới. Khóa/pepper trong file riêng `data/admin-bootstrap-private/script-properties.txt`; credentials khởi tạo ở `data/account-bootstrap-private/credentials.json`. Cả hai thư mục bị loại khỏi build/Git. Hướng dẫn tại [GOOGLE_SETUP.md](GOOGLE_SETUP.md); phạm vi kiểm chứng tại [COMPLETION.md](COMPLETION.md).

Dashboard không dùng Google OAuth và không cần KMS, Secret Manager, Cloud Run, VPS hoặc domain riêng. Quota Apps Script/Sheets vẫn áp dụng; không tự bật billing hoặc trả phí vượt quota. [Quotas chính thức](https://developers.google.com/apps-script/guides/services/quotas).
