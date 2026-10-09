# Đọc hồ sơ Bộ Xây dựng và lưu lên TTHC MONITOR

Đường dữ liệu là: **trang hồ sơ Bộ Xây dựng → extension trên máy của bạn → Apps Script → Google Sheets → Dashboard hiện tại**. Bạn tự đăng nhập cổng Bộ Xây dựng, mở danh sách hồ sơ và bấm đồng bộ từng trang. Dashboard không tự đăng nhập hoặc tải toàn bộ hồ sơ từ cổng nguồn.

| Thành phần | Địa chỉ |
| --- | --- |
| Danh sách hồ sơ Bộ Xây dựng | [motcuabxd.moc.gov.vn/vi/dossier/search](https://motcuabxd.moc.gov.vn/vi/dossier/search) |
| Dashboard / URL Apps Script Web App | [Mở TTHC MONITOR](https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec) |
| Kho dữ liệu | [Google Sheets của hệ thống](https://docs.google.com/spreadsheets/d/18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU/edit) |
| Mã nguồn cần chọn khi kết nối | `MOC` — Bộ Xây dựng |

## 1. Cài hoặc tải lại extension

Nếu dùng thư mục dự án hiện tại, mở PowerShell tại `D:\CODE\GS-TTHC` và chạy:

```powershell
npm.cmd run extension:build
```

1. Mở `chrome://extensions` trong Chrome hoặc `edge://extensions` trong Edge.
2. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Bấm **Load unpacked / Tải tiện ích đã giải nén**, chọn thư mục `D:\CODE\GS-TTHC\extension` chứa `manifest.json`.
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

Hiện MOC vẫn ở trạng thái **WAITING_FOR_SAMPLE**. URL và tên miền đã được xác định, nhưng chưa có bảng hồ sơ từ một phiên đăng nhập thực tế để nghiệm thu. Kiểm tra công khai ngày 09/10/2026 dừng ở bước đăng nhập VNeID; template công khai chưa đủ để xác nhận dữ liệu sẽ đọc được trên tài khoản của bạn.

Với bộ đọc TABLE hiện tại, người tích hợp cần kiểm tra cấu trúc bảng, nhãn cột và dấu hiệu đăng nhập trên phiên được phép, rồi nhập cấu hình trong **Cấu hình adapter đã kiểm chứng**. Xem [ADAPTERS.md](ADAPTERS.md) để biết cấu trúc cấu hình. Không đặt `verified=true` khi chưa kiểm tra trang thực tế.

Nếu extension báo **Cần DOM, URL danh sách và dấu hiệu đăng nhập đã kiểm chứng**, kết nối đã được chuẩn bị nhưng bộ đọc chưa sẵn sàng. Cần hoàn thiện bước kiểm chứng này trước khi bấm đồng bộ; lưu URL và token riêng lẻ chưa nhập hồ sơ vào hệ thống.

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
