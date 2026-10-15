# Tối ưu Apps Script phiên bản 13

## Phiên bản 14 — 15/10/2026

Đã triển khai trên cùng URL, xác nhận deployment @14 và đọc lại 23 tệp remote. Chỉ thay Cases.gs, Router.gs, Scripts.html, SheetRepository.gs so với bản 13. Không chuyển plaintext hoặc sửa schema/dữ liệu Sheet. Source trước push: `data/apps-script-backups/2026-10-15T12-44-52-470Z`.

- Bộ lọc ngày nộp dùng chỉ mục timestamp nhỏ được mã hóa AES-SIV trong CacheService (300 giây, 100 hồ sơ mỗi phần). Kiểm tra quyền và các bộ lọc chỉ mục trước khi truy cập cache. Khóa cache chứa fingerprint ciphertext, nên thay đổi payload làm mất hiệu lực chỉ mục kể cả khi timestamp cập nhật không đổi. Lỗi/mất cache quay về đọc dữ liệu mã hóa. Tập tối đa 20 hồ sơ bỏ qua cache để tránh chi phí gọi dịch vụ.
- RPC trả timing.serverMs, repositoryReadMs và repositoryReadCalls; frontend giữ tối đa 100 số đo tại `window.__tthcPerformance`. Không ghi payload, token, mật khẩu hoặc tên người dùng vào số đo. Có thể dùng `console.table(window.__tthcPerformance)` trong frame ứng dụng để kiểm tra trang chậm.
- 68 kiểm thử Apps Script, lint và browser harness đạt. Benchmark giả lập 1.000 hồ sơ: xử lý cũ 414,49 ms/1.000 giải mã; cache lạnh 360,52 ms/1.000 giải mã; cache ấm 23,42 ms/10 giải mã; kết quả 500 hồ sơ giống nhau. Đây là số đo cục bộ, không phản ánh tổng thời gian Sheets hoặc mạng.
- Đo trực tiếp trước triển khai: trang đăng nhập 7.480 ms; bootstrap công khai 1.305/1.213/1.514 ms. Sau triển khai: trang đăng nhập 9.760 ms; bootstrap 1.584/987/1.324 ms, máy chủ tương ứng 489/48/144 ms. Không có bằng chứng tốc độ mở trang đăng nhập tăng; thời gian chờ ngoài xử lý máy chủ còn đáng kể và các lần đo có dao động. Chưa đo dashboard/danh sách thật sau đăng nhập vì thiếu credentials cục bộ.

Kết quả lưu tại `data/preview/date-index-benchmark.json`, `live-performance-before.json`, `live-performance-after.json`, `performance-tests.txt`. Đo lại bằng `node scripts/measure-live-performance.mjs --login` (tự bỏ qua phần đăng nhập nếu không có tệp tài khoản kiểm thử).

Phương án plaintext chưa được phê duyệt đã lưu riêng tại `data/pending-plain-data`, ngoài thư mục upload; không có trong bản 14.

## Lịch sử phiên bản 13

Triển khai ngày 14/10/2026 trên deployment hiện tại, giữ nguyên URL. Bản trước là phiên bản 12. Source remote trước push được lưu tại `data/apps-script-backups/2026-10-14T11-54-49-406Z`; đã đọc lại 23 file để xác nhận khớp local.

- `auth.bootstrap` gộp cấu hình, phiên đăng nhập, nguồn dữ liệu và cài đặt: bốn RPC khởi tạo thành một, sau đó trang gọi RPC nghiệp vụ riêng. Phiên buộc đổi mật khẩu không nhận dữ liệu nghiệp vụ.
- Repository tái sử dụng workbook và bản sao các hàng trong một RPC. Cache hàng kiểm tra DATA_REVISION, bị xóa khi vào/ra khóa ghi và kết thúc yêu cầu. Trạng thái ghi dở vẫn chặn đọc; cache không chia sẻ giữa các yêu cầu. Kiểm thử khởi tạo xác nhận USERS chỉ được đọc dữ liệu một lần.
- Dashboard dùng CacheService với payload mã hóa, khóa theo quyền và bộ lọc, kiểm tra revision và hạn dữ liệu. Khi thiếu cache, tính lại nhưng không ghi DASHBOARD_CACHE hay lấy khóa ghi. Cache có thể bị loại bỏ sớm; khi đó phải tính lại. Bảng cache cũ được giữ nguyên nhưng không còn được đọc/ghi trong luồng tổng hợp.

Kiểm chứng: các bài kiểm thử Apps Script nghiệp vụ, xác thực, mã hóa và repository đạt (bài cache được chạy lại sau sửa lỗi trong mã kiểm thử); lint đạt; browser harness đạt đăng nhập/đổi mật khẩu, phân quyền, tất cả menu trong iframe, bộ lọc, chi tiết, xuất CSV và bố cục di động.

Trên deployment thật: HTTP 200, trang đăng nhập hoạt động, `auth.bootstrap` không đăng nhập trả về cấu hình hợp lệ trong 1529 ms ở một lần đo, không có lỗi JavaScript. Đây không phải thời gian dashboard sau đăng nhập hay phép đo tăng tốc trước/sau; chưa đo luồng dữ liệu thật có xác thực.

Phạm vi tiếp theo: danh sách vẫn đọc toàn bảng CASES và lọc ngày nộp vẫn giải mã các hồ sơ phù hợp phạm vi. Đợt này chưa thay schema hoặc thêm chỉ mục ngày nộp.
