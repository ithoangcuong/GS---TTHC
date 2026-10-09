# Thiết lập tài khoản admin và mật khẩu

Từ 09/10/2026, dashboard dùng **tên tài khoản + mật khẩu do admin cấp**, bỏ đăng nhập email/Google OAuth. BOOTSTRAP_EMAIL chỉ xác minh chủ dự án khi chạy setup từ Editor.

## Sử dụng

1. Mở [Web App](https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec), nhập tài khoản **admin** và mật khẩu khởi tạo đã bàn giao.
2. Đổi mật khẩu khi ứng dụng yêu cầu. Các RPC nghiệp vụ bị chặn đến khi đổi.
3. Vào **Người dùng → Cấp tài khoản**, nhập tên tài khoản, tên hiển thị, vai trò và phạm vi; không cần email.
4. Bàn giao mật khẩu mặc định xuất hiện sau khi tạo. Người dùng đổi mật khẩu khi đăng nhập lần đầu.
5. Khi người dùng quên mật khẩu, admin chọn **Đặt lại mật khẩu**. Phiên và collector token cũ bị thu hồi.

Không có tự đăng ký hay tự nâng quyền.

## Workbook hiện có

Workbook [GC-TTHC](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit) có admin SUPER_ADMIN/ACTIVE đã mã hóa. Chuyển đổi bổ sung USERS!L:Q, giữ USERS!A:K và user_id cũ.

Mật khẩu admin/mặc định được tạo trong file riêng data/account-bootstrap-private/credentials.json. Toàn bộ data/ bị loại khỏi Git và build. Không đưa khóa/pepper vào chat, Sheet hoặc source.

DEFAULT_USER_PASSWORD trong Script Properties có ưu tiên. Nếu thiếu, backend đọc SETTINGS.defaultUserPasswordEncrypted, giải mã bằng khóa hiện có và chỉ trả mật khẩu cho admin sau cấp/đặt lại tài khoản. settings.get không trả cấu hình này.

## Workbook mới hoặc chuyển đổi từ Editor

Script Properties:

- SPREADSHEET_ID, DATA_ENCRYPTION_KEY, DATA_ENCRYPTION_KEY_ID, LOOKUP_PEPPER.
- BOOTSTRAP_EMAIL là email Google của chủ dự án chạy Editor.
- BOOTSTRAP_USERNAME có thể bỏ trống để dùng admin.
- BOOTSTRAP_PASSWORD là mật khẩu admin đầu tiên; bỏ trống dùng mật khẩu mặc định.
- DEFAULT_USER_PASSWORD: mật khẩu mặc định, 10–128 ký tự.
- EMAIL_PEPPER giữ cho dữ liệu email cũ; WEB_APP_URL đặt URL /exec.

Chạy **setupTthcMonitor_** để tạo tab/seed hoặc nối thêm đúng cột USERS còn thiếu; từ chối schema lạ, giữ dữ liệu.

Chạy **bootstrapAdmin_** để cấp credentials. Nếu admin SUPER_ADMIN cũ khớp BOOTSTRAP_EMAIL chưa có credentials, hàm cập nhật chính tài khoản đó. Nếu SUPER_ADMIN đã có credentials, bootstrap đóng; chạy lại không đặt lại mật khẩu.

Chạy **verifyAdminLogin_** để kiểm tra cấu hình, crypto, schema và admin. Đây là kiểm tra chỉ đọc, không cấp phiên hay chứng minh đăng nhập thật.

Hàm setup có hậu tố _ và chỉ chủ dự án được chạy từ Editor.

## Đồng bộ và kiểm chứng

```powershell
npm.cmd run check
npm.cmd run test:browser:gas
npm.cmd run gas:push
npm.cmd run test:login:live -- --require-ready
```

Sau push cập nhật deployment sang phiên bản mới, giữ URL /exec. Kiểm tra live mặc định chỉ đọc form/cấu hình; xem docs/COMPLETION.md về phạm vi nghiệm thu.

Không cần OAuth client/redirect/popup/callback cho người dùng. Quyền Google để chủ dự án chạy Apps Script/SpreadsheetApp vẫn được cấp riêng.

Bảo vệ workbook và sao lưu khóa/pepper. Không tạo lại chúng khi chuyển đăng nhập: dữ liệu cũ và password prehash phụ thuộc đúng secret hiện có. Scrypt dùng profile N=16384,r=8,p=5 được [OWASP liệt kê](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).