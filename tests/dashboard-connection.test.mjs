import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { connectDashboard, requestDashboardGrant, showSavedCasesInFrame, DEFAULT_CENTRAL_URL, DASHBOARD_FRAME_ORIGIN } from '../extension/api/dashboard.mjs';
const grant = () => ({ ok: true, token: `tthc.c.${'a'.repeat(64)}`, sourceSystem: 'MOC', hostname: 'motcuabxd.moc.gov.vn', expiresAt: new Date(Date.now() + 3600000).toISOString() });
const connect = chrome => connectDashboard(chrome, 'MOC', 'motcuabxd.moc.gov.vn');
test('grant errors keep a safe diagnostic code, stage and request ID without reflecting server secrets', async () => {
  const chrome = { tabs: { query: async () => [{ id: 9, url: DEFAULT_CENTRAL_URL }], get: async () => ({ url: DEFAULT_CENTRAL_URL }) },
    scripting: { executeScript: async () => [{ result: { ok: false, code: 'INTERNAL_ERROR', stage: 'GRANT', requestId: 'test-request-123', message: 'SECRET must not be reflected' } }] } };
  await assert.rejects(() => connect(chrome), error => /INTERNAL_ERROR/.test(error.message)
    && /cấp quyền đồng bộ/.test(error.message) && /test-request-123/.test(error.message) && !/SECRET/.test(error.message));
  chrome.scripting.executeScript = async () => [{ result: { ok: false, code: 'SECRET\nVALUE', requestId: 'bad value SECRET' } }];
  await assert.rejects(() => connect(chrome), error => /UNKNOWN_ERROR/.test(error.message) && !/SECRET/.test(error.message));
});

test('session permission check stops before issuing grants and config failures retain original error code', async () => {
  for (const scenario of ['denied', 'password', 'config', 'grant']) {
    const calls = [];
    const context = vm.createContext({ location: { origin: DASHBOARD_FRAME_ORIGIN, pathname: '/userCodeAppPanel' },
      sessionStorage: { getItem: () => 'private-session' }, setTimeout, clearTimeout,
      google: { script: { get run() {
        let done;
        const runner = { withSuccessHandler: callback => { done = callback; return runner; }, withFailureHandler: () => runner,
          rpc: action => {
            calls.push(action);
            if (action === 'auth.config') done(scenario === 'config' ? { ok: false, error: { code: 'BUSY', requestId: 'config-123' } } : { ok: true, data: { webAppUrl: DEFAULT_CENTRAL_URL } });
            else if (action === 'auth.session') done({ ok: true, data: { mustChangePassword: scenario === 'password', permissions: { canSync: scenario !== 'denied' } } });
            else done({ ok: false, error: { code: 'SHEET_MISSING', requestId: 'grant-123', message: 'private-session' } });
          } };
        return runner;
      } } } });
    const fn = vm.runInContext(`(${requestDashboardGrant.toString()})`, context);
    const result = await fn(DASHBOARD_FRAME_ORIGIN, DEFAULT_CENTRAL_URL, 'MOC', 'motcuabxd.moc.gov.vn');
    assert.equal(result.code, { denied: 'ACCESS_DENIED', password: 'PASSWORD_CHANGE_REQUIRED', config: 'BUSY', grant: 'SHEET_MISSING' }[scenario]);
    assert.equal(calls.includes('extension.tokens.create'), scenario === 'grant');
    assert.ok(!JSON.stringify(result).includes('private-session'));
    if (scenario === 'grant') { assert.equal(result.stage, 'GRANT'); assert.equal(result.requestId, 'grant-123'); }
  }
});
test('automatic connection opens the known dashboard when login is needed', async () => {
  let opened;
  await assert.rejects(() => connect({ tabs: { query: async () => [], create: async arg => { opened = arg; } } }), /Đăng nhập Dashboard/);
  assert.deepEqual(opened, { url: DEFAULT_CENTRAL_URL });
});
test('automatic connection only injects into the exact deployment and validates the scoped grant', async () => {
  let injection;
  const chrome = { tabs: { query: async () => [{ id: 8, url: `${DEFAULT_CENTRAL_URL}evil` }, { id: 9, url: DEFAULT_CENTRAL_URL }], get: async () => ({ url: DEFAULT_CENTRAL_URL }) },
    scripting: { executeScript: async args => { injection = args; return [{ result: null }, { result: grant() }]; } } };
  assert.equal((await connect(chrome)).sourceSystem, 'MOC');
  assert.equal(injection.target.tabId, 9); assert.equal(injection.world, 'MAIN');
  assert.deepEqual(injection.args, [DASHBOARD_FRAME_ORIGIN, DEFAULT_CENTRAL_URL, 'MOC', 'motcuabxd.moc.gov.vn']);
  for (const patch of [{ sourceSystem: 'MOH' }, { hostname: 'other.example' }, { token: 'invalid' }, { expiresAt: 'invalid' }]) {
    chrome.scripting.executeScript = async () => [{ result: { ...grant(), ...patch } }];
    await assert.rejects(() => connect(chrome), /không hợp lệ/);
  }
  chrome.tabs.get = async () => ({ url: 'https://example.com/' });
  chrome.scripting.executeScript = async () => assert.fail('must not inject after navigation');
  await assert.rejects(() => connect(chrome), /chuyển trang/);
});
test('dashboard RPC keeps the dashboard session in its frame and requests only the scoped collector grant', async () => {
  const calls = [];
  const context = vm.createContext({ location: { origin: DASHBOARD_FRAME_ORIGIN, pathname: '/userCodeAppPanel' },
    sessionStorage: { getItem: key => { assert.equal(key, 'tthc.dashboard.session'); return 'private-dashboard-session'; } },
    setTimeout, clearTimeout, google: { script: { get run() {
      let success;
      const runner = { withSuccessHandler: fn => { success = fn; return runner; }, withFailureHandler: () => runner,
        rpc: (action, payload, session) => {
          calls.push({ action, payload, session });
          success(action === 'auth.config' ? { ok: true, data: { webAppUrl: DEFAULT_CENTRAL_URL } }
            : action === 'auth.session' ? { ok: true, data: { permissions: { canSync: true } } } : { ok: true, data: grant() });
        } };
      return runner;
    } } } });
  const fn = vm.runInContext(`(${requestDashboardGrant.toString()})`, context);
  const result = await fn(DASHBOARD_FRAME_ORIGIN, DEFAULT_CENTRAL_URL, 'MOC', 'motcuabxd.moc.gov.vn');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(call => call.action), ['auth.config', 'auth.session', 'extension.tokens.create']);
  assert.equal(calls[2].payload.sourceSystem, 'MOC');
  assert.ok(calls.every(call => call.session === 'private-dashboard-session'));
  assert.ok(!JSON.stringify(result).includes('private-dashboard-session'));
  context.location.origin = 'https://attacker.example';
  assert.equal(await fn(DASHBOARD_FRAME_ORIGIN, DEFAULT_CENTRAL_URL, 'MOC', 'motcuabxd.moc.gov.vn'), null);
  assert.equal(calls.length, 3);
});
test('unauthenticated dashboard never attempts to issue a collector grant', async () => {
  const context = vm.createContext({ location: { origin: DASHBOARD_FRAME_ORIGIN, pathname: '/userCodeAppPanel' },
    sessionStorage: { getItem: () => null }, google: { script: { run: {} } } });
  const fn = vm.runInContext(`(${requestDashboardGrant.toString()})`, context);
  assert.equal((await fn(DASHBOARD_FRAME_ORIGIN, DEFAULT_CENTRAL_URL, 'MOC', 'motcuabxd.moc.gov.vn')).code, 'AUTH_REQUIRED');
});

test('worker writes using automatic connection with no saved URL or token', async () => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  let listener, sent, finish, reads = 0;
  const completed = new Promise(resolve => { finish = resolve; });
  const session = {}, local = { configurations: { MOC: { sourceSystem: 'MOC', profile: 'MOC_SEARCH_V1', confirmed: true,
    listUrl: 'https://motcuabxd.moc.gov.vn/vi/dossier/search', statusMappings: { 'Đang xử lý': 'PROCESSING' } } } };
  const area = state => ({ setAccessLevel: async () => {},
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in state).map(key => [key, state[key]])),
    set: async values => { Object.assign(state, values); if (values.syncJob?.status === 'SYNC_SUCCESS') finish(); },
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete state[key]; } });
  const chrome = { runtime: { id: 'auto-dashboard-test', getURL: path => `chrome-extension://auto-dashboard-test/${path}`,
    onMessage: { addListener: fn => { listener = fn; } } }, storage: { local: area(local), session: area(session) },
    permissions: { contains: async () => true }, alarms: { onAlarm: { addListener: () => {} }, create: async () => {}, clear: async () => {} },
    tabs: { query: async () => [{ id: 9, url: DEFAULT_CENTRAL_URL }],
      get: async id => ({ id, active: id === 7, url: id === 7 ? local.configurations.MOC.listUrl : DEFAULT_CENTRAL_URL }),
      sendMessage: async () => { reads++; return { ok: true, sourceSystem: 'MOC', total: 1, errors: [], collectionContext: { submittedFrom: '2026-10-01', submittedTo: '2026-10-12', capturedAt: new Date().toISOString(), scope: 'CURRENT_PAGE_ONLY', basis: 'VISIBLE_FILTERS' }, records: [{ caseCode: 'SYNTHETIC-AUTO',
        sourceStatus: 'Đang xử lý', lastObservedAt: new Date().toISOString() }] }; } },
    scripting: { executeScript: async () => { assert.equal(reads, 1, 'Read source snapshot before waiting for Dashboard grant'); return [{ result: grant() }]; } } };
  try {
    globalThis.chrome = chrome;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, DEFAULT_CENTRAL_URL); sent = JSON.parse(options.body);
      return { ok: true, url, json: async () => ({ ok: true, data: { total: 1, created: 1, updated: 0, skipped: 0, failed: 0, errors: [] } }) };
    };
    await import('../extension/background/service-worker.mjs?automatic-dashboard-test');
    const response = await new Promise(resolve => listener({ type: 'START_SYNC', tabId: 7 },
      { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/index.html') }, resolve));
    assert.equal(response.ok, true, response.error);
    let timeout;
    try { await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Sync did not finish')), 1000); })]); }
    finally { clearTimeout(timeout); }
    assert.equal(session.syncJob.status, 'SYNC_SUCCESS');
    assert.equal(sent.cases[0].caseCode, 'SYNTHETIC-AUTO');
    assert.equal(sent.collectionContext.submittedFrom, '2026-10-01');
    assert.equal(sent.collectionContext.submittedTo, '2026-10-12');
    assert.equal(sent.replaceSource, true);
    assert.equal(sent.token, grant().token);
    assert.equal(session.collectorBinding.sourceSystem, 'MOC');
    assert.equal(local.collectorToken, undefined);
    assert.equal(session.syncAttempt, null);
    chrome.tabs.sendMessage = async () => ({ ok: false, error: 'Bảng hồ sơ chưa tải xong.' });
    const failed = await new Promise(resolve => listener({ type: 'START_SYNC', tabId: 7 },
      { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/index.html') }, resolve));
    assert.equal(failed.ok, false);
    assert.equal(session.syncAttempt.status, 'ERROR');
    const reopened = await new Promise(resolve => listener({ type: 'GET_STATE', tabId: 7 },
      { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/index.html') }, resolve));
    assert.match(reopened.syncAttempt.message, /chưa tải xong/);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});

test('view saved cases removes stale filters and refreshes even when already on the same route', () => {
  let refreshed = 0;
  const context = vm.createContext({ location: { origin: DASHBOARD_FRAME_ORIGIN, pathname: '/userCodeAppPanel', hash: '#cases?sourceSystem=MOH&q=old' },
    document: { querySelector: () => ({}) }, google: { script: { run: {} } }, encodeURIComponent,
    window: { dispatchEvent: () => { refreshed++; } }, Event: class { constructor(type) { this.type = type; } } });
  const fn = vm.runInContext(`(${showSavedCasesInFrame.toString()})`, context);
  assert.equal(fn(DASHBOARD_FRAME_ORIGIN, 'MOC').opened, true);
  assert.equal(context.location.hash, '#cases?sourceSystem=MOC');
  fn(DASHBOARD_FRAME_ORIGIN, 'MOC');
  assert.equal(refreshed, 1);
});
