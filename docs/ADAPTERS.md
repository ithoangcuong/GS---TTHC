# Source adapters — trạng thái và cấu hình collector

Một extension Manifest V3 và 11 module adapter, với 12 hostname chính xác được phép. Registry của extension nằm tại `extension/adapters/source-registry.mjs`, factory tại `extension/adapters/registry.mjs`. Registry không dùng `endsWith`, subdomain wildcard hay chuỗi `if` phân tán.

| ID | Nguồn | Hostname được phép | Module | Trạng thái |
| --- | --- | --- | --- | --- |
| TPHCM | TP.HCM | `motcua.tphcm.gov.vn` | `tphcm.mjs` | WAITING_FOR_SAMPLE |
| MOF | Bộ Tài chính | `motcua.mst.gov.vn` | `mof.mjs` | WAITING_FOR_SAMPLE |
| MOHA | Bộ Nội vụ | `motcua.moha.gov.vn` | `moha.mjs` | WAITING_FOR_SAMPLE |
| MOC | Bộ Xây dựng | `motcuabxd.moc.gov.vn`; alias `motcua.moc.gov.vn` | `moc.mjs` | WAITING_FOR_SAMPLE |
| MOIT | Bộ Công Thương | `tthc.moit.gov.vn` | `moit.mjs` | WAITING_FOR_SAMPLE |
| MAE | Bộ Nông nghiệp và Môi trường | `dvcnnmt.mae.gov.vn` | `mae.mjs` | WAITING_FOR_SAMPLE |
| MOH | Bộ Y tế | `dvc.moh.gov.vn` | `moh.mjs` | WAITING_FOR_SAMPLE |
| MOET | Bộ Giáo dục và Đào tạo | `baocaodvc.moet.gov.vn` | `moet.mjs` | WAITING_FOR_SAMPLE |
| MOJ | Bộ Tư pháp | `motcua.moj.gov.vn` | `moj.mjs` | WAITING_FOR_SAMPLE |
| BVHTTDL | Bộ Văn hóa, Thể thao và Du lịch | `dichvucong.bvhttdl.gov.vn` | `bvhttdl.mjs` | WAITING_FOR_SAMPLE |
| BDTTG | Bộ Dân tộc và Tôn giáo | `gqtthc.bdttg.gov.vn` | `bdttg.mjs` | WAITING_FOR_SAMPLE |

Chưa có mẫu HTML/JSON từ một phiên đăng nhập thực tế trong repository. TP.HCM cũng đang chờ mẫu; nhãn trong đề bài chỉ là ví dụ. Fixture tổng hợp và code normalizer không chứng minh adapter đã nghiệm thu. Trạng thái tĩnh của nguồn không đổi khi người tích hợp tự xác nhận một cấu hình cục bộ. Nhãn TP.HCM từ shared registry của backend Node cũ không thay trạng thái nghiệm thu của extension.

MOC đã xác định URL danh sách là `https://motcuabxd.moc.gov.vn/vi/dossier/search`. Kiểm tra công khai ngày 09/10/2026 cho thấy phiên chưa đăng nhập chuyển sang VNeID. Các template JavaScript công khai hỗ trợ khảo sát cấu trúc giao diện; chúng chưa chứng minh bảng và quyền truy cập trong một phiên đăng nhập thực tế. Hướng dẫn thao tác nằm tại [MOC_SYNC.md](MOC_SYNC.md).

## Interface và điều kiện thu thập

`SourceAdapter` cung cấp `getSourceId()`, `getSourceName()`, `getSupportedHosts()`, `isSupportedPage()`, `detectLoginState()`, `detectCaseList()`, `extractCases()`, `normalizeCase()`, `mapStatus()` và `validateCase()`. Mỗi module nguồn kế thừa interface để sau này thêm parser đã được kiểm chứng.

Generic TABLE parser chỉ chạy khi cấu hình có bằng chứng, đúng HTTPS hostname/path, TABLE đang hiển thị và dấu hiệu đăng nhập độc lập đang hiển thị. Phải chọn tab portal và bấm đồng bộ. Content script kiểm tra trang đang hiển thị, không dùng page state, window/postMessage bridge, input value, cookie hay session. Không fetch endpoint portal. Chỉ đọc các cột được ánh xạ, dùng văn bản hiển thị; nội dung cột khác không được đọc. Hàng/cột ẩn không được thu thập. Giới hạn 60 header/2.000 hàng mỗi trang, batch 100 hồ sơ.

Phạm vi `CURRENT_PAGE_ONLY` được hiển thị rõ. Không giả lập pagination, tự thay bộ lọc hoặc thao tác portal. Dữ liệu HTML/API không phải TABLE cần module parser riêng sau khi có mẫu hợp lệ.

## Mẫu cần để hoàn thiện từng adapter

1. URL danh sách cụ thể trong phiên người dùng tự đăng nhập hợp lệ.
2. HTML DOM hoặc JSON/state/response thực tế đã xóa PII và credentials; giữ nhãn cột/trạng thái cần giám sát.
3. Screenshot thể hiện cột giám sát, dấu hiệu đăng nhập độc lập, trạng thái loading/empty/error và phân trang.
4. Nếu giao diện dùng Fetch/XHR: request/response được phép sử dụng, cấu trúc field và điều kiện quyền. Không gửi cookie, Authorization, password, OTP hoặc session.
5. Quy tắc ngày hẹn, timestamp/múi giờ, mapping trạng thái và phân trang đã được người phụ trách kiểm chứng.

Không cần password hay tự động đăng nhập. CSV/Excel hợp lệ có thể là đường import riêng trên Dashboard; không khiến DOM adapter tự thành IMPLEMENTED.

## Cấu hình TABLE

Trang options chấp nhận cấu hình JSON tối đa 32KB. Mọi nguồn, kể cả TP.HCM, đều cần `headerMappings` từ mẫu đã kiểm chứng. Schema dưới đây dùng mô tả, không cung cấp selector portal:

```json
{
  "sourceSystem": "TPHCM",
  "verified": true,
  "evidence": {
    "reference": "Tham chiếu mẫu DOM đã được kiểm chứng, không chứa PII/credentials",
    "verifiedAt": "ISO timestamp có múi giờ"
  },
  "listUrl": "URL HTTPS danh sách thực tế, không query/hash/credentials",
  "loggedInSelector": "selector dấu hiệu đăng nhập độc lập đã kiểm chứng",
  "loggedOutSelector": "selector dấu hiệu đăng xuất đã kiểm chứng, nếu có",
  "tableSelector": "selector TABLE thực tế",
  "headerSelector": "selector header trong TABLE",
  "rowSelector": "selector hàng trong TABLE",
  "cellSelector": "selector ô trong hàng",
  "headerMappings": { "nhãn mã hồ sơ thực tế": "caseCode" },
  "statusMappings": { "nhãn trạng thái thực tế đã kiểm chứng": "PROCESSING" }
}
```

`verifiedAt` phải là timestamp đầy đủ với múi giờ. Config có trường ngoài schema bị từ chối. URL có query/credentials không được lưu; trang hiện tại được so sánh origin/path để người dùng vẫn mở được từng trang với tham số phân trang. Khi layout/header/số ô thay đổi, collector báo lỗi; không đoán vị trí cột. Bằng chứng tự khai báo là trách nhiệm kiểm chứng của người tích hợp và không thay nghiệm thu portal.

## Allowlist và normalization

Các cột có thể đọc: `sourceRecordId`, `sourceCaseId`, `caseCode`, `procedureCode`, `procedureName`, `submittedAt`, `receivedAt`, `originalDueAt`, `dueAt`, `completedAt`, `agencyId`, `agencyName`, `departmentId`, `departmentName`, `officerId`, `officerName`, `sourceStatus`, `currentStep`, `totalSteps`. `caseCode` bắt buộc; chỉ map những field phục vụ giám sát thực tế. ID đơn vị/cán bộ chỉ dùng khi cần phân quyền và được nguồn cung cấp.

`sourceSystem`, `sourceName` do registry cung cấp; `lastObservedAt` được ghi lúc quan sát; `normalizedStatus` được map từ cấu hình đã kiểm chứng để preview. Backend dùng `STATUS_MAPPING` đã cấu hình làm quyết định cuối cùng. Trạng thái chưa được map là `UNKNOWN`. Không có mapping phỏng đoán trong UI. Các trạng thái canonical: NEW, RECEIVED, PROCESSING, WAITING_ADDITIONAL_DOCUMENTS, PAUSED, TRANSFERRED, COMPLETED, RETURNED, CANCELLED, OVERDUE, UNKNOWN.

Transport có thể nhận thêm `effectiveDueAt`, `extensionDueAt`, `extensionConfirmed` từ parser riêng đã được kiểm chứng. Generic TABLE không tự khai báo gia hạn hợp lệ. Chỉ chấp nhận ngày hiệu lực khớp ngày hẹn hoặc ngày gia hạn được nguồn xác nhận; không tự suy ra lịch hành chính, pause hoặc bổ sung. Deadline/countdown và alert do backend tính. Chuỗi ngày Việt Nam phải đầy đủ `DD/MM/YYYY HH:mm:ss` và dùng UTC+07. ISO phải có múi giờ. Date-only và ngày không hợp lệ bị từ chối.

Collector từ chối applicantName, CCCD/CMND, điện thoại, địa chỉ, file đính kèm, sourceUrl, metadata tùy ý, cookie/token/password, trường thời gian đồng bộ/alert/risk do client tự tính. Không đọc nội dung ô ngoài mapping; không log token hoặc hồ sơ đầy đủ.

## Apps Script API và retry

Request `doPost` dùng đúng URL Web App HTTPS `/macros/s/DEPLOYMENT_ID/exec` đã cấu hình:

```json
{
  "action": "collector.sync",
  "token": "OPAQUE_COLLECTOR_TOKEN",
  "sourceSystem": "TPHCM",
  "hostname": "motcua.tphcm.gov.vn",
  "cases": [],
  "batchId": "UUID:0"
}
```

Collector token được cấp từ UI đã xác thực, gắn source/hostname/user và thời hạn. Không sao chép Google access/ID token vào extension. Token giữ trong phiên trusted context. Request bỏ credentials/cookies và referrer. Google ContentService trả JSON qua redirect `script.googleusercontent.com`; CSP mặc định chỉ cho phép kết nối hai hostname Apps Script và transport kiểm tra URL phản hồi cuối. Browser tự theo redirect; cấu hình không chấp nhận URL googleusercontent hoặc endpoint `/dev`. Xem [Google ContentService](https://developers.google.com/apps-script/guides/content) và [Chrome cross-origin requests/CSP](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

Response thành công: `{ "ok": true, "data": { "total": 0, "created": 0, "updated": 0, "skipped": 0, "failed": 0, "errors": [] } }`. Response lỗi có `{ "ok": false, "error": { "code": "...", "message": "...", "requestId": "..." } }`. Lỗi token/quyền/validation không retry tự động. HTTP 429/5xx và lỗi mạng có backoff; timeout hủy request. Batch ID được giữ qua retry. Alarm chỉ gửi phần còn lại của lần đồng bộ người dùng đã bắt đầu; không tự đọc lại portal.

Backend Node origin `/api/collector/sync` vẫn có transport tương thích, với optional permission và CSP origin chỉ được thêm khi build bằng `EXTENSION_CENTRAL_ORIGIN`. Build Apps Script mặc định có 12 hostname portal cho 11 nguồn và hai hostname Google; không có localhost, wildcard hoặc remote JavaScript. Collector gửi hostname của tab đang đọc, và backend kiểm tra token gắn với đúng hostname ấy.

## Nghiệm thu

`tests/collector.test.mjs` và `tests/extension-gas.test.mjs` dùng fixture tổng hợp có ghi rõ nguồn. Test cover sender boundary, token trusted storage, thiếu mẫu chặn đọc, mapping/UTC+07, không đọc PII ở ô ngoài mapping, request envelope, exact source/hostname, Google token rejection, unexpected redirect và manifest/CSP. Test này không thay phiên Chrome/Edge, deployment Web App thật hoặc DOM/API portal thật.

`node tests/extension-browser-smoke.mjs` chạy bundle collector trên DOM tổng hợp trong Chrome/Edge thật cùng runtime stub. Kiểm tra rows/text đang hiển thị, bỏ text ẩn trong ô, không chạm getters PII ở cột ngoài mapping, ghi lastObservedAt và chặn dấu hiệu login ẩn. Đây chưa phải nghiệm thu extension được cài đặt hoặc phiên portal thật.

Sau khi có mẫu, thêm fixture đã khử dữ liệu nhạy cảm; nghiệm thu logged-out/list/empty/loading, timezone, unknown status, malformed rows và từng trang pagination. Đồng bộ hai lần không duplicate, thay ngày/status phải cập nhật đúng. Chỉ cập nhật trạng thái adapter khi có bằng chứng nghiệm thu thực tế.
