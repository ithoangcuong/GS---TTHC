# Vận hành

Thư mục này dành cho **server Node/SQLite legacy tùy chọn**. Bản TTHC Monitor dùng Apps Script/Google Sheets chạy trên server Google và không cần Docker, nginx, VPS hay domain riêng. Để triển khai bản miễn phí đang được dùng, làm theo [GOOGLE_SETUP.md](../docs/GOOGLE_SETUP.md). Các lệnh tạo tài khoản mật khẩu dưới đây chỉ áp dụng cho Node legacy; không tạo admin trong USERS của Apps Script.

Build từ thư mục gốc bằng `npm run check`. `dist/` chứa ứng dụng độc lập, runtime Node.js24 không cần `npm install`. Bản build không chứa `.env`, database, mật khẩu hay token.

Đặt database trên disk bền vững được bảo vệ và sao lưu định kỳ. Không đặt SQLite trên shared network filesystem. Tạo tài khoản bằng `npm run setup` trước khi mở truy cập. Mật khẩu được tạo ngẫu nhiên nếu không cung cấp qua môi trường. Không ghi password vào Dockerfile, image hay Git.

Production cần `NODE_ENV=production`, `APP_ORIGIN=https://domain-thuc`, `HOST=127.0.0.1`, reverse proxy HTTPS chuyển Host đúng domain. Với container, HOST=0.0.0.0 trong container nhưng publish cổng vào loopback hoặc private network. Ví dụ nginx ở file bên cạnh cần thay domain và chứng chỉ thật; không kèm chứng chỉ mẫu.

Dockerfile build từ project root: `docker build -f deploy/Dockerfile -t gs-tthc .`; volume `/app/data`, APP_ORIGIN phải truyền khi chạy. Docker chưa cài trong môi trường phát triển hiện tại, nên image chưa được build/test. Chọn service manager của môi trường (systemd/Windows service/container) để tự khởi động lại; liveness `/api/health`.

Không tin `X-Forwarded-For` do client cung cấp. Rate limit hiện dùng socket IP với giới hạn thao tác có user ID; sau proxy nhiều người dùng có chung IP. Khi mở quy mô lớn, đặt rate limit phân tán ở gateway và cấu hình trusted proxy rõ ràng.

`npm run backup` sử dụng SQLite backup API; bảo vệ quyền file và sao lưu ngoài máy. Kiểm thử phục hồi trên bản sao trước khi thay đường dẫn database. Database chứa dữ liệu cá nhân nên cần chính sách retention, mã hóa ổ đĩa, quyền operator và giám sát dung lượng. Cơ chế purge retention chưa tự áp dụng vì cần quy định lưu trữ của đơn vị.

Engine chạy vòng nền theo index nextRecalculationAt, xử lý tối đa500 hồ sơ mỗi lượt và nhường event loop giữa các lượt. Query danh sách có LIMIT/OFFSET server; dashboard tổng hợp trong SQL. Import tối đa10.000 dòng còn chạy đồng bộ; cần queue/worker và kiểm thử tải theo hạ tầng thực tế trước khi cam kết100.000 hồ sơ với nhiều người dùng đồng thời. Chỉ chạy một writer application instance với phiên bản SQLite hiện tại.

Kiểm tra build/unit/API/browser có thể xác nhận ứng dụng local. HTTPS thực, backup schedule, restore drill, alert external credentials, phiên portal thật, load test và quy tắc nghiệp vụ phải nghiệm thu trong môi trường triển khai. Chưa tuyên bố production nghiệm thu hoàn chỉnh.
