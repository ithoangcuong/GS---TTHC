# Đọc hồ sơ Bộ Xây dựng và lưu lên TTHC MONITOR

Đường dữ liệu là: **trang hồ sơ Bộ Xây dựng → extension trên máy của bạn → Apps Script → Google Sheets → Dashboard hiện tại**. Bạn tự đăng nhập cổng Bộ Xây dựng, mở danh sách hồ sơ và bấm đồng bộ từng trang. Dashboard không tự đăng nhập hoặc tải toàn bộ hồ sơ từ cổng nguồn.

## Cách dùng nhanh từ phiên bản 0.5.0

Từ **0.5.1**, popup hiển thị từng bước kết nối/đọc/gửi, lưu lỗi chuẩn bị trong phiên để xem lại khi mở popup, và báo rõ số hồ sơ mới/cập nhật/lỗi sau phản hồi từ máy chủ. Đọc thử không phải kết quả lưu. Sau thông báo **Đã đồng bộ**, bấm **Xem hồ sơ đã lưu trên Dashboard** để tải lại danh sách nguồn vừa đồng bộ và bỏ bộ lọc cũ. Dashboard đang mở trước đó không tự tải dữ liệu mới chỉ bằng bộ đếm thời gian.

Không cần nhập URL Apps Script hoặc sao chép collector token. Tải lại extension, đăng nhập Dashboard TTHC MONITOR bằng tài khoản của bạn và giữ tab đó mở. Trở về tab Bộ Xây dựng, mở extension và bấm **Đọc và ghi lên hệ thống**. Nếu chưa mở Dashboard, nút này mở Dashboard để bạn đăng nhập; quay lại portal và bấm ghi lần nữa.

Extension dùng địa chỉ triển khai của dự án, yêu cầu Dashboard cấp token đúng nguồn/hostname bằng phiên đăng nhập hiện có, rồi lưu token riêng trong phiên extension. Mật khẩu và session Dashboard không được đưa sang extension. Tài khoản vẫn phải có quyền đồng bộ nguồn; yêu cầu đổi mật khẩu mặc định vẫn được giữ. Quyền token hết hạn sau một giờ được cấp lại khi bắt đầu lần ghi tiếp theo. Mỗi lần chỉ ghi trang portal đang hiển thị.

Các bước tạo/dán token ở mục 2–3 bên dưới chỉ dành cho kết nối thủ công hoặc hệ thống khác trong **Kết nối nâng cao**. Kết nối tự động dùng hostname iframe Dashboard chính xác đã kiểm tra ngày 11/10/2026; nếu Google thay hostname này, cần cập nhật extension, không tự mở rộng quyền sang các ứng dụng Google khác.

| Thành phần | Địa chỉ |
| --- | --- |
| Danh sách hồ sơ Bộ Xây dựng | [motcuabxd.moc.gov.vn/vi/dossier/search](https://motcuabxd.moc.gov.vn/vi/dossier/search) |
| Dashboard / URL Apps Script Web App | [Mở TTHC MONITOR](https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec) |
| Kho dữ liệu | [Google Sheets của hệ thống](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit) |
| Mã nguồn cần chọn khi kết nối | `MOC` — Bộ Xây dựng |

## 1. Cài hoặc tải lại extension

Bản **0.4.2** nhận bảng native/Angular Material theo cấu trúc ngữ nghĩa trong `app-list-search`, không phụ thuộc lớp bao `.searchtbl-allAgency`. Các mã `mat-column-*`/`cdk-column-*` được đối chiếu từ module công khai giúp đọc đúng khi nhãn có biểu tượng sắp xếp hoặc vị trí ô thay đổi. Nếu chưa nhận diện được, thông báo nêu số bảng và các cột giám sát còn thiếu (không chứa nội dung hồ sơ); gửi lại nguyên văn thông báo này để kiểm tra bố cục.

Bản **0.4.1** tự nạp lại bộ đọc nếu tab chưa có content script (lỗi `Could not establish connection. Receiving end does not exist.`). Sau khi cập nhật, bấm **Tải lại** extension một lần để nhận bản mới và quyền `scripting`. Quyền này chỉ dùng để nạp file collector đi kèm vào tab portal được hỗ trợ. Nếu trình duyệt chặn quyền truy cập trang, cấp quyền cho cổng đang mở rồi tải lại tab.

Nếu dùng thư mục dự án hiện tại, mở PowerShell tại `D:\PHUONG\GS---TTHC-main` và chạy:

```powershell
npm.cmd run extension:build
```

1. Mở `chrome://extensions` trong Chrome hoặc `edge://extensions` trong Edge.
2. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Bấm **Load unpacked / Tải tiện ích đã giải nén**, chọn thư mục `D:\PHUONG\GS---TTHC-main\extension` chứa `manifest.json`.
4. Ghim **TTHC Monitor Collector** lên thanh công cụ để dễ mở.

Nếu đã cài trước đó, bấm **Reload / Tải lại** trên thẻ extension thay cho việc cài lại. Sau đó tải lại tab Bộ Xây dựng. Bản mới nhận `motcuabxd.moc.gov.vn`; tên miền cũ `motcua.moc.gov.vn` vẫn được giữ để tương thích.

## 2. Tạo token trên Dashboard

1. Mở [Dashboard](https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec), đăng nhập bằng tài khoản do admin cấp. Đổi mật khẩu mặc định nếu được yêu cầu.
2. Chọn **Nguồn dữ liệu** ở menu bên trái.
3. Trong **Kết nối extension**, chọn **Bộ Xây dựng** ở **Nguồn cần kết nối**.
4. Bấm **Tạo token extension**. Sao chép **Token extension** và **API Web App** vừa hiện ra.

Nếu không thấy phần tạo token, tài khoản cần được admin cấp quyền đồng bộ nguồn MOC. Token này do Dashboard cấp; không dùng mật khẩu, mã OTP hoặc token đăng nhập cổng Bộ Xây dựng.

## 3. Lưu kết nối trong extension

1. Mở [danh sách hồ sơ Bộ Xây dựng](https://motcuabxd.moc.gov.vn/vi/dossier/search) và tự đăng nhập theo hướng dẫn của cổng. Phiên chưa đăng nhập có thể chuyển sang VNeID; đăng nhập xong cần quay về trang danh sách.
2. Giữ tab danh sách đang được chọn, rồi mở biểu tượng extension.
3. Mở **Kết nối hệ thống trung tâm**.
4. Dán địa chỉ Dashboard `/exec` vào **URL Apps Script Web App**, dán token vừa tạo vào **Collector token**.
5. Bấm **Lưu kết nối**.

Token chỉ được giữ trong phiên trình duyệt. Khi đóng trình duyệt, token hết hạn hoặc bạn đổi mật khẩu Dashboard, hãy tạo token mới và lưu kết nối lại. Token được gắn với nguồn và hostname; token MOC tạo từ Dashboard hiện tại dành cho `motcuabxd.moc.gov.vn`.

## 4. Kiểm chứng bộ đọc trước lần đồng bộ đầu tiên

Extension **0.4.0** có bộ đọc riêng `MOC_SEARCH_V1` cho bố cục trong ảnh người dùng cung cấp ngày 11/10/2026, đối chiếu với `ListSearchComponent` công khai của cổng. Bộ đọc hỗ trợ `mat-table`/`mat-cell` của Angular Material, nhận diện tiêu đề cột, tách ngày nộp/ngày tiếp nhận/ngày hẹn trả và cơ quan/cán bộ trong ô gộp. Không đọc cột Người nộp hoặc lấy hạn trả từ countdown.

1. Tải lại extension ở `chrome://extensions` / `edge://extensions`, sau đó tải lại tab Bộ Xây dựng.
2. Đăng nhập và mở danh sách **Tra cứu hồ sơ toàn cơ quan**. Chờ bảng tải xong, có ít nhất một hồ sơ.
3. Mở popup extension. Đánh dấu **Tôi đã đăng nhập và đang xem bảng hồ sơ được phép truy cập**.
4. Bấm **Nhận diện và đọc thử bảng Bộ Xây dựng**. Không cần nhập selector hoặc token ở bước này.
5. Đối chiếu mã hồ sơ, ngày hẹn và trạng thái trong kết quả. Chỉ khi có dòng hợp lệ, extension mới lưu bộ đọc và mở nút đọc thử thông thường. Hồ sơ lỗi được liệt kê riêng, chưa gửi dữ liệu lên hệ thống.

Quay lại tab danh sách, mở extension và bấm **Đọc thử dữ liệu** để xem số dòng hợp lệ, lỗi và tối đa 10 hồ sơ. Bước này không cần token và không gửi hồ sơ lên hệ thống. Chỉ đồng bộ sau khi kiểm tra mã hồ sơ, ngày hẹn và trạng thái đọc được.

Nếu vẫn thấy thông báo **Cần DOM, URL danh sách và dấu hiệu đăng nhập đã kiểm chứng**, kiểm tra đã tải lại đúng extension phiên bản 0.4.0 và tab portal. Nếu báo không nhận diện bảng, kiểm tra đúng URL, tiêu đề trang và các cột đang hiển thị; không cần gửi mật khẩu/cookie. Với cấu hình TABLE riêng đã lưu trước đó, có thể nhập profile sau qua JSON nâng cao khi đã xác nhận đúng phiên: `{"sourceSystem":"MOC","profile":"MOC_SEARCH_V1","confirmed":true,"listUrl":"https://motcuabxd.moc.gov.vn/vi/dossier/search"}`, rồi dùng **Đọc thử dữ liệu**.

Trạng thái nghiệm thu MOC vẫn **WAITING_FOR_SAMPLE**: ảnh và mã giao diện giúp triển khai bộ đọc, nhưng kiểm thử DOM tổng hợp không thay phiên đăng nhập thật. Bộ đọc hiện yêu cầu đủ ba timestamp chính thức. Trạng thái đã đối chiếu là **Đang xử lý → PROCESSING**; trạng thái khác là UNKNOWN khi preview, backend dùng STATUS_MAPPING. Tên thủ tục kết thúc bằng dấu ba chấm bị bỏ qua để không ghi đè tên đầy đủ bằng đoạn bị cắt.

## 5. Đồng bộ và kiểm tra kết quả

Sau khi có cấu hình đã kiểm chứng:

1. Chờ danh sách hồ sơ hiển thị xong trên cổng Bộ Xây dựng.
2. Mở extension và bấm **Đồng bộ trang hiện tại**.
3. Chờ kết quả; kiểm tra tổng hồ sơ, số tạo mới, cập nhật, bỏ qua và lỗi.
4. Trên Dashboard, mở **Danh sách hồ sơ**, lọc nguồn **Bộ Xây dựng**. Mở **Lịch sử đồng bộ** để xem lượt gửi và lỗi nếu có.
5. Muốn đọc trang tiếp theo, tự chuyển trang trên cổng Bộ Xây dựng, chờ bảng tải xong rồi bấm đồng bộ lại.

Mỗi lần chỉ đọc trang đang mở. Hệ thống cập nhật hồ sơ đã có theo khóa hồ sơ; không cần xóa dữ liệu cũ trước mỗi lượt đồng bộ. Nếu có **Gửi lại batch lỗi**, kiểm tra thông báo lỗi, sửa kết nối hoặc token rồi bấm gửi lại.

Dữ liệu hồ sơ được lưu vào tab `CASES`, lịch sử lượt gửi vào `SYNC_LOGS`, thống kê nguồn vào `SOURCES`. Nội dung hồ sơ trong Sheet được mã hóa; dùng Dashboard để xem thông tin đầy đủ trong phạm vi được cấp. Không phải mọi lượt gửi đều tạo hồ sơ mới: hồ sơ đã có có thể được cập nhật hoặc bỏ qua.

Chỉ các cột phục vụ giám sát đã được kiểm chứng mới được đọc. Cổng chỉ hiện ngày mà không có giờ thì chưa đủ để xác định hạn trả chính xác; collector không tự đặt giờ hoặc suy ra hạn từ bộ đếm trên màn hình.

## Xử lý thông báo thường gặp

| Thông báo / tình huống | Cách xử lý |
| --- | --- |
| Mở một portal được hỗ trợ | Quay về tab `motcuabxd.moc.gov.vn`, tải lại extension và tab sau khi cập nhật. |
| Chưa đăng nhập hoặc đang ở VNeID | Tự hoàn tất đăng nhập cổng và mở lại danh sách hồ sơ. |
| Thiếu cấu hình đã kiểm chứng | Hoàn thành bước 4; không đoán selector hoặc đánh dấu đã kiểm chứng để bỏ qua lỗi. |
| Thiếu token, token hết hạn hoặc token sai hostname | Tạo token MOC mới trên Dashboard và bấm **Lưu kết nối** trong extension. |
| Bảng hoặc nhãn cột đã thay đổi | Kiểm tra lại cấu hình theo bảng đang hiển thị rồi thử đồng bộ. |
| Có lỗi mạng hoặc batch lỗi | Kiểm tra kết nối mạng và thông báo, dùng **Gửi lại batch lỗi** khi đã xử lý nguyên nhân. |

Tài liệu này hướng dẫn kết nối và quy trình đồng bộ. Chưa có hồ sơ thực tế nào được nhập từ phiên công khai dùng để kiểm tra cổng Bộ Xây dựng.
