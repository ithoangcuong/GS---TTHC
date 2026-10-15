export const BATCH_SIZE = 100;
export function chunks(records, size = BATCH_SIZE) {
  if (!Number.isSafeInteger(size) || size < 1 || size > BATCH_SIZE) throw new Error('Kích thước batch không hợp lệ.');
  const result = [];
  for (let offset = 0; offset < records.length; offset += size) result.push(records.slice(offset, offset + size));
  return result;
}
export function normalizeCentralUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('URL hệ thống trung tâm không hợp lệ.');
  const url = new URL(value);
  if (url.hostname === 'script.google.com') {
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
      || !/^\/macros\/s\/[A-Za-z0-9_-]{10,256}\/exec$/.test(url.pathname)) throw new Error('Cần URL triển khai Apps Script HTTPS /macros/s/DEPLOYMENT/exec.');
    return url.toString();
  }
  if (url.hostname === 'script.googleusercontent.com') throw new Error('Không cấu hình URL redirect làm endpoint.');
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))
    || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Central URL phải là HTTPS origin; HTTP chỉ cho localhost.');
  return url.origin;
}
export function isAppsScriptUrl(value) { return new URL(normalizeCentralUrl(value)).hostname === 'script.google.com'; }
export function hostPermission(value) {
  const url = new URL(normalizeCentralUrl(value));
  return url.hostname === 'script.google.com' ? 'https://script.google.com/macros/s/*' : `${url.origin}/*`;
}

function verifyAppsScriptResponse(response, endpoint) {
  let final;
  try { final = new URL(response.url); } catch { throw new Error('Không xác nhận được endpoint Apps Script trả kết quả.'); }
  if (final.protocol !== 'https:' || final.username || final.password || final.port
    || !(final.toString() === endpoint || final.hostname === 'script.googleusercontent.com')) throw new Error('Redirect Apps Script ngoài hostname được phép.');
}

const API_ERRORS = Object.freeze({ TOKEN_INVALID: 'Collector token hết hạn hoặc không hợp lệ.',
  COLLECTOR_UPDATE_REQUIRED: 'Cần tải lại Collector 0.7.0 và trang MOC để dùng chế độ thay thế lần đọc mới nhất.',
  SNAPSHOT_INCOMPLETE: 'Chưa thay thế MOC: máy chủ phát hiện hồ sơ lỗi, trùng mã hoặc quan sát cũ. Dữ liệu lần thành công trước vẫn được giữ.',
  AUTH_REQUIRED: 'Cần đăng nhập dashboard và cấp lại collector token.', ACCESS_DENIED: 'Tài khoản/token không có quyền đồng bộ nguồn này.',
  VALIDATION_ERROR: 'Payload hồ sơ không hợp lệ.', SOURCE_DISABLED: 'Nguồn đã bị tắt trên hệ thống trung tâm.',
  CONFIGURATION_ERROR: 'Apps Script chưa được cấu hình đầy đủ.', CONFLICT: 'Batch xung đột với dữ liệu đã ghi.' });

/** Stable batchId across retries. Redirection and portal credentials are never forwarded. */
export async function sendBatch({ centralUrl, token, sourceSystem, hostname, records, cases, batchId, collectionContext, replaceSource }, {
  fetchImpl = fetch, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), retries = 3,
  timeoutMs = 15000,
} = {}) {
  const endpoint = normalizeCentralUrl(centralUrl), gas = isAppsScriptUrl(endpoint);
  if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /\s/.test(token)) throw new Error('Cần collector token hợp lệ từ hệ thống trung tâm.');
  if (/^(?:ya29\.|AIza|eyJ)/.test(token)) throw new Error('Chỉ dùng collector token do TTHC MONITOR cấp, không dùng Google token.');
  records = cases ?? records;
  if (!Array.isArray(records) || records.length > (gas && sourceSystem === 'MOC' && replaceSource === true ? 200 : BATCH_SIZE) || !batchId) throw new Error('Batch không hợp lệ.');
  if (typeof batchId !== 'string' || batchId.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(batchId)) throw new Error('Batch ID không hợp lệ.');
  const source = sourceById(sourceSystem);
  if (!source || (gas && !source.supportedHosts.includes(hostname))) throw new Error('Hostname không khớp nguồn batch.');
  const payload = gas ? records.map(record => normalizeCollectorCase(record, sourceSystem)) : records;
  const body = JSON.stringify(gas ? { action: 'collector.sync', token, sourceSystem, hostname, cases: payload, batchId, collectionContext, ...(replaceSource === true ? { replaceSource: true } : {}) }
    : { sourceSystem, records, batchId });
  for (let attempt = 0; attempt <= retries; attempt++) {
    let retryable = true;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response, result;
      try {
        // Apps Script ContentService redirects to script.googleusercontent.com. Manifest CSP
        // restricts the complete redirect chain to those two origins; final URL is also checked.
        response = await fetchImpl(gas ? endpoint : `${endpoint}/api/collector/sync`, { method: 'POST', credentials: 'omit', redirect: gas ? 'follow' : 'error',
          headers: gas ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          referrerPolicy: 'no-referrer', cache: 'no-store', body, signal: controller.signal });
        if (response.ok) {
          if (gas) { retryable = false; verifyAppsScriptResponse(response, endpoint); }
          result = await response.json();
        }
      } finally { clearTimeout(timer); }
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        throw new Error(response.status === 401 ? 'Collector token hết hạn hoặc không hợp lệ.' : `Central API trả HTTP ${response.status}.`);
      }
      if (gas) {
        if (result?.ok !== true) {
          retryable = ['SERVER_ERROR', 'RATE_LIMITED'].includes(result?.error?.code);
          throw new Error(API_ERRORS[result?.error?.code] ?? 'Apps Script không hoàn tất đồng bộ.');
        }
        result = result.data;
      }
      if (!result || !['total', 'created', 'updated', 'skipped', 'failed'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0)
        || !Array.isArray(result.errors)) { retryable = false; throw new Error('Kết quả sync không hợp lệ.'); }
      return { ...result, errors: result.errors.map(item => ({ index: Number.isSafeInteger(item?.index) ? item.index : null,
        error: String(item?.error ?? item?.message ?? 'Hồ sơ bị từ chối.').split(token).join('[token]').slice(0, 500) })) };
    } catch (error) {
      if (!retryable || attempt === retries) throw new Error(error.name === 'AbortError' ? 'Central API quá thời gian chờ.' : error.message);
      await sleep(500 * (2 ** attempt));
    }
  }
}
import { sourceById } from '../adapters/source-registry.mjs';
import { normalizeCollectorCase } from '../normalizer/case-normalizer.mjs';

