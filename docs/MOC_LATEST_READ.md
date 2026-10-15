# Chỉ dùng lần đọc MOC mới nhất

Người dùng chọn: chỉ giữ hồ sơ của lần đọc mới nhất cho nguồn MOC trong Tổng quan và cảnh báo. Đã triển khai Apps Script phiên bản 11; dùng Collector 0.7.0.

Một trang MOC được gửi trong một giao dịch, tối đa 200 hồ sơ. Extension yêu cầu đọc đủ số dòng và không có lỗi. Máy chủ kiểm tra lại tất cả hồ sơ; lỗi, mã trùng, quan sát cũ hoặc thiếu metadata sẽ từ chối toàn bộ lượt thay thế. Trang rỗng chưa được coi là bằng chứng để xóa bộ dữ liệu hiện hành. Người thay thế cần quyền đồng bộ và phạm vi toàn bộ đơn vị/cán bộ của nguồn; tài khoản giới hạn không được thay thế dữ liệu toàn nguồn.

CASES, ALERTS, SYNC_LOGS và chỉ dấu MOC_SNAPSHOT mã hóa trong AUDIT_LOGS được ghi cùng giao dịch. Danh sách ID của lượt mới xác định tập hồ sơ đang dùng. Tổng quan, danh sách, chi tiết, cảnh báo, thống kê và báo cáo chỉ đọc các ID MOC hiện hành. Nguồn khác giữ cơ chế cũ. Gửi lại batch cũ không kích hoạt lại lượt cũ. Bộ lọc ngày nộp tiếp tục lọc trong tập hiện hành.

Không xóa vật lý các hàng Sheets cũ hoặc nhật ký; các hàng đó bị loại khỏi tập dữ liệu nghiệp vụ đang hiển thị. Đây là cách thực hiện lựa chọn loại dữ liệu cũ khỏi Tổng quan/cảnh báo, không phải yêu cầu xóa lịch sử vĩnh viễn. Lượt lỗi không thay thế lượt thành công trước và được báo rõ trên extension. Cho đến lần đồng bộ mới đầu tiên, dữ liệu trước đó chưa được chuyển sang tập hiện hành.

Kiểm chứng: 22 bài kiểm thử nghiệp vụ đạt, gồm thay tập A/B bằng B/C, cảnh báo không còn A, nguồn khác giữ nguyên, batch cũ không phục hồi tập cũ, từ chối lượt lỗi/rỗng/trùng/quá cũ. Kiểm thử worker/transport, Chrome extension, build/typecheck đạt. Sao lưu remote tại data/moc-snapshot-backup; đọc lại 23 file khớp mã local và xác nhận deployment @11. Chưa gửi dữ liệu thật trong phiên MOC của người dùng.

Cập nhật: tải lại Collector trong chrome://extensions, tải lại MOC, tìm kiếm rồi Đọc và ghi lên hệ thống; tải lại Dashboard. Không cần nhập lại URL/token.
