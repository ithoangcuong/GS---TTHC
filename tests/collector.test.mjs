import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SOURCES, sourceByHostname } from '../shared/registry.mjs';
import { STATUSES, normalizeCase, parseTimestamp, validateCase } from '../shared/normalize.mjs';
import { recordsFromCells, SourceAdapter, TPHCM_HEADER_MAPPINGS, validateAdapterConfig } from '../extension/adapters/base.mjs';
import { adapterForHost } from '../extension/adapters/registry.mjs';
import { chunks, normalizeCentralUrl, sendBatch } from '../extension/api/sync.mjs';

// Synthetic fixtures exercise parser/security behavior. They are not portal HTML/API evidence.
const syntheticConfig = () => ({ sourceSystem: 'TPHCM', verified: true,
  evidence: { reference: 'SYNTHETIC TEST ONLY — no real portal selector', verifiedAt: '2026-10-01T00:00:00Z' },
  listUrl: 'https://motcua.tphcm.gov.vn/synthetic-test-list', loggedInSelector: '#synthetic-authenticated',
  tableSelector: '#synthetic-table', headerSelector: '.synthetic-header', rowSelector: '.synthetic-row', cellSelector: '.synthetic-cell',
  headerMappings: { 'Mã số hồ sơ': 'caseCode', 'Ngày hẹn trả': 'dueAt', 'Trạng thái': 'sourceStatus' },
  statusMappings: { 'Đang xử lý': 'PROCESSING' } });
const syntheticNode = (tagName = 'SPAN') => ({ tagName, hidden: false, getAttribute: () => null, getClientRects: () => [{}] });
function syntheticDocument({ authenticated = true, rows = [] } = {}) {
  const table = syntheticNode('TABLE');
  table.querySelectorAll = selector => selector === '.synthetic-header'
    ? ['Mã số hồ sơ', 'Ngày hẹn trả', 'Trạng thái', 'Thời gian còn lại'].map(textContent => ({ ...syntheticNode(), textContent }))
    : rows.map(cells => ({ ...syntheticNode('TR'), querySelectorAll: () => cells.map(textContent => ({ ...syntheticNode('TD'), textContent })) }));
  return { querySelector: selector => selector === '#synthetic-authenticated' ? authenticated ? syntheticNode() : null : selector === '#synthetic-table' ? table : null };
}

test('legacy registry remains compatible with prior sample labels and MOC alias', () => {
  assert.equal(SOURCES.length, 11);
  assert.equal(sourceByHostname('motcuabxd.moc.gov.vn')?.id, 'MOC');
  assert.equal(sourceByHostname('motcua.moc.gov.vn')?.id, 'MOC');
  assert.equal(sourceByHostname('motcuabxd.moc.gov.vn.attacker.example'), null);
  assert.equal(sourceByHostname('evil.motcuabxd.moc.gov.vn'), null);
  assert.equal(sourceByHostname('motcua.tphcm.gov.vn.attacker.example'), null);
  assert.equal(sourceByHostname('evil.motcua.tphcm.gov.vn'), null);
  assert.equal(SOURCES.find(source => source.id === 'TPHCM').adapterStatus, 'PARTIAL');
  assert.equal(SOURCES.filter(source => source.adapterStatus === 'WAITING_FOR_SAMPLE').length, 10);
});

test('Vietnamese timestamps have explicit +07 interpretation and strict calendar validation', () => {
  assert.equal(parseTimestamp('08/10/2026 09:04:34'), '2026-10-08T02:04:34.000Z');
  assert.equal(parseTimestamp('2026-10-08T09:04:34+07:00'), '2026-10-08T02:04:34.000Z');
  assert.equal(parseTimestamp('29/02/2024 23:59:59'), '2024-02-29T16:59:59.000Z');
  assert.equal(parseTimestamp(''), null);
  for (const value of ['08/10/2026', '2026-10-08', '2026-10-08T09:04:34', '31/02/2026 00:00:00',
    '29/02/2026 00:00:00', '2026-10-08T24:00:00Z', '2026-10-08T09:00:00+14:30', '2026-13-01T00:00:00Z']) {
    assert.throws(() => parseTimestamp(value), undefined, value);
  }
});

test('normalize evidenced aliases, official deadline and sample status; ignore portal countdown', () => {
  const record = normalizeCase({ maHoSo: 'SYNTHETIC-001', ngayHenTra: '08/10/2026 09:04:34',
    nguoiXuLy: 'Cán bộ tổng hợp', trangThai: 'Đang xử lý', remaining: 'Còn 999 ngày',
    riskScore: 99, password: 'must-not-leave-browser' }, 'TPHCM');
  assert.equal(record.caseCode, 'SYNTHETIC-001');
  assert.equal(record.dueAt, '2026-10-08T02:04:34.000Z');
  assert.equal(record.normalizedStatus, 'PROCESSING');
  assert.equal(record.officerName, 'Cán bộ tổng hợp');
  assert.equal('riskScore' in record, false);
  assert.equal('remaining' in record, false);
  assert.equal('password' in record, false);
});

test('sparse updates preserve missing optional fields and explicit null clears', () => {
  const missing = normalizeCase({ caseCode: 'SYNTHETIC-002' }, 'MOC');
  assert.equal('dueAt' in missing, false);
  assert.equal('completedAt' in missing, false);
  assert.equal('officerName' in missing, false);
  assert.equal('normalizedStatus' in missing, false);
  const cleared = normalizeCase({ caseCode: 'SYNTHETIC-002', dueAt: null, officerName: null }, 'MOC');
  assert.equal(cleared.dueAt, null);
  assert.equal(cleared.officerName, null);
});

test('unknown status is explicit; configured source status mapping works', () => {
  assert.equal(normalizeCase({ caseCode: 'SYNTHETIC-003', sourceStatus: 'Trạng thái chưa kiểm chứng' }, 'MOC').normalizedStatus, 'UNKNOWN');
  assert.equal(normalizeCase({ caseCode: 'SYNTHETIC-003', sourceStatus: 'toString' }, 'TPHCM').normalizedStatus, 'UNKNOWN');
  assert.equal(normalizeCase({ caseCode: 'SYNTHETIC-003', sourceStatus: 'Synthetic done' }, 'MOC',
    { statusMappings: { 'Synthetic done': 'COMPLETED' } }).normalizedStatus, 'COMPLETED');
  assert.throws(() => normalizeCase({ caseCode: 'x' }, 'MOC', { statusMappings: { bad: 'FAKE_STATUS' } }));
});

test('already canonical statuses survive unknown source labels, while evidenced mappings take priority', () => {
  for (const normalizedStatus of STATUSES) {
    assert.equal(normalizeCase({ caseCode: `SYNTHETIC-${normalizedStatus}`, sourceStatus: normalizedStatus, normalizedStatus }, 'MOC').normalizedStatus, normalizedStatus);
    assert.equal(normalizeCase({ caseCode: `SYNTHETIC-${normalizedStatus}`, normalizedStatus }, 'MOC').normalizedStatus, normalizedStatus);
  }
  assert.equal(normalizeCase({ caseCode: 'SYNTHETIC-MAP', sourceStatus: 'Đã trả kết quả', normalizedStatus: 'PROCESSING' }, 'TPHCM').normalizedStatus, 'COMPLETED');
  assert.equal(normalizeCase({ caseCode: 'SYNTHETIC-UNKNOWN', sourceStatus: 'Unverified label', normalizedStatus: 'FAKE' }, 'MOC').normalizedStatus, 'UNKNOWN');
});

test('normalization validates identity, source mismatch, scalar types and step constraints', () => {
  assert.throws(() => normalizeCase({ caseCode: null }, 'MOC'));
  assert.throws(() => normalizeCase({ caseCode: 'x', sourceSystem: 'MOF' }, 'MOC'));
  assert.throws(() => normalizeCase({ caseCode: 'x', applicantName: { arbitrary: true } }, 'MOC'));
  assert.throws(() => normalizeCase({ caseCode: 'x', currentStep: 4, totalSteps: 3 }, 'MOC'));
  assert.throws(() => normalizeCase({ caseCode: 'x', totalPausedSeconds: -1 }, 'MOC'));
  assert.throws(() => normalizeCase({ caseCode: 'x', receivedAt: '2026-10-08T09:00:00+07:00', completedAt: '2026-10-07T09:00:00+07:00' }, 'MOC'));
  assert.equal(validateCase(normalizeCase({ caseCode: 'x', currentStep: '2', totalSteps: 4 }, 'MOC')).length, 0);
});

test('source links only allow exact HTTPS source aliases and strip query/hash', () => {
  const record = normalizeCase({ caseCode: 'x', sourceUrl: 'https://motcuabxd.moc.gov.vn/vi/dossier/search?session=dropped#fragment' }, 'MOC');
  assert.equal(record.sourceUrl, 'https://motcuabxd.moc.gov.vn/vi/dossier/search');
  assert.equal(normalizeCase({ caseCode: 'legacy', sourceUrl: 'https://motcua.moc.gov.vn/vi/dossier/search' }, 'MOC').sourceUrl, 'https://motcua.moc.gov.vn/vi/dossier/search');
  for (const sourceUrl of ['javascript:alert(1)', 'http://motcua.moc.gov.vn/', 'https://motcua.moc.gov.vn.attacker.example/',
    'https://motcuabxd.moc.gov.vn.attacker.example/', 'https://evil.motcuabxd.moc.gov.vn/',
    'https://motcua.tphcm.gov.vn/vi/dossier/search', 'https://user:secret@motcua.moc.gov.vn/']) {
    assert.throws(() => normalizeCase({ caseCode: 'x', sourceUrl }, 'MOC'));
  }
});

test('metadata rejects nested credentials, token/session variants and prototype pollution', () => {
  for (const metadata of [{ token: 'secret' }, { deep: [{ portal_cookie: 'secret' }] }, { 's-e-s-s-i-o-n': 'secret' },
    JSON.parse('{"safe":{"__proto__":{"polluted":true}}}')]) assert.throws(() => normalizeCase({ caseCode: 'x', metadata }, 'MOC'));
  const safe = normalizeCase({ caseCode: 'x', metadata: { supplementCount: 2, tags: ['safe'], nested: { value: null } } }, 'MOC');
  assert.equal(safe.metadata.supplementCount, 2);
});

test('header parser ignores countdown, detects changed rows and avoids guessed column positions', () => {
  const candidates = recordsFromCells(['Trạng thái', 'Mã số hồ sơ', 'Thời gian còn lại'],
    [['Đang xử lý', 'SYNTHETIC-004', 'Còn 1000 ngày'], ['mismatched row']], { 'Trạng thái': 'sourceStatus', 'Mã số hồ sơ': 'caseCode' });
  assert.deepEqual(candidates[0].record, { sourceStatus: 'Đang xử lý', caseCode: 'SYNTHETIC-004' });
  assert.match(candidates[1].error, /Số ô/);
  assert.throws(() => recordsFromCells(['Unknown header'], [['x']], TPHCM_HEADER_MAPPINGS));
  assert.throws(() => recordsFromCells(['Mã số hồ sơ', 'Mã hồ sơ'], [['x', 'x']], TPHCM_HEADER_MAPPINGS));
});

test('configured fields cannot silently disappear when a portal changes its headers', () => {
  assert.throws(() => recordsFromCells(['Code'], [['SYNTHETIC']], { Code: 'caseCode', Due: 'dueAt' }), /thiếu cột/);
  assert.deepEqual(recordsFromCells(['Code'], [['SYNTHETIC']], { Code: 'caseCode', 'Alternative code': 'caseCode' })[0].record,
    { caseCode: 'SYNTHETIC' });
});

test('each ministry reads its own configured table and rejects another source URL', () => {
  for (const source of SOURCES) {
    const config = { ...syntheticConfig(), sourceSystem: source.id, listUrl: `https://${source.hostname}/synthetic-test-list` };
    const adapter = adapterForHost(source.hostname, { [source.id]: config });
    const result = adapter.extractCases(syntheticDocument({ rows: [['SYNTHETIC-ALL', '11/10/2026 09:00:00', 'Đang xử lý', 'ignored']] }), config.listUrl);
    assert.equal(result.records.length, 1, source.id);
    assert.equal(result.records[0].sourceSystem, source.id);
    assert.equal(result.records[0].normalizedStatus, 'PROCESSING');
    assert.throws(() => adapter.extractCases(syntheticDocument(), 'https://example.com/synthetic-test-list'));
  }
});

test('adapters fail closed without evidence, matching list page and independent login marker', () => {
  const adapter = adapterForHost('motcua.tphcm.gov.vn');
  assert.throws(() => adapter.extractCases(syntheticDocument(), 'https://motcua.tphcm.gov.vn/synthetic-test-list'));
  const verified = new SourceAdapter('TPHCM', syntheticConfig());
  assert.throws(() => verified.extractCases(syntheticDocument({ authenticated: false }), syntheticConfig().listUrl), /đăng nhập/);
  assert.throws(() => verified.extractCases(syntheticDocument(), 'https://motcua.tphcm.gov.vn/wrong-list'), /URL/);
  assert.throws(() => validateAdapterConfig({ ...syntheticConfig(), token: 'secret' }, 'TPHCM'));
  assert.throws(() => validateAdapterConfig({ ...syntheticConfig(), verified: false }, 'TPHCM'));
  assert.throws(() => validateAdapterConfig({ ...syntheticConfig(), listUrl: 'https://attacker.example/' }, 'TPHCM'));
});

test('verified synthetic TABLE rows validate independently and never use countdown', () => {
  const adapter = new SourceAdapter('TPHCM', syntheticConfig());
  const result = adapter.extractCases(syntheticDocument({ rows: [
    ['SYNTHETIC-005', '08/10/2026 09:04:34', 'Đang xử lý', 'Còn 999 ngày'],
    ['SYNTHETIC-006', '08/10/2026', 'Đang xử lý', 'Còn 3 ngày'],
  ] }), syntheticConfig().listUrl);
  assert.equal(result.total, 2); assert.equal(result.records.length, 1); assert.equal(result.errors.length, 1);
  assert.equal(result.records[0].dueAt, '2026-10-08T02:04:34.000Z');
  assert.equal(result.scope, 'CURRENT_PAGE_ONLY');
});

test('central origins reject portal credentials, URL paths and nonlocal HTTP', () => {
  assert.equal(normalizeCentralUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.equal(normalizeCentralUrl('https://central.example/'), 'https://central.example');
  for (const url of ['http://central.example', 'https://user:secret@central.example', 'https://central.example/api', 'https://central.example?token=secret']) assert.throws(() => normalizeCentralUrl(url));
  assert.deepEqual(chunks(Array.from({ length: 205 }, (_, index) => index)).map(batch => batch.length), [100, 100, 5]);
});

test('batch retries retain identity, exclude cookies, forbid redirects and back off', async () => {
  const requests = [], delays = [];
  const result = await sendBatch({ centralUrl: 'https://central.example', token: 'synthetic-collector-token', sourceSystem: 'MOC',
    records: [{ caseCode: 'SYNTHETIC-007' }], batchId: 'synthetic-job:0' }, {
    sleep: async delay => { delays.push(delay); },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ id: 'synthetic', total: 1, created: 1, updated: 0, skipped: 0, failed: 0, errors: [] }) };
    },
  });
  assert.equal(result.created, 1); assert.deepEqual(delays, [500]);
  assert.equal(requests[0].options.body, requests[1].options.body);
  assert.equal(JSON.parse(requests[0].options.body).batchId, 'synthetic-job:0');
  assert.equal(requests[0].options.credentials, 'omit'); assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer synthetic-collector-token');
});

test('authentication errors do not retry and request timeout aborts transport', async () => {
  let calls = 0;
  const request = { centralUrl: 'https://central.example', token: 'synthetic-collector-token', sourceSystem: 'MOC', records: [], batchId: 'synthetic:0' };
  await assert.rejects(sendBatch(request, { fetchImpl: async () => { calls++; return { ok: false, status: 401 }; } }), /token/);
  assert.equal(calls, 1);
  await assert.rejects(sendBatch(request, { retries: 0, timeoutMs: 5, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
  }) }), /thời gian chờ/);
});

test('generated MV3 manifest keeps exact host boundaries and isolated script', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert.equal(manifest.host_permissions.length, 15);
  assert.ok(!manifest.host_permissions.some(value => value.includes('<all_urls>') || value.includes('://*')));
  assert.ok(!(manifest.optional_host_permissions ?? []).some(value => value.includes('<all_urls>') || value.includes('://*')));
  assert.ok(!manifest.permissions.includes('cookies'));
  assert.equal(manifest.web_accessible_resources, undefined);
});

test('generated isolated content bundle registers safely and refuses nonextension sender', async () => {
  let listener;
  let registrations = 0;
  const chrome = { runtime: { id: 'synthetic-extension-id', onMessage: { addListener: callback => { listener = callback; registrations++; } } } };
  const bundle = await readFile(new URL('../extension/content/collector.js', import.meta.url), 'utf8');
  const context = vm.createContext({ chrome, URL, location: { hostname: 'motcua.tphcm.gov.vn', protocol: 'https:' } });
  vm.runInContext(bundle, context);
  vm.runInContext(bundle, context);
  assert.equal(registrations, 1, 'reinjection must not duplicate the collector listener');
  assert.equal(typeof listener, 'function');
  let replied = false;
  assert.equal(listener({ type: 'COLLECT_VERIFIED_TABLE' }, { id: 'attacker-extension', url: 'https://attacker.example' }, () => { replied = true; }), false);
  assert.equal(replied, false);
});

test('worker rejects portal and untrusted sender commands; token stays private in state response', async () => {
  let listener;
  const access = [];
  const sessionState = { collectorToken: 'SYNTHETIC-PRIVATE-TOKEN', syncJob: { status: 'SYNC_ERROR', centralUrl: 'https://central.example', batches: [[{ caseCode: 'SYNTHETIC-RETRY' }]] } };
  const fakeArea = state => ({ setAccessLevel: async ({ accessLevel }) => { access.push(accessLevel); },
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in state).map(key => [key, state[key]])),
    set: async value => Object.assign(state, value), remove: async key => { delete state[key]; } });
  const chrome = { runtime: { id: 'synthetic-extension-id', getURL: path => `chrome-extension://synthetic-extension-id/${path}`,
    onMessage: { addListener: callback => { listener = callback; } } },
  storage: { local: fakeArea({ centralUrl: 'https://central.example' }), session: fakeArea(sessionState) },
  permissions: { contains: async () => true },
  alarms: { onAlarm: { addListener: () => {} }, clear: async () => true }, tabs: {} };
  const previous = globalThis.chrome;
  globalThis.chrome = chrome;
  try {
    await import('../extension/background/service-worker.mjs?synthetic-worker-security-test');
    assert.equal(listener({ type: 'GET_STATE' }, { id: chrome.runtime.id, tab: { id: 1 }, url: 'https://motcua.tphcm.gov.vn/' }, () => assert.fail('Portal must not receive state')), false);
    assert.equal(listener({ type: 'GET_STATE' }, { id: 'attacker', url: chrome.runtime.getURL('popup/index.html') }, () => assert.fail('Other extension must not receive state')), false);
    const response = await new Promise(resolve => {
      assert.equal(listener({ type: 'GET_STATE' }, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/index.html') }, resolve), true);
    });
    assert.equal(response.hasCollectorToken, true);
    assert.equal(JSON.stringify(response).includes('SYNTHETIC-PRIVATE-TOKEN'), false);
    assert.equal(JSON.stringify(response).includes('SYNTHETIC-RETRY'), false);
    assert.deepEqual(access, ['TRUSTED_CONTEXTS', 'TRUSTED_CONTEXTS']);
    const trusted = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/index.html') };
    const changed = await new Promise(resolve => listener({ type: 'SAVE_CENTRAL', centralUrl: 'https://another-central.example', token: 'SYNTHETIC-NEW-TOKEN' }, trusted, resolve));
    assert.equal(changed.ok, false);
    assert.equal(sessionState.collectorToken, 'SYNTHETIC-PRIVATE-TOKEN');
    const refreshed = await new Promise(resolve => listener({ type: 'SAVE_CENTRAL', centralUrl: 'https://central.example', token: 'SYNTHETIC-NEW-TOKEN' }, trusted, resolve));
    assert.equal(refreshed.ok, true);
    assert.equal(sessionState.collectorToken, 'SYNTHETIC-NEW-TOKEN');
  } finally { if (previous === undefined) delete globalThis.chrome; else globalThis.chrome = previous; }
});
