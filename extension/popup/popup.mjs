import { hostPermission, normalizeCentralUrl } from '../api/sync.mjs';
const $ = id => document.getElementById(id);
let activeTabId = null;
const call = message => chrome.runtime.sendMessage(message);
function report(error) { $('status').textContent = error.message ?? String(error); }
async function refresh() {
  const state = await call({ type: 'GET_STATE', tabId: activeTabId });
  if (!state?.ok) throw new Error(state?.error ?? 'Không đọc được trạng thái.');
  $('portal').textContent = state.portal ? `${state.portal.name} · ${state.portal.adapterStatus}` : 'Mở một portal được hỗ trợ.';
  if (!$('url').value) $('url').value = state.centralUrl ?? '';
  const job = state.syncJob;
  $('sync').disabled = !state.portal?.configured || !state.hasCollectorToken || job?.status === 'SYNCING';
  $('resume').hidden = job?.status !== 'SYNC_ERROR';
  $('status').textContent = job?.status === 'SYNCING' ? 'Đang đồng bộ. Các batch tiếp theo chạy mỗi 30 giây.'
    : !state.portal?.configured ? 'Cần DOM, URL danh sách và dấu hiệu đăng nhập đã kiểm chứng.'
    : !state.hasCollectorToken ? 'Cần collector token trong phiên.' : 'Sẵn sàng đồng bộ trang hiện tại.';
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
$('sync').addEventListener('click', async () => {
  $('sync').disabled = true;
  try { const result = await call({ type: 'START_SYNC', tabId: activeTabId }); if (!result?.ok) throw new Error(result?.error ?? 'Không bắt đầu được sync.'); await refresh(); }
  catch (error) { report(error); }
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
