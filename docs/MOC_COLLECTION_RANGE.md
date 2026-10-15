# Khoảng ngày nộp của lượt thu thập — Collector 0.6.0

Đã triển khai Apps Script phiên bản 9 vào URL Dashboard hiện có ngày 12/10/2026. Trước khi triển khai đã sao lưu remote, đọc lại 23 file và xác nhận khớp bản kiểm thử; danh sách deployment xác nhận `@9`. 41 bài kiểm thử liên quan, kiểm thử Chrome extension/Dashboard, build và typecheck đạt. Chưa xác nhận bộ lọc trong phiên MOC thật của người dùng.

Đọc hai ô `advFilingFrom` và `advFilingTo` trên màn hình MOC, lưu ngày ISO (không đổi múi giờ), cho phép để trống một đầu khoảng. Ngày không hợp lệ, khoảng đảo ngược hoặc không nhận diện duy nhất ô lọc sẽ dừng đọc.

Mỗi batch gửi `collectionContext` gồm `submittedFrom`, `submittedTo`, `capturedAt`, `scope=CURRENT_PAGE_ONLY`, `basis=VISIBLE_FILTERS`. Người dùng cần bấm **Tìm kiếm** trước khi đọc: hai ô hiển thị không chứng minh yêu cầu tìm kiếm đã áp dụng, và một trang không chứng minh đã thu thập đủ khoảng ngày.

Apps Script kiểm tra lại metadata, lưu mã hóa cùng hồ sơ và nhật ký của từng batch trong cùng giao dịch. Dùng các bảng CASES/AUDIT_LOGS hiện có, không thêm cột hoặc chạy lại setup. Lượt cũ không có metadata hiển thị “Chưa ghi nhận khoảng ngày nộp”. Extension cũ vẫn gửi được nhưng không ghi nhận khoảng ngày.

Dashboard hiển thị khoảng ngày bên cạnh quan sát của hồ sơ ở Tổng quan và Danh sách; Lịch sử đồng bộ có cột khoảng ngày và thời điểm đọc bộ lọc. Mỗi lượt giữ metadata riêng, kể cả khi ngày sau dùng khoảng ngày khác. Phân quyền hồ sơ và lịch sử đồng bộ được giữ nguyên.

Sau khi triển khai máy chủ: tải lại extension 0.6.0 và trang MOC; chọn ngày, bấm Tìm kiếm rồi Đọc và ghi lên hệ thống. Tải lại Dashboard để xem. Phải đồng bộ lại các hồ sơ cũ để có metadata mới, không suy đoán khoảng ngày từ ngày nộp của hồ sơ.
