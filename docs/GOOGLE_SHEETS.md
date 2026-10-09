# Đăng nhập Google và quản lý dữ liệu bằng Google Sheet

Workbook đã được cấu hình trong [mẫu môi trường Google](../.env.google.example):
[GS-TTHC trên Google Sheet](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit).
Chế độ này dùng Google để xác nhận người đăng nhập, tab `Permissions` để cấp quyền và tab `GS_Data` để lưu bền vững toàn bộ dữ liệu nghiệp vụ. Các tab hiện có khác được giữ nguyên. Link workbook chưa đủ để máy chủ đọc/ghi: cần hoàn tất cấu hình Google bên dưới. Việc kiểm thử bằng API giả lập không xác nhận đã kết nối workbook thật.

## Chuẩn bị Google Cloud

1. Tạo hoặc chọn Google Cloud project, bật **Google Sheets API**.
2. Tạo **service account**, tải khóa JSON và lưu riêng trên máy chủ tại `secrets/google-service-account.json`. Chia sẻ workbook cho email `client_email` của service account với quyền **Editor**. Giữ workbook riêng tư. Service account đọc bảng quyền và ghi dữ liệu; người sử dụng ứng dụng không cần được chia sẻ workbook.
3. Cấu hình OAuth consent screen, thêm tài khoản thử nghiệm nếu ứng dụng còn ở chế độ Testing. Tạo OAuth client loại **Web application**. Đây là credential khác với service account.
4. Thêm Authorized redirect URI chính xác: `http://localhost:3000/api/auth/google/callback` khi chạy local. Khi triển khai thật, dùng `https://ten-mien-cua-ban/api/auth/google/callback` và đặt `APP_ORIGIN` tương ứng. `localhost` và `127.0.0.1` là hai origin khác nhau.
5. Sao chép `.env.google.example` thành `.env`, điền `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET` ngay trên máy chủ. Không đưa khóa JSON, client secret, token hoặc mật khẩu vào Sheet hay chat.

Google mô tả riêng [credential cho Google Workspace](https://developers.google.com/workspace/guides/create-credentials) và [OAuth cho ứng dụng máy chủ](https://developers.google.com/identity/protocols/oauth2/web-server). Không cần domain-wide delegation cho cách chia sẻ riêng workbook này.

Trong PowerShell tại thư mục dự án:

```powershell
Copy-Item -LiteralPath .env.google.example -Destination .env
# Điền GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET và đặt khóa service account đúng đường dẫn.
npm.cmd run setup:google
npm.cmd start
```

`setup:google` tạo bảng quyền nếu chưa có, với `ithoangcuong@gmail.com` là `SYSTEM_ADMIN`. Nếu tab đã có nội dung, lệnh kiểm tra mẫu hiện tại và giữ nguyên dữ liệu; kiểm tra tài khoản quản trị đã có dòng hợp lệ trước khi đăng nhập. Mẫu [Permissions.csv](Permissions.csv) có thể nhập thủ công vào một tab mới tên `Permissions`. Không dùng lệnh `setup` tạo quản trị mật khẩu cục bộ cho cache Google.

Mẫu môi trường bật `AUTH_MODE=google`, `DATA_BACKEND=google_sheets`, `DATABASE_PATH=./data/google-cache.sqlite`. Dùng cache riêng, không trỏ vào cơ sở dữ liệu đang có tài khoản/hồ sơ cục bộ. Khi gặp dữ liệu cục bộ không có dấu nhận diện cache Google, máy chủ từ chối tự chuyển dữ liệu lên Sheet.

## Cấp và thu hồi quyền

Hàng đầu tab `Permissions` cần đủ tám cột sau, không có cột mật khẩu:

| Cột | Giá trị |
| --- | --- |
| `email` | Email Google đã xác minh; mỗi email chỉ có một dòng. |
| `displayName` | Tên hiển thị. |
| `role` | Một trong sáu vai trò bên dưới. |
| `sourceSystems` | Mã nguồn cách nhau bằng dấu phẩy, ví dụ `MOC,TPHCM`; không dùng hostname hay dấu `*`. |
| `agencyId` | ID cơ quan khi cần giới hạn tới một cơ quan. |
| `departmentId` | ID phòng khi cần giới hạn tới một phòng. |
| `officerId` | ID cán bộ khi cần giới hạn tới một cán bộ. |
| `active` | `TRUE` để cho phép, `FALSE` để thu hồi. |

| Vai trò | Phạm vi cần cấp |
| --- | --- |
| `SYSTEM_ADMIN` | Truy cập toàn hệ thống; các cột phạm vi có thể để trống. |
| `CENTRAL_ADMIN` | Bắt buộc liệt kê `sourceSystems`. |
| `AGENCY_LEADER` | `sourceSystems` và `agencyId`. |
| `DEPARTMENT_LEADER` | `sourceSystems` và `departmentId`. |
| `OFFICER` | `sourceSystems` và `officerId`. |
| `VIEWER` | `sourceSystems`; quyền đọc trong phạm vi đã cấp. |

Dùng ID thực từ danh mục ứng dụng; tên cơ quan/phòng không thay thế được ID. Không tự cấp tất cả nguồn cho một tài khoản khi cột nguồn trống. Chỉ người quản trị bảng quyền cần quyền Editor trên Sheet, vì người sửa bảng này có thể cấp quyền quản trị ứng dụng.

Sau khi thêm dòng hợp lệ, người dùng chọn **Đăng nhập Google**. Ứng dụng chỉ cho đăng nhập nếu email có dòng hoạt động. Tài khoản trong cache được tạo sau lần đăng nhập đầu; danh sách quyền trên giao diện vẫn hiển thị các dòng Sheet chưa đăng nhập. Đăng nhập không tự tạo quyền từ email/domain.

Mỗi lần xác thực API kiểm tra snapshot quyền, làm mới theo `PERMISSIONS_REFRESH_SECONDS` (mặc định 30 giây). Thay đổi vai trò, phạm vi, tên hoặc trạng thái thu hồi phiên và collector token của tài khoản liên quan. Xóa dòng cũng thu hồi quyền. Thông thường thay đổi có hiệu lực trong một chu kỳ làm mới; quản trị có thể chọn **Đồng bộ quyền** trên giao diện để đọc ngay. Nếu bảng có dòng sai, trùng email, nguồn không được nhận diện hoặc Google không đọc được, hệ thống từ chối quyền thay vì sử dụng quyền cục bộ. `PERMISSIONS_MAX_AGE_SECONDS` giới hạn tuổi snapshot; lỗi đọc đã phát hiện làm snapshot không khả dụng ngay.

OAuth chạy ở backend, kiểm tra state gắn với trình duyệt, PKCE, nonce, chữ ký Google, audience, issuer, hạn token và `email_verified`. Mật khẩu Google không đi qua ứng dụng. Token Google chỉ tồn tại trong bộ nhớ xử lý, không nằm trong Sheet. Chế độ Google không cho đăng nhập bằng mật khẩu cục bộ hay sửa vai trò bằng API quản trị cục bộ.

## Dữ liệu trong workbook và cache

`GS_Data` là tab hệ thống ghi tự động. Mỗi sự kiện có `eventId`, `batchId`, `tableName`, `key`, `operation`, `partIndex`, `partCount`, `payload`, `checksum`. Dữ liệu nằm trong JSON `payload`, bao gồm nguồn, ánh xạ trường/trạng thái, danh mục, hồ sơ, định danh đồng bộ, lịch sử hồ sơ, lần đồng bộ, quy tắc cảnh báo, cảnh báo, lịch sử cảnh báo, thông báo, cấu hình và nhật ký kiểm toán. Tài khoản chỉ lưu thông tin công khai, Google subject và email. Hãy chỉnh hồ sơ, danh mục và cấu hình qua ứng dụng; chỉnh quyền tại `Permissions`. Không sửa, sắp xếp, xóa hàng hay chèn công thức vào `GS_Data`.

SQLite vẫn là cache truy vấn trên máy chủ để dashboard và bộ lọc chạy nhanh, đồng thời giữ hàng đợi những lượt ghi chưa xác nhận. Google Sheet là nơi lưu bền vững dữ liệu nghiệp vụ. Backend chờ ghi và đọc lại dấu `COMMIT` trước khi trả thành công cho API. JSON dài được chia thành phần không quá 40.000 ký tự và yêu cầu ghi được giữ dưới 1,8 MB. Cả batch chỉ được khôi phục khi đủ phần, đúng checksum và có `COMMIT`. Retry sau mất phản hồi dùng lại cùng định danh và chấp nhận bản sao giống nhau.

Nếu Google không khả dụng khi ghi, API trả lỗi `503`; dữ liệu có thể đã cập nhật trong cache và vẫn chờ xác nhận. Giao diện quản trị hiển thị số sự kiện đang chờ, thời điểm lưu cuối và lỗi lưu. Không xóa cache đang có hàng đợi. Khi khởi động lại, máy chủ phục hồi các batch đã xác nhận từ Sheet rồi áp lại hàng đợi cục bộ; lần thử lại xác nhận batch đã có trên Sheet trước khi ghi bổ sung. Collector giữ batch lỗi để thử lại theo định danh batch gốc; người nhập file nên kiểm tra kết quả trước khi gửi lại.

Phiên ứng dụng, collector token, CSRF token, password hash, OAuth secret và khóa service account không được gửi lên workbook. Đây là dữ liệu xác thực cục bộ có thời hạn, không phải dữ liệu nghiệp vụ. Cache mới có thể dựng lại dữ liệu đã xác nhận từ Sheet, nhưng không dựng lại phiên đăng nhập cũ hoặc lượt ghi chưa kịp lên Sheet. Cần sao lưu cả cache khi đang có sự kiện chờ.

Máy chủ không ghi đè một tab `GS_Data` có tiêu đề khác mẫu, không dùng cache thuộc workbook khác, và dừng nếu phát hiện log đã xác nhận bị cắt hoặc checksum không còn hợp lệ. Khi có lỗi này, dừng tiến trình ghi, giữ nguyên cache và kiểm tra lịch sử phiên bản Google Sheet trước khi phục hồi. Checksum phát hiện lỗi dữ liệu; người có quyền sửa toàn workbook vẫn có thể sửa cả payload và checksum, vì vậy quyền Editor cần được quản lý chặt chẽ.

## Giới hạn triển khai

Chỉ chạy **một tiến trình máy chủ** cho một workbook/cache. Chưa có khóa ghi phân tán hay cơ chế gộp sửa trực tiếp các bản ghi JSON trên Sheet. Log tích lũy theo mọi thay đổi; chưa có lệnh compact tự động. Cần theo dõi dung lượng workbook và hàng đợi trước khi dùng cho lưu lượng lớn. Benchmark 100.000 hồ sơ SQLite trong dự án không đo độ trễ hoặc thông lượng lưu Google Sheet.

Google Sheets API có quota đọc/ghi mặc định 60 yêu cầu mỗi phút cho một người dùng trong một project; Google khuyến nghị payload tối đa 2 MB. Khôi phục log đọc từng trang 100 hàng, có thể chạm quota khi log lớn; khi Google từ chối, cache được giữ để khởi động/thử lại sau. Workbook có giới hạn tổng cộng 10 triệu ô, bao gồm tab quyền và các tab khác. Xem [quota Sheets API](https://developers.google.com/workspace/sheets/api/limits) và [giới hạn Google Drive/Sheets](https://support.google.com/drive/answer/37603). Chế độ này phù hợp cho lưu lượng đã kiểm chứng trong workbook thực, chưa có cam kết vận hành nhiều máy chủ hay dữ liệu không giới hạn.

Các kiểm thử `tests/google-oidc.test.mjs`, `tests/google-sheets.test.mjs`, `tests/google-auth-integration.test.mjs` và `tests/sheet-store.test.mjs` kiểm tra đăng nhập, bảng quyền và nhật ký lưu bằng dịch vụ giả lập. Chạy `npm.cmd run check` để kiểm tra mã; hoàn tất credential rồi kiểm tra đăng nhập/lưu thật trên workbook riêng trước khi đưa hồ sơ thật vào hệ thống.
