# Chuyển dữ liệu nghiệp vụ sang JSON không mã hóa

**Đã tách khỏi bản triển khai:** Theo yêu cầu tối ưu tốc độ tiếp theo, mã thử nghiệm này được lưu tại `data/pending-plain-data/`, ngoài thư mục upload Apps Script. Mã đang phát triển/triển khai tiếp tục dùng AES-SIV; không chạy migration plaintext. Nội dung bên dưới mô tả phương án chưa được phê duyệt, không phải trạng thái ứng dụng đang chạy.

Trạng thái ngày 15/10/2026: mã nguồn local đã hoàn tất; 69 bài kiểm thử Apps Script, lint và browser harness đạt. Chưa push hoặc triển khai. Bộ duyệt tự động từ chối lệnh `npm.cmd run gas:push` do phạm vi chuyển dữ liệu nhiều bảng sang plaintext; đang chờ xác nhận rõ từ người dùng. Deployment hiện tại vẫn là phiên bản 13.

Phạm vi chuyển đổi: USERS (email, tên hiển thị, tên đăng nhập); CASES và ALERTS (payload); SOURCE_MAPPING (cấu hình); AUDIT_LOGS (chi tiết); DASHBOARD_CACHE (payload cũ). Người có quyền đọc workbook sẽ đọc được các trường này. Dữ liệu được lưu dưới envelope `plain-json-v1`, trường `data` chứa JSON rõ. Giữ tên cột cũ có hậu tố `_encrypted` để không phá schema/adapter hiện có.

Mật khẩu đăng nhập vẫn là scrypt; không đổi password_hash, credential_version, trạng thái tài khoản, mã định danh, chỉ mục tra cứu hay token hash. Mật khẩu cấp mặc định trong SETTINGS tiếp tục mã hóa. Bộ đọc hỗ trợ cả AES-SIV cũ và JSON mới; thư viện Crypto vẫn dùng cho mật khẩu và đọc bản sao lưu.

Chuyển dữ liệu cũ một lần khi mở Web App sau triển khai: kiểm tra toàn bộ dữ liệu chuyển đổi, sao chép workbook dưới khóa ghi, commit với DATA_REVISION dự kiến, đọc lại xác nhận, rồi lưu marker hoàn thành. Nếu lỗi ghi, repository rollback; nếu rollback thất bại thì chặn đọc/ghi để phục hồi. Bản sao lưu được lưu bằng Script Property PLAIN_DATA_BACKUP_V1. Không khôi phục deployment 13 đơn lẻ sau migration vì bản cũ không đọc được plaintext; muốn quay lại phải phục hồi dữ liệu tương ứng từ backup.

Kiểm tra chỉ đọc trước thay đổi: 1 người dùng, 8 hồ sơ, 8 cảnh báo, 0 source mapping, 22 nhật ký, 3 cache dashboard; SETTINGS có 4 dòng và COLLECTOR_TOKENS có 4 dòng. Các số liệu này cần đọc lại trước áp dụng nếu dữ liệu đã thay đổi. Chưa chuyển dữ liệu thật và chưa đo tốc độ với dữ liệu thật.
