# TTHC MONITOR

Hệ thống giám sát tiến độ giải quyết hồ sơ thủ tục hành chính dùng **Google Apps Script HTML Service + Google Sheets + extension Chrome/Edge Manifest V3**. Đăng nhập bằng **tên tài khoản và mật khẩu do admin cấp**, không cần email/Google OAuth.

## Tài khoản

- Admin đầu tiên: **admin**, vai trò SUPER_ADMIN, giữ định danh và dữ liệu admin hiện có.
- Admin mở **Người dùng → Cấp tài khoản**, nhập tên tài khoản, tên hiển thị, vai trò và phạm vi. Hệ thống cấp mật khẩu mặc định, hiển thị để admin bàn giao.
- Người dùng đổi mật khẩu mặc định ở lần đăng nhập đầu tiên.
- **Đặt lại mật khẩu** cấp lại mật khẩu mặc định và thu hồi phiên/collector token cũ.
- Không có đăng ký công khai. ADMIN cấp quyền trong phạm vi của mình; SUPER_ADMIN quản lý tài khoản quản trị.

Hướng dẫn cài đặt và chuyển admin cũ: [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md). Tên file được giữ để các liên kết cũ tiếp tục hoạt động.

## Kiểm tra local

Dùng Node.js 24.x, mở PowerShell tại thư mục này:

```powershell
npm.cmd install --cache ./.npm-cache
npm.cmd run check
npm.cmd run test:browser:gas
npm.cmd run test:browser:extension
```

Browser test cần Chrome/Edge hoặc BROWSER_PATH. Harness chạy HTML/RPC/cipher thật với Sheets giả lập, có nhãn **SYNTHETIC LOCAL TEST HARNESS**. Kết quả local không thay kiểm chứng Apps Script thật.

Source Apps Script nằm trong apps-script/. Server Node.js/SQLite cũ được giữ để hồi quy; npm start chạy bản legacy, xem [docs/LEGACY_NODE.md](docs/LEGACY_NODE.md).

## Cấu hình và triển khai

Script ID: 10R_pm-x2OKH4P8BepiUNVauH8ONRBCDy-m0iQZW09_YyrCJsRNbXl9wz. Workbook: [GC-TTHC](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit).

| Script Property | Nội dung |
| --- | --- |
| SPREADSHEET_ID | ID workbook hiện có. |
| BOOTSTRAP_EMAIL | Email chủ dự án, chỉ kiểm tra quyền setup từ Editor. |
| BOOTSTRAP_USERNAME | Tên admin đầu tiên, mặc định admin. |
| BOOTSTRAP_PASSWORD | Mật khẩu khởi tạo admin, chỉ dùng khi chưa có credentials. |
| DEFAULT_USER_PASSWORD | Mật khẩu mặc định admin cấp. Nếu thiếu, đọc defaultUserPasswordEncrypted đã mã hóa trong SETTINGS. |
| WEB_APP_URL | URL /exec cho dashboard và extension. |
| DATA_ENCRYPTION_KEY | Khóa AES-SIV hiện có, 128 ký tự hex. |
| DATA_ENCRYPTION_KEY_ID | Định danh khóa hiện có. |
| LOOKUP_PEPPER | Secret tối thiểu 32 ký tự cho username/token/password prehash. |
| EMAIL_PEPPER | Giữ nguyên để đọc chỉ mục email admin cũ. |
| DATA_ENCRYPTION_PREVIOUS_KEYS | Tùy chọn: khóa cũ để đọc ciphertext/backup. |

GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET không còn dùng cho đăng nhập dashboard. Giữ nguyên khóa/pepper của dữ liệu hiện có. Mật khẩu lưu dưới dạng scrypt với salt riêng và secret prehash; mật khẩu mặc định trong SETTINGS mã hóa AES-SIV. Không lưu mật khẩu plaintext vào Sheet/audit.

```powershell
npm.cmd run gas:status
npm.cmd run gas:push
```

gas:push sao lưu source remote trước push và đọc lại để đối chiếu. Cập nhật deployment hiện có sang phiên bản mới sau kiểm tra. Web App chạy **Execute as: Me**, **Who has access: Anyone**; backend kiểm tra phiên, tài khoản ACTIVE và quyền ở mỗi RPC.

[Web App /exec](https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec). Trạng thái triển khai/kiểm chứng: [docs/COMPLETION.md](docs/COMPLETION.md).

Đã triển khai phiên bản 7 và kiểm chứng đăng nhập admin thật ngày 09/10/2026. Tài khoản **admin** cần đổi mật khẩu khởi tạo khi đăng nhập lần đầu. Thông tin khởi tạo được bàn giao riêng trong data/account-bootstrap-private/credentials.json.

## Nghiệp vụ và extension

Role: SUPER_ADMIN, ADMIN, LEADER, MANAGER, OFFICER, VIEWER. Scope: sources, agencies, departments, officers; dấu * cấp toàn bộ một chiều. Cảnh báo mặc định 48 giờ, stale 24 giờ; lấy timestamp hạn trả chính thức.

Extension cài bằng Load unpacked sau npm.cmd run extension:build. Người dùng tự đăng nhập portal hợp lệ, mở dashboard bằng tài khoản admin cấp, tạo collector token cho nguồn/hostname rồi nhập URL /exec và token vào extension.

**Cả 11 adapter đang WAITING_FOR_SAMPLE**: cần DOM/JSON thật đã khử PII/credential và mapping có bằng chứng. Xem [docs/ADAPTERS.md](docs/ADAPTERS.md) và [extension/README.md](extension/README.md).

Không cần VPS, domain riêng, Cloud KMS, Vercel hoặc billing cho bản Apps Script. Quota/dung lượng Google vẫn áp dụng, không tự nâng gói. Kiến trúc/schema/RPC: [docs/APPS_SCRIPT.md](docs/APPS_SCRIPT.md).
