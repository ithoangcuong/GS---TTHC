# Bộ đọc trả về 0 dòng — extension 0.5.3

Thông báo cũ “Không có hồ sơ hợp lệ để ghi” xuất hiện khi bộ đọc trả về danh sách rỗng mà không có lỗi từng dòng. Chưa có DOM của phiên gặp lỗi để xác định bảng thật sự trống, đang tải hay có dòng bị ẩn.

Bản 0.5.3 đọc bảng trước khi chờ Dashboard cấp token. Cả đọc thử và ghi dùng cùng cơ chế đọc lại tối đa 5 lần, cách nhau 1 giây, chỉ khi bảng rỗng hoặc MOC báo đang tải. Mỗi lần kiểm tra tab và URL trước/sau đọc; không thử lại lỗi đăng nhập hay lỗi phân tích. Không gửi batch rỗng hoặc dùng dữ liệu preview cũ.

Bộ đọc MOC báo riêng trường hợp nhận diện đủ cột nhưng không có dòng dữ liệu và trường hợp dòng bị ẩn. Đọc thử cũng hiển thị thông báo này.

Cập nhật: vào `chrome://extensions`, tải lại Collector từ thư mục `extension` hoặc `dist/extension` đang sử dụng; tải lại tab MOC, bấm **Tìm kiếm** để hiện danh sách, rồi **Đọc và ghi lên hệ thống**. Không cần triển khai lại Apps Script.

Đã kiểm tra 16 bài kiểm thử kết nối/chờ bảng/worker, kiểm thử DOM Chrome tổng hợp, build và typecheck. Chưa xác nhận ghi hồ sơ thật trong phiên MOC của người dùng.
