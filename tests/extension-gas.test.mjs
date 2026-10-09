import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SOURCES, sourceByHostname } from '../extension/adapters/source-registry.mjs';
import { adapterForHost } from '../extension/adapters/registry.mjs';
import { SourceAdapter, validateAdapterConfig } from '../extension/adapters/base.mjs';
import { normalizeCollectorCase } from '../extension/normalizer/case-normalizer.mjs';
import { hostPermission, normalizeCentralUrl, sendBatch } from '../extension/api/sync.mjs';

// All DOM and network fixtures below are synthetic and do not certify portal integrations.
const endpoint = 'https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT_ID/exec';
const token = 'SYNTHETIC-OPAQUE-COLLECTOR-TOKEN';
const record = () => ({ caseCode: 'SYNTHETIC-GAS-001', sourceStatus: 'Synthetic processing',
  lastObservedAt: new Date().toISOString() });
const request = () => ({ centralUrl: endpoint, token, sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn',
  cases: [record()], batchId: 'synthetic:0' });
const result = () => ({ total: 1, created: 1, updated: 0, skipped: 0, failed: 0, errors: [] });
const config = () => ({ sourceSystem: 'TPHCM', verified: true,
  evidence: { reference: 'SYNTHETIC TEST ONLY, NOT REAL PORTAL EVIDENCE', verifiedAt: new Date().toISOString() },
  listUrl: 'https://motcua.tphcm.gov.vn/synthetic-list', loggedInSelector: '#synthetic-login',
  tableSelector: '#synthetic-table', headerSelector: '.synthetic-headers', rowSelector: '.synthetic-rows',
  cellSelector: '.synthetic-cells', headerMappings: { 'Synthetic code': 'caseCode' }, statusMappings: {} });
const node = (tagName, textContent) => ({ tagName, textContent, hidden: false,
  getAttribute: () => null, getClientRects: () => [{}] });

test('eleven source adapters preserve exact Ministry of Construction hosts and await real samples', () => {
  assert.equal(SOURCES.length, 11);
  assert.equal(new Set(SOURCES.map(source => source.hostname)).size, 11);
  const moc = SOURCES.find(source => source.id === 'MOC');
  assert.equal(moc.hostname, 'motcuabxd.moc.gov.vn');
  assert.equal(moc.url, 'https://motcuabxd.moc.gov.vn/vi/dossier/search');
  assert.deepEqual(moc.supportedHosts, ['motcuabxd.moc.gov.vn', 'motcua.moc.gov.vn']);
  for (const hostname of moc.supportedHosts) {
    assert.equal(sourceByHostname(hostname), moc);
    assert.equal(adapterForHost(hostname).getSourceId(), 'MOC');
  }
  for (const hostname of ['motcuabxd.moc.gov.vn.attacker.example', 'evil.motcuabxd.moc.gov.vn',
    'motcua.moc.gov.vn.attacker.example', 'evil.motcua.moc.gov.vn', 'motcuabxd.moc.gov.vn:443']) {
    assert.equal(sourceByHostname(hostname), null);
  }
  assert.equal(sourceByHostname('motcua.tphcm.gov.vn.attacker.example'), null);
  assert.equal(new Set(SOURCES.flatMap(source => source.supportedHosts)).size, 12);
  for (const source of SOURCES) {
    assert.equal(source.adapterStatus, 'WAITING_FOR_SAMPLE');
    assert.equal(source.supportedHosts.length, source.id === 'MOC' ? 2 : 1);
    assert.equal(adapterForHost(source.hostname).constructor.name, source.adapter);
    assert.throws(() => adapterForHost(source.hostname).extractCases({}, source.url));
  }
});

test('synthetic MOC adapter configuration permits the supplied list URL without widening host boundaries', () => {
  const mocConfig = { ...config(), sourceSystem: 'MOC', listUrl: 'https://motcuabxd.moc.gov.vn/vi/dossier/search' };
  assert.equal(validateAdapterConfig(mocConfig, 'MOC').listUrl, mocConfig.listUrl);
  assert.equal(validateAdapterConfig({ ...mocConfig, listUrl: 'https://motcua.moc.gov.vn/vi/dossier/search' }, 'MOC').sourceSystem, 'MOC');
  for (const listUrl of ['https://motcuabxd.moc.gov.vn.attacker.example/vi/dossier/search',
    'https://evil.motcuabxd.moc.gov.vn/vi/dossier/search', 'https://motcua.tphcm.gov.vn/vi/dossier/search',
    'http://motcuabxd.moc.gov.vn/vi/dossier/search', 'https://user:secret@motcuabxd.moc.gov.vn/vi/dossier/search']) {
    assert.throws(() => validateAdapterConfig({ ...mocConfig, listUrl }, 'MOC'));
  }
});

test('collector normalization rejects PII, metadata, derived fields and ambiguous datetimes', () => {
  for (const forbidden of ['applicantName', 'citizenId', 'phone', 'address', 'attachments', 'metadata',
    'sourceUrl', 'password', 'cookie', 'token', 'riskScore', 'lastSyncedAt', 'remainingSeconds']) {
    assert.throws(() => normalizeCollectorCase({ ...record(), [forbidden]: 'sensitive' }, 'TPHCM'));
  }
  for (const dueAt of ['2026-10-08', '2026-10-08T09:04:34', '31/02/2026 09:04:34']) {
    assert.throws(() => normalizeCollectorCase({ ...record(), dueAt }, 'TPHCM'));
  }
  assert.throws(() => normalizeCollectorCase({ ...record(), lastObservedAt: null }, 'TPHCM'));
  assert.throws(() => normalizeCollectorCase({ ...record(), lastObservedAt: new Date(Date.now() + 600000).toISOString() }, 'TPHCM'));
  assert.throws(() => normalizeCollectorCase({ ...record(), sourceSystem: 'MOC' }, 'TPHCM'));
  assert.throws(() => normalizeCollectorCase({ ...record(), currentStep: 3, totalSteps: 2 }, 'TPHCM'));
  assert.throws(() => normalizeCollectorCase({ ...record(), normalizedStatus: 'BAD' }, 'TPHCM'));
  assert.throws(() => normalizeCollectorCase({ ...record(), sourceStatus: null, normalizedStatus: 'BAD' }, 'TPHCM'));
});

test('status preview uses verified configuration and official dates use UTC+07', () => {
  const normalized = normalizeCollectorCase({ ...record(), dueAt: '08/10/2026 09:04:34' }, 'TPHCM',
    { statusMappings: { 'Synthetic processing': 'PROCESSING' } });
  assert.equal(normalized.normalizedStatus, 'PROCESSING');
  assert.equal(normalized.dueAt, '2026-10-08T02:04:34.000Z');
  assert.equal(normalizeCollectorCase(record(), 'TPHCM', { statusMappings: {} }).normalizedStatus, 'UNKNOWN');
  assert.equal(normalizeCollectorCase(normalized, 'TPHCM').normalizedStatus, 'PROCESSING');
  assert.throws(() => normalizeCollectorCase({ ...record(), extensionDueAt: '08/10/2026 09:04:34' }, 'TPHCM'));
  assert.throws(() => normalizeCollectorCase({ ...record(), dueAt: '08/10/2026 09:04:34',
    effectiveDueAt: '09/10/2026 09:04:34' }, 'TPHCM'));
});

test('configured TABLE extractor never reads unmapped applicant cell content', () => {
  let piiReads = 0;
  const pii = node('TD');
  Object.defineProperty(pii, 'textContent', { get() { piiReads++; return 'PRIVATE APPLICANT'; } });
  const cells = [node('TD', 'SYNTHETIC-PRIVATE-TEST'), pii];
  const row = { ...node('TR'), querySelectorAll: () => cells };
  const table = { ...node('TABLE'), querySelectorAll: selector => selector === '.synthetic-headers'
    ? [node('TH', 'Synthetic code'), node('TH', 'Applicant identity')] : [row] };
  const document = { querySelector: selector => selector === '#synthetic-login' ? node('SPAN') : table };
  const output = new SourceAdapter('TPHCM', config()).extractCases(document, config().listUrl);
  assert.equal(output.records.length, 1);
  assert.equal(piiReads, 0);
  assert.equal(output.records[0].caseCode, 'SYNTHETIC-PRIVATE-TEST');
  assert.ok(output.records[0].lastObservedAt);
  assert.equal('metadata' in output.records[0], false);
  assert.throws(() => validateAdapterConfig({ ...config(), headerMappings: { code: 'caseCode', applicant: 'applicantName' } }, 'TPHCM'));
  assert.throws(() => validateAdapterConfig({ ...config(), headerMappings: undefined }, 'TPHCM'));
  assert.throws(() => validateAdapterConfig({ ...config(), evidence: { ...config().evidence, verifiedAt: '' } }, 'TPHCM'));
});

test('GAS endpoint parser accepts only exact deployed /exec and no credentials/query', () => {
  assert.equal(normalizeCentralUrl(endpoint), endpoint);
  assert.equal(hostPermission(endpoint), 'https://script.google.com/macros/s/*');
  for (const value of ['https://script.google.com/', endpoint.replace('/exec', '/dev'), `${endpoint}?token=x`,
    `${endpoint}#fragment`, endpoint.replace('https://', 'https://user:password@'),
    'https://script.googleusercontent.com/macros/echo', endpoint.replace('https:', 'http:')]) {
    assert.throws(() => normalizeCentralUrl(value));
  }
});

test('GAS transport posts scoped collector action, follows Google ContentService and omits cookies', async () => {
  let sent;
  const output = await sendBatch(request(), { fetchImpl: async (url, options) => {
    sent = { url, options };
    return { ok: true, url: 'https://script.googleusercontent.com/macros/echo?synthetic=result',
      json: async () => ({ ok: true, data: result() }) };
  } });
  assert.equal(output.created, 1);
  assert.equal(sent.url, endpoint);
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(sent.options.redirect, 'follow');
  assert.equal(sent.options.referrerPolicy, 'no-referrer');
  assert.equal(sent.options.headers.Authorization, undefined);
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(Object.keys(body), ['action', 'token', 'sourceSystem', 'hostname', 'cases', 'batchId']);
  assert.equal(body.action, 'collector.sync');
  assert.equal(body.token, token);
  assert.equal(body.hostname, 'motcua.tphcm.gov.vn');
  assert.equal(body.cases.length, 1);
  assert.equal('records' in body, false);
});

test('GAS transport retains the exact canonical or legacy MOC hostname in the sync payload', async () => {
  for (const hostname of ['motcuabxd.moc.gov.vn', 'motcua.moc.gov.vn']) {
    let body;
    const output = await sendBatch({ ...request(), sourceSystem: 'MOC', hostname }, { fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, url: endpoint, json: async () => ({ ok: true, data: result() }) };
    } });
    assert.equal(output.created, 1);
    assert.equal(body.sourceSystem, 'MOC');
    assert.equal(body.hostname, hostname);
    assert.equal(body.cases[0].sourceSystem, 'MOC');
  }
  for (const hostname of ['motcuabxd.moc.gov.vn.attacker.example', 'evil.motcuabxd.moc.gov.vn', 'motcua.tphcm.gov.vn']) {
    let calls = 0;
    await assert.rejects(sendBatch({ ...request(), sourceSystem: 'MOC', hostname }, { fetchImpl: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test('worker sends the active MOC tab hostname for canonical and legacy token bindings', async () => {
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  try {
    for (const hostname of ['motcuabxd.moc.gov.vn', 'motcua.moc.gov.vn']) {
      let listener, sent, finish;
      const completed = new Promise(resolve => { finish = resolve; });
      const session = { collectorToken: token };
      const local = { centralUrl: endpoint, configurations: { MOC: { ...config(), sourceSystem: 'MOC',
        listUrl: `https://${hostname}/vi/dossier/search` } } };
      const area = state => ({ setAccessLevel: async () => {},
        get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in state).map(key => [key, state[key]])),
        set: async value => { Object.assign(state, value); if (value.syncJob?.status !== 'SYNCING' && value.syncJob) finish(); },
        remove: async key => { delete state[key]; } });
      const chrome = { runtime: { id: 'synthetic-moc-worker', getURL: path => `chrome-extension://synthetic-moc-worker/${path}`,
        onMessage: { addListener: callback => { listener = callback; } } },
      storage: { local: area(local), session: area(session) }, permissions: { contains: async () => true },
      alarms: { onAlarm: { addListener: () => {} }, clear: async () => true, create: async () => {} },
      tabs: { get: async id => ({ id, active: true, url: `https://${hostname}/vi/dossier/search` }),
        sendMessage: async () => ({ ok: true, sourceSystem: 'MOC', records: [record()], errors: [], total: 1 }) } };
      globalThis.chrome = chrome;
      globalThis.fetch = async (url, options) => { sent = JSON.parse(options.body);
        return { ok: true, url: endpoint, json: async () => ({ ok: true, data: result() }) }; };
      await import(`../extension/background/service-worker.mjs?synthetic-moc-host-${hostname}`);
      const response = await new Promise(resolve => {
        assert.equal(listener({ type: 'START_SYNC', tabId: 7 }, { id: chrome.runtime.id, url: chrome.runtime.getURL('popup/index.html') }, resolve), true);
      });
      assert.equal(response.ok, true);
      let timer;
      try { await Promise.race([completed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Worker sync did not finish')), 1000); })]); }
      finally { clearTimeout(timer); }
      assert.equal(session.syncJob.status, 'SYNC_SUCCESS');
      assert.equal(session.syncJob.hostname, hostname);
      assert.equal(sent.hostname, hostname);
      assert.equal(sent.sourceSystem, 'MOC');
    }
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});

test('GAS errors and unexpected redirect endpoints fail without retries or token reflection', async () => {
  for (const url of ['https://attacker.example/result', 'https://script.googleusercontent.com.attacker.example/result',
    endpoint.replace('SYNTHETIC_DEPLOYMENT_ID', 'OTHER_DEPLOYMENT_ID')]) {
    let calls = 0;
    await assert.rejects(sendBatch(request(), { fetchImpl: async () => {
      calls++; return { ok: true, url, json: async () => ({ ok: true, data: result() }) };
    } }), /Redirect/);
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(sendBatch(request(), { fetchImpl: async () => {
    calls++; return { ok: true, url: endpoint, json: async () => ({ ok: false,
      error: { code: 'TOKEN_INVALID', message: `Must not reflect ${token}` } }) };
  } }), error => /token/.test(error.message) && !error.message.includes(token));
  assert.equal(calls, 1);
});

test('GAS source/hostname, Google token and forbidden case fields are rejected before transport', async () => {
  const overrides = [{ hostname: 'motcua.tphcm.gov.vn.attacker.example' }, { token: 'ya29.do-not-use-google-access-token' },
    { token: 'eyJ.not-a-collector-token' }, { cases: [{ ...record(), applicantName: 'PRIVATE' }] }];
  for (const override of overrides) {
    let calls = 0;
    await assert.rejects(sendBatch({ ...request(), ...override }, { fetchImpl: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test('default manifest restricts requests and read scripts to twelve exact hosts for eleven sources plus Google service', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.content_scripts[0].matches, SOURCES.flatMap(source => source.supportedHosts.map(hostname => `https://${hostname}/*`)));
  assert.deepEqual(manifest.host_permissions, [...manifest.content_scripts[0].matches,
    'https://script.google.com/macros/s/*', 'https://script.googleusercontent.com/*']);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.match(manifest.content_security_policy.extension_pages,
    /connect-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com;/);
  for (const forbidden of ['cookies', 'history', 'proxy', 'management', 'webRequest']) assert.ok(!manifest.permissions.includes(forbidden));
});
