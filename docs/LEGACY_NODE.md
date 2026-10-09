# Giám sát và cảnh báo hồ sơ TTHC

Ứng dụng giám sát tập trung chạy với database và API thật: đăng nhập, phân quyền, dashboard, hồ sơ, cảnh báo, lịch sử, quản lý nguồn, nhập/xuất Excel/CSV, báo cáo và extension Chrome/Edge.

**Google Sheet của hệ thống:** đã bổ sung đăng nhập Google, quản lý quyền theo email và lưu toàn bộ dữ liệu nghiệp vụ vào [workbook được cung cấp](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit). Tab `Permissions` quản lý vai trò/phạm vi; tab `GS_Data` lưu nhật ký dữ liệu để khôi phục. SQLite là bản đệm truy vấn trong chế độ này. Mẫu quản trị đầu tiên: `ithoangcuong@gmail.com`. Cần cấu hình Google OAuth và service account để kết nối thật; chưa có thông tin xác thực nên chưa ghi vào workbook.

```powershell
Copy-Item .env.google.example .env
# Điền GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET trong .env và đặt khóa service account tại đường dẫn được cấu hình.
# Chia sẻ workbook cho email service account với quyền Editor.
npm.cmd run setup:google
npm.cmd start
```

Hướng dẫn tab/cột, OAuth, quyền chia sẻ, lưu dữ liệu và phục hồi: [docs/GOOGLE_SHEETS.md](docs/GOOGLE_SHEETS.md). Mẫu bảng quyền: [docs/Permissions.csv](docs/Permissions.csv). Không cần chạy `setup` tạo tài khoản mật khẩu khi dùng chế độ Google.

**Audit đầu vào:** `D:\CODE\GS-TTHC` là thư mục trống, không có repository Git, source hay stack cũ. Vì vậy phiên bản này được tạo mới; không có module cũ bị thay thế. Node.js 24, SQLite tích hợp, ES modules và giao diện HTML/CSS/JavaScript. Engine nghiệp vụ dùng TypeScript. Runtime không cần tải thư viện npm; TypeScript, kiểu Node và Playwright chỉ dùng cho kiểm tra khi phát triển.

**Giới hạn nghiệm thu:** chưa có adapter portal nào được kiểm chứng trong phiên đăng nhập thật. TP.HCM có chuẩn hóa theo mẫu người dùng và parser bảng cấu hình, trạng thái PARTIAL. Các nguồn còn lại chờ DOM/JSON/login marker; URL Bộ Xây dựng được cung cấp đã thêm vào registry. Không có endpoint hay selector tự bịa. Phần trung tâm hoạt động ngay với file nhập và batch API được xác thực.

## Chạy thử

Cài Node.js **24.x**; mở PowerShell trong thư mục dự án:

```powershell
npm.cmd install --cache ./.npm-cache
npm.cmd run check
npm.cmd run demo
```

Mở http://localhost:3000. Terminal in tài khoản `demo.admin` và mật khẩu ngẫu nhiên chỉ khi tạo tài khoản lần đầu. Có **132 hồ sơ minh họa**, 11 nguồn, ít nhất 3 cơ quan, 5 phòng, 10 cán bộ và 10 thủ tục. Database minh họa riêng `data/demo.sqlite`; giao diện có nhãn MINH HỌA. Không dùng các số liệu này để điều hành thực tế. Chạy lại demo giữ dữ liệu/mật khẩu đã có. `Ctrl+C` dừng server.

## Chế độ SQLite và tài khoản nội bộ

```powershell
Copy-Item .env.example .env
npm.cmd run setup
npm.cmd start
```

`setup` tạo schema, đăng ký 11 nguồn và tài khoản quản trị `admin`; in mật khẩu ngẫu nhiên một lần. Có thể đặt `ADMIN_USERNAME` và `ADMIN_PASSWORD` qua biến môi trường khi setup. Không có mật khẩu cố định trong source. Database thật mặc định `data/central.sqlite`, không seed tự động. Thay port cần đổi cả `PORT` và `APP_ORIGIN` trong `.env`.

Migration tự chạy có transaction mỗi lần mở database; `npm.cmd run migrate` chạy riêng. Không chỉnh schema thủ công. SQLite WAL, foreign keys, prepared statements và các index theo nguồn/trạng thái/đơn vị/cán bộ/thủ tục/hạn/risk.

```powershell
npm.cmd run backup
```

Backup dùng API SQLite, chứa dữ liệu cá nhân và hash xác thực. Bảo vệ quyền truy cập, mã hóa kho lưu trữ, lưu bản ngoài máy và diễn tập phục hồi. Khôi phục trên bản sao trước, kiểm tra `PRAGMA integrity_check`; dừng dịch vụ rồi trỏ `DATABASE_PATH` sang bản đã kiểm tra. Không ghi đè database đang chạy.

## Dữ liệu và nghiệp vụ

Nguồn cung cấp timestamp chính thức; hệ thống không lấy countdown của portal hay tự cộng ngày xử lý vào lịch chưa xác nhận. Ngày Việt Nam `DD/MM/YYYY HH:mm:ss` được hiểu UTC+07; ISO phải có múi giờ. Backend lưu UTC, giao diện hiển thị `Asia/Ho_Chi_Minh`.

Hạn hiệu lực ưu tiên `extensionDueAt`, sau đó `dueAt`; `originalDueAt` giữ lần hẹn ban đầu. Khi nguồn rút ngày hẹn bằng `dueAt: null`, hệ thống yêu cầu kiểm tra thay vì dùng hạn cũ để kết luận. Hoàn thành được so sánh bằng `completedAt`; thiếu timestamp hoàn thành thì kết quả UNKNOWN. Hủy/trả lại không sinh overdue thông thường.

PAUSED, WAITING_ADDITIONAL_DOCUMENTS, WAITING_FOR_CITIZEN, UNKNOWN mặc định **NEEDS_REVIEW**. Admin có thể cấu hình `USE_SOURCE_DUE` khi đã xác nhận rằng ngày hẹn nguồn là căn cứ cho các trạng thái đó. Không tự cộng/trừ thời gian chờ. Calendar Service từ chối tính SLA nếu lịch chưa xác nhận; lịch đã xác nhận hỗ trợ ngày làm việc, ngày nghỉ và ngày làm bù. Calendar không sửa hạn chính thức.

WARNING 3 ngày, HIGH_RISK 1 ngày, CRITICAL_OVERDUE trễ từ 3 ngày lấy từ ví dụ trong yêu cầu; WATCH 7 ngày là ngưỡng theo dõi kỹ thuật khởi tạo. Đây là **cấu hình thông báo có thể sửa**, không phải quy định pháp lý và không thay đổi kết luận overdue theo ngày hẹn. Risk 0–100 giải thích từ số giờ còn lại, số bước và thời gian trung bình bước nếu được cung cấp. Các trọng số sửa được qua API cấu hình. Không sử dụng AI để quyết định deadline.

## Nhập Excel/CSV

Vào **Nhập Excel / CSV**: tải file → xem trước → chọn nguồn → mapping cột → kiểm tra → nhập → tải báo cáo lỗi. Hỗ trợ `.xlsx` và CSV UTF-8 dấu phẩy/chấm phẩy/tab, không hỗ trợ `.xls` nhị phân. Cần mã hồ sơ; nên có ngày hẹn với giờ/múi giờ và trạng thái chuẩn hoặc mapping nguồn đã xác nhận. Mỗi dòng lỗi được báo riêng, các dòng đúng vẫn nhập.

Khóa định danh ưu tiên `sourceSystem + sourceRecordId`, rồi `sourceCaseId`, rồi `caseCode`. Alias giữ liên kết khi nguồn bổ sung ID. Xung đột ID không tự gộp; dữ liệu cũ hơn `lastSourceUpdateAt` bị bỏ qua. Upsert giữ ngày hẹn ban đầu, tạo lịch sử thay đổi và tính lại cảnh báo. File có formula bị từ chối; xuất CSV chặn công thức. Ngày Excel chỉ có ngày và không có giờ không được tự chuyển thành deadline lúc nửa đêm. Tối đa 10 MB upload/10.000 dòng; xuất tối đa 10.000 dòng mỗi lần, lọc trước khi xuất. ID đơn vị/cán bộ cần mang phạm vi nguồn (ví dụ `MOC:OFFICER:123`) để tránh xung đột ID cục bộ giữa portal; thiếu ID thì server tạo ID theo nguồn+tên.

## Extension Chrome / Edge

```powershell
node extension/build.mjs
```

Mở `chrome://extensions` hoặc `edge://extensions`, bật Developer mode, **Load unpacked**, chọn `extension/`. Trong trang Nguồn của ứng dụng trung tâm, cấp token collector ngắn hạn; nhập URL trung tâm và token trong popup. Token này thuộc hệ thống trung tâm, không phải token portal. Token chỉ lưu `chrome.storage.session`.

Người dùng tự đăng nhập portal bằng tài khoản được cấp. Options extension chỉ cho chạy extractor khi đã có cấu hình được xác minh: URL danh sách, selector bảng và login marker độc lập, cùng bằng chứng mẫu. Chưa có cấu hình thì dừng với thông báo chờ sample. Không đọc password/cookie/token/OTP của portal, không tự đăng nhập, không dò API. Manual sync từng trang đang hiển thị; không tự giả định phân trang. Chi tiết và thêm nguồn thứ 12: [docs/ADAPTERS.md](docs/ADAPTERS.md), [extension/README.md](extension/README.md).

## Phân quyền

SYSTEM_ADMIN toàn hệ thống. Năm role còn lại phải được cấp danh sách nguồn rõ ràng. AGENCY_LEADER cần agencyId, DEPARTMENT_LEADER cần departmentId, OFFICER cần officerId. CENTRAL_ADMIN và VIEWER cũng bị giới hạn nguồn/đơn vị theo scope được cấp. VIEWER chỉ đọc, che tên người nộp và không thấy metadata cá nhân. Kiểm tra quyền nằm tại API, gồm danh sách/chi tiết/dashboard/export/alert/import/sync. Quản trị người dùng và các cấu hình toàn hệ thống yêu cầu SYSTEM_ADMIN.

## Kiểm tra và build

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

`lint` kiểm tra cú pháp toàn bộ JavaScript/TypeScript và các quy tắc an toàn cơ bản, không phải ESLint. `typecheck` kiểm tra strict TypeScript cho model và engine; các module JavaScript còn lại dùng validator runtime và test. `build` tạo `dist/` và bundle content script extension. Xem báo cáo triển khai/test/API/routes/file tại [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md). Kiểm thử browser chạy riêng bằng `npm.cmd run test:browser` khi có Chrome hoặc Edge.

Benchmark query với dữ liệu tổng hợp: `$env:RECORD_COUNT='100000'; npm.cmd run benchmark`. Đây là SQLite in-memory một tiến trình để kiểm tra LIMIT/index/aggregation, không đại diện cho tải đồng thời hoặc throughput collector thật.

## Triển khai

```powershell
npm.cmd run build
Set-Location dist
Copy-Item .env.example .env
npm.cmd run setup
npm.cmd start
```

Dùng Node24, thư mục dữ liệu bền vững, HTTPS reverse proxy, `NODE_ENV=production`, `APP_ORIGIN=https://ten-mien-thuc-te`. Server production từ chối APP_ORIGIN HTTP. Xem [deploy/README.md](deploy/README.md) và [docs/SECURITY.md](docs/SECURITY.md). Chưa deploy lên dịch vụ bên ngoài. SQLite/HTTP cùng một tiến trình phù hợp triển khai ban đầu; cần load test và kế hoạch database/worker nhiều tiến trình trước khi cam kết tải production lớn.
