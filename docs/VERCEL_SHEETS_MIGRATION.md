# Chuyển Dashboard/API sang Vercel, giữ Google Sheets

## Quyết định ngày 14/10/2026

Người dùng chọn Google Sheets tiếp tục là kho dữ liệu chính và tạo dự án riêng `gs-tthc` để kiểm thử trước khi chuyển người dùng. Chưa chuyển hệ thống đang chạy và chưa thay URL extension.

Đã thấy dự án `tthc` thuộc team `team_7eTDeyeZIujyO9gtASYr7yxt`, nhưng yêu cầu kiểm tra dự án đích với team cụ thể trả 403 forbidden, scope `ithoangcuong-7937`. Không có Vercel CLI hoặc cấu hình đăng nhập CLI trên máy để dùng đường dự phòng. Chưa tạo dự án `gs-tthc`. Cần kết nối Vercel có quyền đúng team; không thử tạo dưới một team mặc định khác.

Workspace cũng chưa có `secrets/google-service-account.json`, `.env` hoặc `.env.local`. Phải cấu hình quyền Sheets API và chuyển đúng các khóa hiện tại vào môi trường server trước khi xác minh dữ liệu thật. Không yêu cầu người dùng dán khóa vào chat.

## Những gì phải giữ

- Tài khoản username/password, đổi mật khẩu lần đầu, vai trò và phạm vi nguồn/đơn vị/cán bộ.
- Định dạng AES-SIV hiện tại và các pepper dùng cho chỉ mục, định danh, mật khẩu. Phải dùng đúng khóa đang cấu hình trên Apps Script để đọc dữ liệu cũ; không sinh khóa thay thế.
- Ngày nộp từ/đến theo UTC+07, cảnh báo theo hạn chính thức.
- MOC chỉ hiển thị tập hồ sơ của lần đọc hoàn chỉnh thành công mới nhất. Lượt lỗi không được kích hoạt tập dữ liệu thiếu.
- Token Collector gắn nguồn và hostname. Không đưa khóa Google hoặc khóa mã hóa xuống trình duyệt.

## Kết quả kiểm tra mã

`apps-script/` đang phục vụ production, sử dụng USERS/CASES/ALERTS/SOURCES và AUDIT_LOGS chứa chỉ dấu MOC_SNAPSHOT. Dashboard gọi google.script.run; extension kết nối đúng iframe Google hiện tại.

`server/` là backend khác: dùng SQLite, xác thực Google khi chọn google_sheets, đồng bộ nhật ký GS_Data. Đây không phải bộ đọc trực tiếp schema Apps Script hiện hành. Không triển khai nguyên backend này và không khởi tạo GS_Data thay cho các bảng hiện có.

## Kiến trúc đích

Dashboard tĩnh và API Node.js cùng origin trên Vercel; API dùng Google Sheets API bằng tài khoản dịch vụ. Sheets giữ dữ liệu bền vững; SQLite cục bộ và /tmp không được coi là nguồn dữ liệu.

Đọc các vùng cần thiết bằng batchGet, giảm số RPC khi tải Tổng quan. Chỉ giải mã những hồ sơ đã qua kiểm tra phạm vi. Cache kết quả phải gắn phiên bản dữ liệu và phạm vi người dùng; quyền truy cập được xác thực trước khi trả cache. Không cache công khai API chứa hồ sơ.

Ghi nhiều bảng bằng một Sheets batchUpdate, nhưng batch nguyên tử không thay thế được khóa giữa các request đồng thời. Phải có cơ chế điều phối ghi chung và chống lặp trước khi bật nhiều instance. Cần lựa chọn/triển khai cơ chế này cùng phiên đăng nhập và giới hạn thử mật khẩu dùng chung; không dùng biến trong RAM để thay thế LockService/CacheService.

## Thứ tự triển khai

1. Chọn dự án Vercel và cấu hình tài khoản dịch vụ được chia sẻ đúng workbook.
2. Đưa khóa/pepper hiện hành vào biến môi trường bảo mật của dự án; không gửi vào chat hoặc commit.
3. Port repository, crypto, xác thực và các RPC hiện hành; kiểm chứng khả năng đọc dữ liệu và tài khoản cũ trên bản sao workbook.
4. Chuyển Dashboard sang HTTP RPC cùng origin, giữ giao diện và phân quyền.
5. Chuyển kết nối tự động/transport của extension sang origin mới, giữ token đúng nguồn/hostname.
6. Kiểm thử đồng bộ đồng thời, retry, lỗi giữa chừng, snapshot MOC, quyền bị thu hồi, ngày nộp và cảnh báo. Đo thời gian thực tế trước/sau; chưa cam kết một hệ số tăng tốc khi chưa đo.
7. Chạy preview trước; khi chuyển production chỉ cho một hệ thống ghi dữ liệu để tránh ghi đè giữa Apps Script và Vercel.

## Thông tin cần cấu hình

- Project/team Vercel đích và domain cuối cùng.
- GOOGLE_SHEETS_ID; tài khoản dịch vụ có quyền chỉnh sửa workbook.
- DATA_ENCRYPTION_KEY, DATA_ENCRYPTION_KEY_ID, DATA_ENCRYPTION_PREVIOUS_KEYS (nếu có), LOOKUP_PEPPER, EMAIL_PEPPER giống Apps Script.
- Bí mật phiên đăng nhập riêng cho Vercel; cấu hình cơ chế điều phối ghi và giới hạn đăng nhập dùng chung.

Các tài khoản Vercel/Google là hai lớp quyền riêng; kết nối plugin Vercel không tự cấp Google Sheets API cho ứng dụng đã triển khai.

Tài liệu chính thức: https://vercel.com/docs/functions/runtimes/node-js và https://developers.google.com/workspace/sheets/api/guides/batch .
