# Lọc Tổng quan theo ngày nộp

Đã triển khai Apps Script phiên bản 10 ngày 12/10/2026 trên URL Dashboard hiện có.

Tổng quan có hai ô Ngày nộp từ ngày / Ngày nộp đến ngày. Chọn cùng một ngày để xem ngày đó, để trống để không giới hạn đầu khoảng tương ứng. Lọc theo `submittedAt` của hồ sơ đã lưu, không phải ngày tiếp nhận hoặc ngày đồng bộ. Giới hạn ngày theo UTC+07, gồm cả đầu và cuối ngày. Hồ sơ chưa có ngày nộp bị loại khi có bộ lọc ngày.

KPI, biểu đồ, hồ sơ ưu tiên và danh sách khi bấm vào KPI/biểu đồ cùng giữ khoảng ngày. URL lưu bộ lọc để tải lại trang vẫn giữ lựa chọn. Danh sách và báo cáo cũng hiển thị hai ô khi sử dụng bộ lọc này.

Không thay đổi schema Sheets. Do dữ liệu hiện có lưu ngày nộp trong payload mã hóa, máy chủ áp dụng quyền truy cập và các bộ lọc chỉ mục trước, sau đó giải mã các hồ sơ còn lại để lọc ngày nộp. Khoảng ngày lớn trên tập dữ liệu lớn có thể tốn thời gian hơn truy vấn không lọc ngày; cache Tổng quan vẫn tách theo bộ lọc.

Kiểm tra: 21 bài kiểm thử nghiệp vụ đạt, bao gồm ranh giới ngày Việt Nam, khoảng đảo ngược, ngày sai, hồ sơ thiếu ngày, KPI và danh sách thống nhất. Chrome kiểm chứng chọn ngày rỗng/có dữ liệu, giữ bộ lọc sau tải lại và khi bấm biểu đồ, cùng bố cục di động. Build/typecheck đạt. Đã sao lưu remote, đọc lại 23 file trước triển khai và xác nhận deployment @10.
