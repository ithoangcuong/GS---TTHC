// Existing project deployment and its publicly inspected Apps Script iframe origin.
export const DEFAULT_CENTRAL_URL = 'https://script.google.com/macros/s/AKfycbxsK6OOhN77YalaKBYzyKIwK-YD2cp_aiFJLb9mVZXOgJif2NPVvn1kyWcWrQVDrkDE/exec';
export const DASHBOARD_FRAME_ORIGIN = 'https://n-aqvzizvfpztqprh75rg5zq5yehraj4xv4vezeci-0lu-script.googleusercontent.com';

// Serialized by chrome.scripting: all inputs are explicit, and the dashboard
// session stays inside its own frame. Only the source-scoped collector grant returns.
export async function requestDashboardGrant(expectedOrigin, centralUrl, sourceSystem, hostname) {
  if (location.origin !== expectedOrigin || location.pathname !== '/userCodeAppPanel' || !globalThis.google?.script?.run) return null;
  const session = sessionStorage.getItem('tthc.dashboard.session');
  if (!session) return { ok: false, code: 'AUTH_REQUIRED' };
  const rpc = (action, payload) => new Promise(resolve => {
    const timer = setTimeout(() => resolve({ ok: false, error: { code: 'TIMEOUT' } }), 25000);
    google.script.run.withSuccessHandler(result => { clearTimeout(timer); resolve(result); })
      .withFailureHandler(() => { clearTimeout(timer); resolve({ ok: false, error: { code: 'CONNECTION_ERROR' } }); })
      .rpc(action, payload, session);
  });
  const failure = (result, stage) => ({ ok: false, stage,
    code: /^[A-Z_]{2,60}$/.test(result?.error?.code ?? '') ? result.error.code : 'CONNECTION_ERROR',
    requestId: /^[A-Za-z0-9_-]{1,100}$/.test(result?.error?.requestId ?? '') ? result.error.requestId : undefined });
  const config = await rpc('auth.config', {});
  if (!config?.ok) return failure(config, 'CONFIG');
  if (config.data?.webAppUrl !== centralUrl) return { ok: false, code: 'DASHBOARD_MISMATCH', stage: 'CONFIG' };
  const identity = await rpc('auth.session', {});
  if (!identity?.ok) return failure(identity, 'SESSION');
  if (identity.data?.mustChangePassword) return { ok: false, code: 'PASSWORD_CHANGE_REQUIRED', stage: 'SESSION' };
  if (identity.data?.permissions?.canSync !== true) return { ok: false, code: 'ACCESS_DENIED', stage: 'SESSION' };
  const result = await rpc('extension.tokens.create', { sourceSystem, hostname });
  if (!result?.ok) return failure(result, 'GRANT');
  const grant = result.data;
  return { ok: true, token: grant.token, sourceSystem: grant.sourceSystem, hostname: grant.hostname, expiresAt: grant.expiresAt };
}

export async function connectDashboard(chrome, sourceSystem, hostname) {
  const tabs = (await chrome.tabs.query({ url: `${DEFAULT_CENTRAL_URL}*` })).filter(tab => {
    try { const url = new URL(tab.url); return `${url.origin}${url.pathname}` === DEFAULT_CENTRAL_URL; } catch { return false; }
  }).sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const loginMessage = 'Đăng nhập Dashboard bằng tài khoản của bạn, sau đó quay lại tab Bộ Xây dựng/cổng nguồn và bấm Đọc và ghi lên hệ thống. Không cần nhập URL hoặc token.';
  if (!tabs.length) { await chrome.tabs.create({ url: DEFAULT_CENTRAL_URL }); throw new Error(loginMessage); }
  const tab = tabs[0];
  // Require the exact known deployment immediately before executing the RPC bridge.
  const current = new URL((await chrome.tabs.get(tab.id)).url);
  if (`${current.origin}${current.pathname}` !== DEFAULT_CENTRAL_URL) throw new Error('Dashboard đã chuyển trang. Mở lại Dashboard và thử lại.');
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN',
      func: requestDashboardGrant, args: [DASHBOARD_FRAME_ORIGIN, DEFAULT_CENTRAL_URL, sourceSystem, hostname] });
  } catch { throw new Error('Chưa truy cập được Dashboard. Tải lại extension, kiểm tra quyền truy cập Dashboard rồi thử lại.'); }
  const responses = results.map(item => item.result).filter(Boolean);
  if (responses.length !== 1) throw new Error('Dashboard chưa tải xong hoặc cấu trúc đã thay đổi. Tải lại Dashboard rồi thử lại.');
  const grant = responses[0];
  if (!grant.ok) {
    if (['AUTH_REQUIRED', 'UNAUTHENTICATED', 'SESSION_EXPIRED', 'SESSION_INVALID'].includes(grant.code)) {
      await chrome.tabs.update(tab.id, { active: true }); throw new Error(loginMessage);
    }
    const messages = { PASSWORD_CHANGE_REQUIRED: 'Đổi mật khẩu mặc định trên Dashboard rồi thử lại.',
      ACCESS_DENIED: 'Tài khoản Dashboard chưa được cấp quyền đồng bộ nguồn này.', SOURCE_DISABLED: 'Nguồn dữ liệu đang bị tắt trên Dashboard.',
      DASHBOARD_MISMATCH: 'Dashboard không khớp địa chỉ hệ thống đã cấu hình.', TIMEOUT: 'Dashboard phản hồi chậm. Vui lòng thử lại.',
      INTERNAL_ERROR: 'Apps Script gặp lỗi máy chủ khi xử lý quyền đồng bộ.',
      CONFIGURATION_ERROR: 'Cấu hình lưu trữ hoặc khóa của Apps Script chưa đầy đủ.',
      VALIDATION_ERROR: 'Máy chủ từ chối thông tin nguồn/hostname. Cần đối chiếu phiên bản Apps Script đang triển khai.',
      ACTION_NOT_FOUND: 'Apps Script đang triển khai chưa hỗ trợ thao tác cấp quyền này.',
      CONNECTION_ERROR: 'Lệnh RPC tới Apps Script thất bại. Tải lại Dashboard và thử lại.',
      SHEET_MISSING: 'Google Sheets đang thiếu bảng hệ thống cần để cấp quyền đồng bộ.',
      SHEET_SCHEMA_CONFLICT: 'Cấu trúc bảng Google Sheets khác cấu trúc Apps Script yêu cầu.',
      SHEET_NOT_CONFIGURED: 'Apps Script chưa được cấu hình ID Google Sheets.',
      SHEET_DUPLICATE_KEY: 'Bảng hệ thống có khóa trùng; cần kiểm tra dữ liệu trước khi ghi.',
      REPOSITORY_BLOCKED: 'Kho dữ liệu đang bị khóa hoặc cần phục hồi; chưa thể cấp quyền ghi.',
      SHEET_WRITE_FAILED: 'Máy chủ chưa ghi được quyền đồng bộ vào Google Sheets.',
      BUSY: 'Google Sheets đang bận ghi dữ liệu. Chờ vài giây rồi thử lại.',
      CONFLICT: 'Dữ liệu đang được cập nhật đồng thời. Chờ vài giây rồi thử lại.' };
    const code = /^[A-Z_]{2,60}$/.test(grant.code ?? '') ? grant.code : 'UNKNOWN_ERROR';
    const stage = { CONFIG: 'kiểm tra cấu hình', SESSION: 'kiểm tra phiên đăng nhập', GRANT: 'cấp quyền đồng bộ' }[grant.stage];
    const requestId = /^[A-Za-z0-9_-]{1,100}$/.test(grant.requestId ?? '') ? grant.requestId : '';
    throw new Error(`${messages[code] ?? 'Dashboard chưa cấp được quyền đồng bộ.'} [${code}${stage ? ` · ${stage}` : ''}]${requestId ? ` Mã yêu cầu: ${requestId}.` : ''}`);
  }
  if (!/^tthc\.c\.[a-f0-9]{64}$/.test(grant.token) || grant.sourceSystem !== sourceSystem || grant.hostname !== hostname
    || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('Quyền đồng bộ Dashboard trả về không hợp lệ.');
  return grant;
}

export function showSavedCasesInFrame(expectedOrigin, sourceSystem) {
  if (location.origin !== expectedOrigin || location.pathname !== '/userCodeAppPanel'
    || !document.querySelector('#app') || !globalThis.google?.script?.run) return null;
  const target = `#cases?sourceSystem=${encodeURIComponent(sourceSystem)}`;
  if (location.hash === target) window.dispatchEvent(new Event('hashchange'));
  else location.hash = target;
  return { opened: true };
}

export async function openSavedCases(chrome, sourceSystem) {
  const tabs = await chrome.tabs.query({ url: `${DEFAULT_CENTRAL_URL}*` });
  const tab = tabs.find(item => {
    try { const url = new URL(item.url); return `${url.origin}${url.pathname}` === DEFAULT_CENTRAL_URL; } catch { return false; }
  });
  if (!tab) { await chrome.tabs.create({ url: DEFAULT_CENTRAL_URL }); return { needsLogin: true }; }
  const current = new URL((await chrome.tabs.get(tab.id)).url);
  if (`${current.origin}${current.pathname}` !== DEFAULT_CENTRAL_URL) throw new Error('Dashboard đã chuyển trang. Hãy mở lại Dashboard.');
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'MAIN',
    func: showSavedCasesInFrame, args: [DASHBOARD_FRAME_ORIGIN, sourceSystem] });
  if (!results.some(item => item.result?.opened)) throw new Error('Dashboard chưa tải xong. Tải lại Dashboard rồi mở Danh sách hồ sơ.');
  await chrome.tabs.update(tab.id, { active: true });
  return { opened: true };
}
