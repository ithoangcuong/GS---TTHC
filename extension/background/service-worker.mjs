import { sourceByHostname } from '../adapters/source-registry.mjs';
import { normalizeCollectorCase } from '../normalizer/case-normalizer.mjs';
import { validateAdapterConfig } from '../adapters/base.mjs';
import { mocProfileConfig } from '../adapters/moc-profile.mjs';
import { collectFromTab } from './collector-connection.mjs';
import { collectWhenReady } from './collector-ready.mjs';
import { DEFAULT_CENTRAL_URL, connectDashboard, openSavedCases } from '../api/dashboard.mjs';
import { chunks, hostPermission, normalizeCentralUrl, sendBatch } from '../api/sync.mjs';

const TRUSTED_PAGES = ['popup/index.html', 'options/index.html'].map(path => chrome.runtime.getURL(path));
const ALARM = 'continue-collector-sync';
let busy = false;
let starting = false;
const storageReady = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

async function contextForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  const source = sourceByHostname(url.hostname);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !source?.enabled || !tab.active) throw new Error('Cần tab portal đang mở và được chọn.');
  const { configurations = {} } = await chrome.storage.local.get('configurations');
  return { tab, source, hostname: url.hostname, config: configurations[source.id] ?? null };
}

async function beginSync(tabId) {
  if (starting) throw new Error('Collector đang chuẩn bị đồng bộ.');
  starting = true;
  let attempted = false;
  try {
  await storageReady;
  const { collectorToken, collectorBinding, syncJob } = await chrome.storage.session.get(['collectorToken', 'collectorBinding', 'syncJob']);
  if (syncJob?.status === 'SYNCING') throw new Error('Đồng bộ đang chạy; chờ kết quả.');
  attempted = true;
  await chrome.storage.session.set({ syncAttempt: { status: 'PREPARING', message: 'Đang kiểm tra trang và quyền ghi dữ liệu…', startedAt: new Date().toISOString() } });
  const { centralUrl = DEFAULT_CENTRAL_URL } = await chrome.storage.local.get('centralUrl');
  if (!centralUrl || !(await chrome.permissions.contains({ origins: [hostPermission(centralUrl)] }))) throw new Error('Chưa cấp quyền kết nối Central API.');
  const { source, hostname, config } = await contextForTab(tabId);
  validateAdapterConfig(config, source.id);
  await chrome.storage.session.set({ syncAttempt: { status: 'PREPARING', message: 'Đang đọc bảng hồ sơ; tự chờ tối đa 5 giây nếu danh sách chưa tải xong…' } });
  const collected = await collectPortal(tabId, source.id, config);
  if (!collected?.ok || collected.sourceSystem !== source.id || !Array.isArray(collected.records)) throw new Error(collected?.error ?? 'Collector không trả dữ liệu hợp lệ.');
  const records = [], errors = Array.isArray(collected.errors) ? collected.errors : [];
  for (const [index, record] of collected.records.entries()) {
    try { records.push(normalizeCollectorCase(record, source.id, { statusMappings: config.statusMappings ?? {} })); }
    catch (error) { errors.push({ index, error: error.message }); }
  }
  if (!records.length) throw new Error(errors[0]?.error ?? collected.emptyMessage ?? 'Bộ đọc không tìm thấy dòng hồ sơ sau khi chờ tải. Kiểm tra kết quả tìm kiếm và cấu hình bộ đọc trên trang nguồn.');
  const replaceSource = source.id === 'MOC';
  if (replaceSource && (errors.length || records.length !== collected.total)) throw new Error('Chưa thay thế dữ liệu MOC: có dòng đọc lỗi. ' + (errors[0]?.error ?? 'Số hồ sơ đọc được không khớp số dòng.'));
  if (replaceSource && records.length > 200) throw new Error('Chưa thay thế dữ liệu MOC: chọn tối đa 200 hồ sơ trên một trang rồi đọc lại.');
  const needsGrant = !collectorToken || (collectorBinding && (collectorBinding.sourceSystem !== source.id
    || collectorBinding.hostname !== hostname || collectorBinding.centralUrl !== centralUrl || Date.parse(collectorBinding.expiresAt) <= Date.now() + 60000));
  if (needsGrant) {
    if (centralUrl !== DEFAULT_CENTRAL_URL) throw new Error('Hệ thống tùy chỉnh cần cấu hình kết nối nâng cao.');
    await chrome.storage.session.set({ syncAttempt: { status: 'PREPARING', message: 'Đang kiểm tra phiên Dashboard và quyền ghi. Có thể mất khoảng 75 giây…' } });
    const grant = await connectDashboard(chrome, source.id, hostname);
    await chrome.storage.session.set({ collectorToken: grant.token,
      collectorBinding: { sourceSystem: source.id, hostname, centralUrl, expiresAt: grant.expiresAt } });
  }
  const id = crypto.randomUUID();
  const job = { id, sourceSystem: source.id, hostname, centralUrl, replaceSource, batches: replaceSource ? [records] : chunks(records), nextBatch: 0, status: 'SYNCING',
    startedAt: new Date().toISOString(), total: collected.total, created: 0, updated: 0, skipped: 0,
    failed: errors.length, errors, collectionContext: collected.collectionContext, scope: 'CURRENT_PAGE_ONLY' };
  await chrome.storage.session.set({ syncJob: job, syncAttempt: null });
  await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  void processBatch();
  return { id, status: 'SYNCING', total: job.total, scope: job.scope };
  } catch (error) {
    if (attempted) await chrome.storage.session.set({ syncAttempt: { status: 'ERROR', message: error.message, finishedAt: new Date().toISOString() } });
    throw error;
  } finally { starting = false; }
}

async function collectPortal(tabId, sourceSystem, config) {
  const checkContext = async () => {
    const { source, tab } = await contextForTab(tabId);
    const actual = new URL(tab.url), expected = new URL(config.listUrl);
    if (source.id !== sourceSystem || actual.origin !== expected.origin || actual.pathname !== expected.pathname) {
      throw new Error('Tab đã chuyển trang. Hãy mở lại đúng danh sách hồ sơ rồi thử lại.');
    }
  };
  return collectWhenReady(() => collectFromTab(chrome, tabId, sourceSystem, config, checkContext), checkContext);
}

async function previewTab(tabId, override = null) {
  if (!Number.isSafeInteger(tabId)) throw new Error('Tab ID không hợp lệ.');
  const context = await contextForTab(tabId);
  const { source } = context;
  const config = override ?? context.config;
  validateAdapterConfig(config, source.id);
  const result = await collectPortal(tabId, source.id, config);
  if (!result?.ok || result.sourceSystem !== source.id || !Array.isArray(result.records)) throw new Error(result?.error ?? 'Không đọc được dữ liệu.');
  const records = result.records.map(record => normalizeCollectorCase(record, source.id, { statusMappings: config.statusMappings ?? {} }));
  return { ok: true, sourceSystem: source.id, total: result.total, valid: records.length,
    errors: result.errors ?? [], emptyMessage: result.emptyMessage, collectionContext: result.collectionContext, records: records.slice(0, 10), scope: 'CURRENT_PAGE_ONLY' };
}

async function processBatch() {
  if (busy) return;
  busy = true;
  try {
    await storageReady;
    const { syncJob: job, collectorToken } = await chrome.storage.session.get(['syncJob', 'collectorToken']);
    if (!job || job.status !== 'SYNCING') { await chrome.alarms.clear(ALARM); return; }
    try {
      if (!collectorToken) throw new Error('Collector token đã hết phiên.');
      if (!(await chrome.permissions.contains({ origins: [hostPermission(job.centralUrl)] }))) throw new Error('Quyền Central API đã bị thu hồi.');
      if (job.nextBatch < job.batches.length) {
        const result = await sendBatch({ centralUrl: job.centralUrl, token: collectorToken, sourceSystem: job.sourceSystem, hostname: job.hostname,
          records: job.batches[job.nextBatch], collectionContext: job.collectionContext, replaceSource: job.replaceSource, batchId: `${job.id}:${job.nextBatch}` });
        for (const key of ['created', 'updated', 'skipped', 'failed']) job[key] += result[key];
        job.errors.push(...result.errors);
        job.nextBatch++;
      }
      if (job.nextBatch >= job.batches.length) {
        job.status = job.failed ? 'SYNC_WITH_ERRORS' : 'SYNC_SUCCESS';
        job.finishedAt = new Date().toISOString();
        delete job.batches;
        await chrome.alarms.clear(ALARM);
      }
      await chrome.storage.session.set({ syncJob: job });
    } catch (error) {
      job.status = 'SYNC_ERROR'; job.error = error.message;
      await chrome.storage.session.set({ syncJob: job });
      await chrome.alarms.clear(ALARM);
    }
  } finally { busy = false; }
}

async function handle(message) {
  await storageReady;
  if (message.type === 'GET_STATE') {
    const local = await chrome.storage.local.get(['centralUrl', 'configurations']);
    const { collectorToken, syncJob } = await chrome.storage.session.get(['collectorToken', 'syncJob']);
    let { syncAttempt } = await chrome.storage.session.get('syncAttempt');
    if (syncAttempt?.status === 'PREPARING' && !starting) {
      syncAttempt = { status: 'ERROR', message: 'Lần chuẩn bị ghi trước bị gián đoạn. Bấm Đọc và ghi lên hệ thống để thử lại.' };
      await chrome.storage.session.set({ syncAttempt });
    }
    let portal = null;
    if (Number.isSafeInteger(message.tabId)) {
      try { const { source, hostname, config } = await contextForTab(message.tabId); portal = { ...source, hostname, configured: !!config }; }
      catch { /* Active tab may not be a portal. */ }
    }
    const summary = syncJob ? { ...syncJob } : null;
    if (summary) delete summary.batches;
    return { ok: true, ...local, centralUrl: local.centralUrl ?? DEFAULT_CENTRAL_URL,
      automaticConnection: !local.centralUrl || local.centralUrl === DEFAULT_CENTRAL_URL, hasCollectorToken: !!collectorToken, portal, syncJob: summary, syncAttempt };
  }
  if (message.type === 'SAVE_CENTRAL') {
    const centralUrl = normalizeCentralUrl(message.centralUrl);
    if (!(await chrome.permissions.contains({ origins: [hostPermission(centralUrl)] }))) throw new Error('Chưa cấp quyền chính xác hostname Central API.');
    if (typeof message.token !== 'string' || message.token.length < 16 || message.token.length > 4096 || /[\s\r\n]/.test(message.token)) throw new Error('Collector token không hợp lệ.');
    if (/^(?:ya29\.|AIza|eyJ)/.test(message.token)) throw new Error('Cần collector token của TTHC MONITOR; không sao chép Google token.');
    const { syncJob } = await chrome.storage.session.get('syncJob');
    if (syncJob?.status === 'SYNCING') throw new Error('Chờ đồng bộ hoàn tất trước khi đổi cấu hình.');
    if (syncJob?.batches && syncJob.centralUrl !== centralUrl) throw new Error('Batch chưa hoàn tất thuộc Central URL cũ. Cần hoàn tất hoặc tải lại extension để xóa batch trước khi đổi URL.');
    await chrome.storage.local.set({ centralUrl });
    await chrome.storage.session.set({ collectorToken: message.token });
    await chrome.storage.session.remove('collectorBinding');
    return { ok: true };
  }
  if (message.type === 'CLEAR_TOKEN') {
    await chrome.storage.session.remove(['collectorToken', 'collectorBinding']); return { ok: true };
  }
  if (message.type === 'SAVE_ADAPTER_CONFIG') {
    const config = validateAdapterConfig(message.config, message.config?.sourceSystem);
    const { configurations = {} } = await chrome.storage.local.get('configurations');
    configurations[config.sourceSystem] = config;
    await chrome.storage.local.set({ configurations });
    return { ok: true };
  }
  if (message.type === 'PREVIEW_SOURCE') return previewTab(message.tabId);
  if (message.type === 'ENABLE_MOC_PROFILE') {
    if (message.confirmed !== true || !Number.isSafeInteger(message.tabId)) throw new Error('Hãy xác nhận đã đăng nhập và đang xem bảng hồ sơ.');
    const { source, hostname } = await contextForTab(message.tabId);
    if (source.id !== 'MOC') throw new Error('Chỉ dùng bộ đọc này trên cổng Bộ Xây dựng.');
    const config = mocProfileConfig(hostname);
    const preview = await previewTab(message.tabId, config);
    if (!preview.valid) throw new Error(preview.errors[0]?.error ?? 'Chưa có dòng hồ sơ hợp lệ để xác nhận bộ đọc. Hãy tìm kiếm để hiện danh sách.');
    const { configurations = {} } = await chrome.storage.local.get('configurations');
    configurations.MOC = config;
    await chrome.storage.local.set({ configurations });
    return preview;
  }
  if (message.type === 'START_SYNC') {
    if (!Number.isSafeInteger(message.tabId)) throw new Error('Tab ID không hợp lệ.');
    return { ok: true, ...await beginSync(message.tabId) };
  }
  if (message.type === 'VIEW_SAVED_CASES') {
    const { syncJob } = await chrome.storage.session.get('syncJob');
    if (!syncJob || !['SYNC_SUCCESS', 'SYNC_WITH_ERRORS'].includes(syncJob.status)
      || syncJob.created + syncJob.updated + syncJob.skipped < 1) throw new Error('Chưa có hồ sơ lưu thành công để xem.');
    if (syncJob.centralUrl !== DEFAULT_CENTRAL_URL) throw new Error('Mở Dashboard của hệ thống tùy chỉnh để xem hồ sơ.');
    return { ok: true, ...await openSavedCases(chrome, syncJob.sourceSystem) };
  }
  if (message.type === 'RESUME_SYNC') {
    const { syncJob, collectorToken } = await chrome.storage.session.get(['syncJob', 'collectorToken']);
    if (!collectorToken || !syncJob || syncJob.status !== 'SYNC_ERROR' || !syncJob.batches) throw new Error('Không có batch lỗi còn lại để gửi lại.');
    syncJob.status = 'SYNCING'; delete syncJob.error;
    await chrome.storage.session.set({ syncJob });
    await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
    void processBatch();
    return { ok: true };
  }
  throw new Error('Lệnh không hợp lệ.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only extension-owned popup/options can initiate API work. Content script messages are rejected.
  if (sender.id !== chrome.runtime.id || sender.tab || !TRUSTED_PAGES.includes(sender.url) || !message || typeof message.type !== 'string') return false;
  handle(message).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void processBatch(); });
