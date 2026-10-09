import { sourceByHostname } from '../adapters/source-registry.mjs';
import { normalizeCollectorCase } from '../normalizer/case-normalizer.mjs';
import { validateAdapterConfig } from '../adapters/base.mjs';
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
  try {
  await storageReady;
  const { collectorToken, syncJob } = await chrome.storage.session.get(['collectorToken', 'syncJob']);
  if (!collectorToken) throw new Error('Cần collector token được cấp bởi hệ thống trung tâm.');
  if (syncJob?.status === 'SYNCING') throw new Error('Đồng bộ đang chạy; chờ kết quả.');
  const { centralUrl } = await chrome.storage.local.get('centralUrl');
  if (!centralUrl || !(await chrome.permissions.contains({ origins: [hostPermission(centralUrl)] }))) throw new Error('Chưa cấp quyền kết nối Central API.');
  const { source, hostname, config } = await contextForTab(tabId);
  validateAdapterConfig(config, source.id);
  const collected = await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_VERIFIED_TABLE', sourceSystem: source.id, config }, { frameId: 0 });
  if (!collected?.ok || collected.sourceSystem !== source.id || !Array.isArray(collected.records)) throw new Error(collected?.error ?? 'Collector không trả dữ liệu hợp lệ.');
  const records = [], errors = Array.isArray(collected.errors) ? collected.errors : [];
  for (const [index, record] of collected.records.entries()) {
    try { records.push(normalizeCollectorCase(record, source.id, { statusMappings: config.statusMappings ?? {} })); }
    catch (error) { errors.push({ index, error: error.message }); }
  }
  const id = crypto.randomUUID();
  const job = { id, sourceSystem: source.id, hostname, centralUrl, batches: chunks(records), nextBatch: 0, status: 'SYNCING',
    startedAt: new Date().toISOString(), total: collected.total, created: 0, updated: 0, skipped: 0,
    failed: errors.length, errors, scope: 'CURRENT_PAGE_ONLY' };
  await chrome.storage.session.set({ syncJob: job });
  await chrome.alarms.create(ALARM, { delayInMinutes: 0.5, periodInMinutes: 0.5 });
  void processBatch();
  return { id, status: 'SYNCING', total: job.total, scope: job.scope };
  } finally { starting = false; }
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
          records: job.batches[job.nextBatch], batchId: `${job.id}:${job.nextBatch}` });
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
    let portal = null;
    if (Number.isSafeInteger(message.tabId)) {
      try { const { source, hostname, config } = await contextForTab(message.tabId); portal = { ...source, hostname, configured: !!config }; }
      catch { /* Active tab may not be a portal. */ }
    }
    const summary = syncJob ? { ...syncJob } : null;
    if (summary) delete summary.batches;
    return { ok: true, ...local, hasCollectorToken: !!collectorToken, portal, syncJob: summary };
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
    return { ok: true };
  }
  if (message.type === 'CLEAR_TOKEN') {
    await chrome.storage.session.remove('collectorToken'); return { ok: true };
  }
  if (message.type === 'SAVE_ADAPTER_CONFIG') {
    const config = validateAdapterConfig(message.config, message.config?.sourceSystem);
    const { configurations = {} } = await chrome.storage.local.get('configurations');
    configurations[config.sourceSystem] = config;
    await chrome.storage.local.set({ configurations });
    return { ok: true };
  }
  if (message.type === 'START_SYNC') {
    if (!Number.isSafeInteger(message.tabId)) throw new Error('Tab ID không hợp lệ.');
    return { ok: true, ...await beginSync(message.tabId) };
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
