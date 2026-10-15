# Sửa lỗi cấp quyền đồng bộ MOC — 11/10/2026

Yêu cầu lỗi: `2f02b2a5-d3f7-43df-96c5-a6d938d98815` (`VALIDATION_ERROR`, bước cấp quyền đồng bộ).

Đã đọc mã qua Apps Script API và xác nhận deployment Dashboard đang trỏ tới phiên bản 7. `Sources.js` của phiên bản này chỉ cho phép `motcua.moc.gov.vn`, nên từ chối hostname thực tế `motcuabxd.moc.gov.vn`. Mã HEAD đã sửa nhưng chưa được triển khai.

Đã tạo phiên bản 8 từ HEAD, đọc lại toàn bộ 23 file để xác nhận khớp mã local đã kiểm thử và cập nhật deployment hiện có:

`AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE`

Đã đọc lại danh sách deployment và xác nhận đang chạy `@8`. So với phiên bản 7, chỉ `Sources.js` và `Setup.js` thay đổi cấu hình MOC; hostname mới được chấp nhận và hostname cũ vẫn được hỗ trợ. Không chạy setup, không thay đổi bảng dữ liệu hay tài khoản.

Kiểm chứng: tái hiện từ chối hostname mới với mã phiên bản 7; phiên bản 8 chấp nhận cả hai hostname và từ chối hostname ngoài danh sách. 48 bài kiểm thử account-auth, business và extension-gas đạt.

Người dùng tải lại Dashboard rồi bấm **Đọc và ghi lên hệ thống** tại tab MOC. Không cần cập nhật extension cho bản sửa phía máy chủ này. Việc ghi hồ sơ thật và hiển thị Dashboard vẫn cần xác nhận trong phiên đăng nhập của người dùng.

Nếu cần hoàn tác, cập nhật chính deployment này về phiên bản 7; thao tác đó sẽ khôi phục cả hạn chế hostname cũ.
