# TTHC MONITOR — Chrome/Edge collector

Manifest V3 collector đọc dữ liệu giám sát trên trang danh sách đang hiển thị sau khi người sử dụng bấm **Đồng bộ trang hiện tại**. Người sử dụng tự đăng nhập hợp lệ vào portal. Collector không đọc password, OTP, cookie, session, history hoặc giá trị input; không sửa portal, gọi API portal, điều khiển phân trang hay tải JavaScript từ xa.

## Cài đặt

Từ **0.5.0**, Dashboard dự án được cấu hình sẵn. Đăng nhập Dashboard, giữ tab mở, rồi chọn **Đọc và ghi lên hệ thống** trên tab portal. Extension tự cấp và giữ token đúng nguồn/hostname trong phiên; không cần sao chép URL/token. Nếu chưa có tab Dashboard, extension mở trang đăng nhập; đăng nhập xong quay lại portal và bấm ghi. Tính năng dùng RPC hiện có nên không cần triển khai lại Apps Script.

Quyền bổ sung chỉ dành cho hostname iframe chính xác của Dashboard dự án. Bridge chỉ chạy trong tab có URL triển khai khớp và iframe `/userCodeAppPanel` đúng origin, đối chiếu `auth.config.webAppUrl` trước khi gọi `extension.tokens.create`. Session Dashboard ở nguyên trong frame, chỉ collector token có phạm vi nguồn được trả về. Tài khoản thiếu quyền vẫn bị backend từ chối. Kết nối thủ công được giữ trong mục nâng cao cho hệ thống khác.

Phiên bản **0.4.1** tự phục hồi khi tab chưa nạp bộ đọc sau khi extension được cập nhật. Quyền `scripting` chỉ nạp `content/collector.js` đóng gói sẵn trong isolated world của frame chính, sau khi kiểm tra lại nguồn và URL. Chỉ thử lại một lần; lỗi đọc bảng/đăng nhập không kích hoạt nạp lại.

Cài collector bằng **Load unpacked** trên Chrome/Edge để sử dụng miễn phí trên máy của bạn.

1. Chạy `npm run extension:build` tại thư mục gốc.
2. Mở `chrome://extensions` hoặc `edge://extensions`, bật Developer mode, chọn **Load unpacked**, trỏ tới thư mục `extension/`.
   Nếu đã cài extension, bấm **Reload/Tải lại** trên thẻ extension sau khi build, rồi tải lại tab portal để nạp bộ đọc mới.
3. Mở Dashboard Apps Script đã triển khai; đăng nhập bằng tên tài khoản và mật khẩu do admin cấp, đổi mật khẩu mặc định khi được yêu cầu. Tạo **collector token** cho nguồn/hostname sẽ đồng bộ. Đây là token riêng của TTHC MONITOR.
4. Mở portal tương ứng và đăng nhập. Trong popup, dán URL Web App `https://script.google.com/macros/s/DEPLOYMENT_ID/exec` cùng collector token.
5. Với **Bộ Xây dựng**, mở trang **Tra cứu hồ sơ toàn cơ quan**, xác nhận đã đăng nhập trong popup rồi chọn **Nhận diện và đọc thử bảng Bộ Xây dựng**. Bộ đọc nhận bảng Angular Material và tự tách các ngày/cơ quan/cán bộ trong ô gộp. Các nguồn khác dùng biểu mẫu **Cấu hình adapter** theo bảng đã kiểm chứng.
6. Mở tab danh sách đang hiển thị rồi bấm **Đồng bộ trang hiện tại**. Sau khi người dùng mở trang kế tiếp, có thể bấm đồng bộ lại. Phạm vi luôn là `CURRENT_PAGE_ONLY`.

Token chỉ giữ trong `chrome.storage.session` với quyền `TRUSTED_CONTEXTS`; content script không nhận token. **Xóa token trong phiên** xóa bản lưu cục bộ. Token hết hạn hoặc tài khoản bị vô hiệu hóa sẽ bị backend từ chối. Khi token hết hạn, đăng nhập Dashboard và cấp lại cho đúng nguồn trước khi **Gửi lại batch lỗi**. Batch ID được giữ nguyên qua retry để backend không ghi trùng.

Với Bộ Xây dựng, mở đúng trang [danh sách hồ sơ](https://motcuabxd.moc.gov.vn/vi/dossier/search), chọn nguồn **Bộ Xây dựng (MOC)** khi tạo token trên Dashboard. Xem [hướng dẫn kết nối Bộ Xây dựng](../docs/MOC_SYNC.md) để cài extension, lưu kết nối và kiểm tra dữ liệu trên trang hiện tại.

## Trạng thái tích hợp thực tế

**Trạng thái nghiệm thu 11 nguồn vẫn là `WAITING_FOR_SAMPLE`.** MOC có profile `MOC_SEARCH_V1` dựa trên ảnh người dùng ngày 11/10/2026 và mã giao diện công khai, đã được kiểm thử bằng DOM tổng hợp trên Chrome. Chưa nghiệm thu đọc/đồng bộ hồ sơ trong phiên đăng nhập thật. Profile chỉ được lưu qua nút nhận diện sau khi người dùng xác nhận phiên và có dòng hợp lệ. Các nguồn khác vẫn cần cấu hình TABLE đã kiểm chứng. Xác nhận cục bộ không tự đổi trạng thái nghiệm thu registry.

Mỗi nguồn có module riêng: `tphcm.mjs`, `mof.mjs`, `moha.mjs`, `moc.mjs`, `moit.mjs`, `mae.mjs`, `moh.mjs`, `moet.mjs`, `moj.mjs`, `bvhttdl.mjs`, `bdttg.mjs`. Registry extension có 11 nguồn và 12 hostname chính xác. MOC dùng `motcuabxd.moc.gov.vn`, đồng thời giữ `motcua.moc.gov.vn` để tương thích. Không cấp quyền cho các subdomain hoặc tên miền gần giống. Batch gửi hostname của tab thực tế; token phải được cấp cho đúng hostname đó.

Đọc [tài liệu adapter](../docs/ADAPTERS.md) để biết mẫu cần cung cấp và cấu hình. Không đưa secret hay dữ liệu người nộp vào mẫu. Không khai báo selector, endpoint hoặc quy tắc phân trang khi chưa kiểm chứng.

## Dữ liệu và API

Extractor chỉ đọc các cột được ánh xạ vào allowlist giám sát. Cột không được ánh xạ không được đọc nội dung. Không hỗ trợ tên người nộp, CCCD/CMND, điện thoại, địa chỉ, file đính kèm hoặc metadata tùy ý. Chỉ lấy ngày hẹn chính thức; không lấy countdown do portal hiển thị. Ngày `DD/MM/YYYY HH:mm:ss` được chuyển theo UTC+07; timestamp ISO phải có múi giờ. `lastObservedAt` được ghi khi đọc từng trang. Deadline, cảnh báo, rủi ro và thời gian đồng bộ do server tính.

Batch tối đa 100 hồ sơ. Request Apps Script:

```json
{
  "action": "collector.sync",
  "token": "COLLECTOR_TOKEN_FROM_AUTHENTICATED_DASHBOARD",
  "sourceSystem": "TPHCM",
  "hostname": "motcua.tphcm.gov.vn",
  "cases": [],
  "batchId": "SESSION_UUID:0"
}
```

Request gửi đúng URL `/exec` đã cấu hình, `credentials: omit`, không có Authorization Google token. Apps Script ContentService redirect tới `script.googleusercontent.com`; extension cho phép hai hostname Google này qua host permissions/CSP và kiểm tra URL phản hồi cuối. Origin portal chỉ có content script, không được gọi từ transport. Host permissions của Chrome bỏ qua path; kiểm tra `/macros/s/ID/exec` vẫn được thực hiện trong code. Xem [ContentService](https://developers.google.com/apps-script/guides/content) và [Chrome network/CSP](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

Không tự thu thập lại theo lịch. Alarm 30 giây chỉ tiếp tục gửi các batch đã được người dùng chủ động thu thập. Token, dữ liệu hàng đợi và bộ đếm không được gửi cho portal.

## Tương thích backend Node cũ

Transport origin `/api/collector/sync` vẫn được giữ. Khi thực sự sử dụng backend cũ, build lại với đúng origin được cấp quyền, ví dụ PowerShell:

```powershell
$env:EXTENSION_CENTRAL_ORIGIN = 'http://localhost:3000'
npm run extension:build
Remove-Item Env:EXTENSION_CENTRAL_ORIGIN
```

Build này thêm một optional host permission và origin CSP được chỉ định. Build mặc định dành cho Apps Script không cấp localhost hoặc một backend bất kỳ. HTTPS bắt buộc với backend ngoài localhost. Legacy backend dùng Bearer collector token riêng; không dùng Google token hoặc credentials portal.

## Kiểm tra

```powershell
node extension/build.mjs
node --test tests/collector.test.mjs tests/extension-gas.test.mjs
node tests/extension-browser-smoke.mjs
```

Test dùng DOM/network/Chrome runtime tổng hợp: normalization UTC+07, allowlist không PII, cột không được đọc, thiếu mẫu chặn collector, source/hostname, sender trust, token privacy, Apps Script envelope/redirect và retry. Browser smoke chạy DOM tổng hợp trên Chrome/Edge thực với runtime stub để kiểm tra văn bản/hàng ẩn và không đọc cột người nộp. Cần thêm nghiệm thu extension cài đặt thực tế, Web App triển khai thật và ít nhất một phiên portal có quyền trước khi tuyên bố adapter hoạt động thật.
