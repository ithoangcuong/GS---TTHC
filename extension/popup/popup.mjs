import { hostPermission, normalizeCentralUrl } from '../api/sync.mjs';
const $ = id => document.getElementById(id);
let activeTabId = null;
let reading = false;
let lastError = '';
let writing = false;
const call = message => chrome.runtime.sendMessage(message);
function report(error) { lastError = error.message ?? String(error); $('status').textContent = lastError; }
async function refresh() {
  const state = await call({ type: 'GET_STATE', tabId: activeTabId });
  if (!state?.ok) throw new Error(state?.error ?? 'Không đọc được trạng thái.');
  $('portal').textContent = state.portal ? `${state.portal.name} · ${state.portal.configured ? 'Đã cấu hình cục bộ' : 'Chưa cấu hình'}` : 'Mở một portal được hỗ trợ.';
  $('moc-setup').hidden = state.portal?.id !== 'MOC' || state.portal?.configured;
  $('preview').disabled = reading || !state.portal?.configured;
  if (!$('url').value) $('url').value = state.centralUrl ?? '';
  const job = state.syncJob;
  const attempt = state.syncAttempt;
  const preparing = attempt?.status === 'PREPARING';
  $('sync').disabled = writing || preparing || !state.portal?.configured || (!state.hasCollectorToken && !state.automaticConnection) || job?.status === 'SYNCING';
  const saved = job && ['SYNC_SUCCESS', 'SYNC_WITH_ERRORS'].includes(job.status) && job.created + job.updated + job.skipped > 0;
  $('view-dashboard').hidden = !saved;
  $('save-status').textContent = attempt?.message || (job?.status === 'SYNCING' ? 'Đang gửi hồ sơ lên Google Sheets. Chưa hoàn tất lưu.'
    : job?.status === 'SYNC_ERROR' ? `Chưa hoàn tất lưu: ${job.error ?? 'Có lỗi gửi dữ liệu.'}`
    : saved ? `Đã đồng bộ ${job.sourceSystem}: ${job.created} hồ sơ mới, ${job.updated} cập nhật, ${job.skipped} không đổi; ${job.failed} lỗi. ${job.replaceSource ? `Tổng quan và cảnh báo MOC chỉ dùng ${job.total} hồ sơ của lần đọc này. ` : ''}Bấm Xem hồ sơ đã lưu trên Dashboard để tải dữ liệu mới.`
    : job?.failed ? `Chưa lưu được hồ sơ. Có ${job.failed} dòng lỗi; xem chi tiết bên dưới.` : 'Chưa có kết quả lưu. Đọc thử chỉ hiển thị dữ liệu trong extension.');
  $('resume').hidden = job?.status !== 'SYNC_ERROR';
  $('status').textContent = lastError || (job?.status === 'SYNCING' ? 'Đang đồng bộ. Các batch tiếp theo chạy mỗi 30 giây.'
    : !state.portal?.configured ? (state.portal?.id === 'MOC' ? 'Xác nhận bên dưới để nhận diện và đọc bảng Bộ Xây dựng.' : 'Cần DOM, URL danh sách và dấu hiệu đăng nhập đã kiểm chứng.')
    : !state.hasCollectorToken && state.automaticConnection ? 'Bấm Đọc và ghi lên hệ thống. Extension tự kết nối với Dashboard đã đăng nhập.'
    : !state.hasCollectorToken ? 'Cần kết nối hệ thống tùy chỉnh trong mục nâng cao.' : 'Sẵn sàng đồng bộ trang hiện tại.');
  $('result').textContent = job ? JSON.stringify({ status: job.status, total: job.total, created: job.created,
    updated: job.updated, skipped: job.skipped, failed: job.failed, error: job.error, errors: job.errors }, null, 2) : '';
}
$('central').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const centralUrl = normalizeCentralUrl($('url').value);
    const permitted = await chrome.permissions.request({ origins: [hostPermission(centralUrl)] });
    if (!permitted) throw new Error('Quyền Central API chưa được cấp.');
    const result = await call({ type: 'SAVE_CENTRAL', centralUrl, token: $('token').value });
    if (!result?.ok) throw new Error(result?.error ?? 'Không lưu được kết nối.');
    $('token').value = ''; await refresh();
  } catch (error) { report(error); }
});
function showPreview(result) {
  if (!result.valid && result.emptyMessage) { $('preview-result').textContent = result.emptyMessage; return; }
  const range = result.collectionContext;
  const context = range ? `\nNgày nộp từ ngày: ${range.submittedFrom ?? 'Không giới hạn'}; đến ngày: ${range.submittedTo ?? 'Không giới hạn'}. Bộ lọc đang hiển thị; hãy bấm Tìm kiếm trước khi đọc. Chỉ đọc trang hiện tại.\n` : '\n';
  $('preview-result').textContent = `Nguồn: ${result.sourceSystem}. Đọc được ${result.valid}/${result.total} dòng. Hiển thị tối đa 10 hồ sơ; chưa gửi lên hệ thống.${context}${JSON.stringify({ records: result.records, errors: result.errors }, null, 2)}`;
}
$('moc-setup').addEventListener('submit', async event => {
  event.preventDefault();
  if (reading) return;
  reading = true;
  const button = $('moc-setup').querySelector('button');
  button.disabled = true;
  $('preview-result').textContent = 'Đang nhận diện bảng Bộ Xây dựng…';
  try {
    const result = await call({ type: 'ENABLE_MOC_PROFILE', tabId: activeTabId, confirmed: $('moc-confirm').checked });
    if (!result?.ok) throw new Error(result?.error ?? 'Không nhận diện được bảng.');
    showPreview(result);
  } catch (error) { $('preview-result').textContent = error.message; }
  finally { reading = false; button.disabled = false; await refresh().catch(report); }
});
$('sync').addEventListener('click', async () => {
  if (writing) return;
  writing = true;
  lastError = '';
  $('sync').disabled = true;
  $('preview-result').textContent = '';
  $('save-status').textContent = 'Đang bắt đầu kết nối và ghi hồ sơ…';
  try { const result = await call({ type: 'START_SYNC', tabId: activeTabId }); if (!result?.ok) throw new Error(result?.error ?? 'Không bắt đầu được sync.'); await refresh(); }
  catch (error) { report(error); $('save-status').textContent = `Chưa lưu: ${error.message}`; }
  finally { writing = false; await refresh().catch(report); }
});
$('view-dashboard').addEventListener('click', async () => {
  try {
    const result = await call({ type: 'VIEW_SAVED_CASES' });
    if (!result?.ok) throw new Error(result?.error ?? 'Không mở được Dashboard.');
  } catch (error) { report(error); }
});
$('preview').addEventListener('click', async () => {
  if (reading) return;
  reading = true;
  $('preview').disabled = true;
  $('preview-result').textContent = 'Đang đọc bảng trên trang hiện tại…';
  try {
    const result = await call({ type: 'PREVIEW_SOURCE', tabId: activeTabId });
    if (!result?.ok) throw new Error(result?.error ?? 'Không đọc được dữ liệu.');
    showPreview(result);
  } catch (error) { $('preview-result').textContent = error.message; }
  finally { reading = false; await refresh().catch(report); }
});
$('resume').addEventListener('click', async () => {
  try { const result = await call({ type: 'RESUME_SYNC' }); if (!result?.ok) throw new Error(result?.error ?? 'Không gửi lại được.'); await refresh(); }
  catch (error) { report(error); }
});
$('clear').addEventListener('click', async () => { await call({ type: 'CLEAR_TOKEN' }); await refresh(); });
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
activeTabId = tab?.id ?? null;
await refresh().catch(report);
setInterval(() => refresh().catch(report), 3000);
