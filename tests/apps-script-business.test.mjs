import test from 'node:test';
import assert from 'node:assert/strict';
import { runInContext } from 'node:vm';
import { gasRuntime } from './helpers/apps-script.mjs';

const MODULES = ['Utils','Crypto','Passwords','SheetRepository','Settings','Audit','Permissions','Users','Sources','Deadline','Cases','Alerts','Dashboard','Reports','Auth','Router','Code','Setup'];
const ALL = { sources: ['*'], agencies: ['*'], departments: ['*'], officers: ['*'] };
const iso = offset => new Date(Date.now() + offset * 3600000).toISOString();
test('latest complete MOC read replaces visible membership atomically without accumulating old alerts', () => {
  const gas = harness();
  const token = gas.evaluate(`TTHC.Auth.createCollector(${gas.actor()},{sourceSystem:'MOC',hostname:'motcuabxd.moc.gov.vn'})`).token;
  const payload = (id, codes, offset) => ({ action: 'collector.sync', sourceSystem: 'MOC', hostname: 'motcuabxd.moc.gov.vn', token, batchId: id, replaceSource: true,
    collectionContext: { submittedFrom: null, submittedTo: null, capturedAt: iso(offset), basis: 'VISIBLE_FILTERS', scope: 'CURRENT_PAGE_ONLY' },
    cases: codes.map(code => record(code, { sourceSystem: 'MOC', sourceStatus: 'Đang xử lý', lastObservedAt: iso(offset) })) });
  const first = payload('snapshot-first', ['OLD', 'KEEP'], -3);
  gas.run('Cases', 'sync', first);
  const list = () => gas.evaluate(`TTHC.Cases.list(${gas.actor()},{sourceSystem:'MOC'})`);
  const oldId = list().items.find(row => row.caseCode === 'OLD').id;
  gas.sync(gas.issue().token, [record('OTHER-SOURCE')]);
  gas.run('Cases', 'sync', payload('snapshot-second', ['KEEP','NEW'], -2));
  assert.deepEqual(list().items.map(row => row.caseCode).sort(), ['KEEP','NEW']);
  assert.equal(gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{sourceSystem:'MOC'})`).kpis.total, 2);
  assert.equal(gas.evaluate(`TTHC.Cases.list(${gas.actor()},{sourceSystem:'TPHCM'})`).total, 1);
  assert.ok(gas.evaluate(`TTHC.Alerts.list(${gas.actor()},{sourceSystem:'MOC'})`).items.every(row => row.caseCode !== 'OLD'));
  assert.throws(() => gas.evaluate(`TTHC.Cases.detail(${gas.actor()},{id:${JSON.stringify(oldId)}})`));
  assert.equal(gas.run('Cases', 'sync', first).duplicateBatch, true);
  assert.deepEqual(list().items.map(row => row.caseCode).sort(), ['KEEP','NEW']);
  const broken = payload('snapshot-broken', ['NEW','BAD'], -1); broken.cases[1].caseCode = '';
  assert.throws(() => gas.run('Cases','sync',broken));
  assert.deepEqual(list().items.map(row => row.caseCode).sort(), ['KEEP','NEW']);
  assert.throws(() => gas.run('Cases','sync',payload('snapshot-stale',['OLD'],-4)));
  assert.throws(() => gas.run('Cases','sync',payload('snapshot-empty',[],-1)));
  assert.throws(() => gas.run('Cases','sync',payload('snapshot-duplicate',['NEW','NEW'],-1)));
});
test('submitted date filters use Vietnam full-day boundaries consistently for dashboard and cases', () => {
  const gas = harness(), token = gas.issue().token;
  gas.sync(token, [
    record('BEFORE', { submittedAt: '2026-10-01T16:59:59.999Z' }),
    record('START', { submittedAt: '2026-10-01T17:00:00.000Z' }),
    record('END', { submittedAt: '2026-10-02T16:59:59.999Z' }),
    record('AFTER', { submittedAt: '2026-10-02T17:00:00.000Z' }),
    record('MISSING'),
  ]);
  const query = { submittedFrom: '2026-10-02', submittedTo: '2026-10-02' };
  const list = q => gas.evaluate(`TTHC.Cases.list(${gas.actor()},${JSON.stringify(q)})`);
  const dashboard = q => gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},${JSON.stringify(q)})`);
  assert.deepEqual(list(query).items.map(row => row.caseCode).sort(), ['END','START']);
  assert.equal(dashboard(query).kpis.total, 2);
  assert.equal(dashboard(query).bySource[0].total, 2);
  assert.equal(dashboard({ submittedFrom: '2026-10-03' }).kpis.total, 1);
  assert.equal(list({ submittedTo: '2026-10-01' }).total, 1);
  assert.equal(list({}).total, 5);
  assert.throws(() => dashboard({ submittedFrom: '2026-10-03', submittedTo: '2026-10-02' }));
  assert.throws(() => list({ submittedFrom: '2026-02-31' }));
});
test('collection range persists per batch and per case; older batches remain explicit unknown', () => {
  const gas = harness(), token = gas.issue().token;
  const context = { submittedFrom: '2026-10-01', submittedTo: '2026-10-12', capturedAt: iso(-1), scope: 'CURRENT_PAGE_ONLY', basis: 'VISIBLE_FILTERS' };
  const payload = { action: 'collector.sync', token, sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn', cases: [record('RANGE')], batchId: 'range-test', collectionContext: context };
  const saved = gas.run('Cases', 'sync', payload);
  assert.equal(saved.created, 1);
  const logs = () => gas.evaluate(`TTHC.Sources.syncList(${gas.actor()},{})`).items;
  assert.deepEqual(logs()[0].collectionContext, context);
  assert.deepEqual(gas.evaluate(`TTHC.Cases.list(${gas.actor()},{})`).items[0].lastCollectionContext, context);
  assert.equal(gas.run('Cases', 'sync', payload).duplicateBatch, true);
  assert.equal(logs().length, 1);
  for (const bad of [{ ...context, submittedTo: '2026-02-31' }, { ...context, submittedFrom: '2026-11-01' }, { ...context, extra: 'private' }]) {
    assert.throws(() => gas.run('Cases', 'sync', { ...payload, batchId: 'bad-context', collectionContext: bad }));
  }
  gas.sync(token, [record('LEGACY')], 'legacy-range');
  assert.equal(logs().find(row => row.batchId === 'legacy-range').collectionContext, null);
  const later = { ...context, submittedTo: '2026-10-13', capturedAt: iso(0) };
  gas.run('Cases', 'sync', { ...payload, cases: [record('RANGE', { lastObservedAt: iso(0) })], batchId: 'range-next', collectionContext: later });
  assert.deepEqual(logs().find(row => row.batchId === 'range-test').collectionContext, context);
  assert.deepEqual(logs().find(row => row.batchId === 'range-next').collectionContext, later);
});
const record = (code = 'MONITOR-01', extra = {}) => ({ sourceSystem: 'TPHCM', caseCode: code, sourceRecordId: 'source-' + code, procedureName: 'Thủ tục giám sát', agencyName: 'Đơn vị A', departmentName: 'Phòng A', officerName: 'Cán bộ A', sourceStatus: extra.normalizedStatus || 'PROCESSING', normalizedStatus: 'PROCESSING', originalDueAt: iso(24), receivedAt: iso(-72), lastObservedAt: iso(-1), ...extra });
function harness() {
  const gas = gasRuntime(MODULES);
  gas.evaluate = source => gas.plain(runInContext(source, gas.context));
  gas.evaluate('setupTthcMonitor_()');
  const setup = gas.evaluate('bootstrapAdmin_()'); gas.adminId = setup.userId;
  // Explicitly synthetic, confirmed mappings used by these fixtures only.
  gas.evaluate(`TTHC.Repo.writeBatch('STATUS_MAPPING',${JSON.stringify(['PROCESSING','COMPLETED','WAITING_ADDITIONAL_DOCUMENTS'].map(status => ({ mapping_id: 'synthetic-'+status, source_id: 'TPHCM', source_status: status, normalized_status: status, confirmed: true, updated_at: iso(0) })))},'mapping_id')`);
  gas.actor = () => `TTHC.Users.authorize(${JSON.stringify(gas.adminId)})`;
  gas.run = (module, method, ...args) => gas.evaluate(`TTHC.${module}.${method}(${args.map(value => JSON.stringify(value)).join(',')})`);
  login(gas);
  gas.createUser = value => gas.evaluate(`TTHC.Users.create(${gas.actor()},${JSON.stringify(value)})`).user;
  gas.issue = () => gas.evaluate(`TTHC.Auth.createCollector(${gas.actor()},{sourceSystem:'TPHCM',hostname:'motcua.tphcm.gov.vn'})`);
  gas.sync = (token, cases, batchId = crypto.randomUUID()) => gas.run('Cases', 'sync', { action: 'collector.sync', token, sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn', cases, batchId });
  return gas;
}
function login(gas, username = 'admin') {
  const password = gas.passwords?.[username] || gas.properties.get(username === 'admin' ? 'BOOTSTRAP_PASSWORD' : 'DEFAULT_USER_PASSWORD');
  let result = gas.run('Auth', 'login', { username, password });
  if (result.mustChangePassword) {
    const newPassword = 'SYNTHETIC-changed-' + username + '-2026!';
    result = gas.app.Router.rpc('auth.changePassword', { currentPassword: password, newPassword }, result.sessionToken);
    assert.equal(result.ok, true);
    gas.passwords ||= {}; gas.passwords[username] = newPassword;
    return gas.plain(result.data);
  }
  return result;
}

test('GAS MOC source uses the supplied list URL and only its canonical and legacy exact hostnames', () => {
  const gas = harness(), sources = gas.run('Sources', 'definitions'), source = gas.run('Sources', 'find', 'MOC');
  assert.equal(sources.length, 11);
  assert.equal(source.hostname, 'motcuabxd.moc.gov.vn');
  assert.equal(source.url, 'https://motcuabxd.moc.gov.vn/vi/dossier/search');
  assert.deepEqual(source.supportedHosts, ['motcuabxd.moc.gov.vn', 'motcua.moc.gov.vn']);
  for (const hostname of source.supportedHosts) {
    assert.equal(gas.evaluate(`TTHC.Sources.validateHost(${JSON.stringify(source)},${JSON.stringify(hostname)});true`), true);
  }
  for (const hostname of ['motcuabxd.moc.gov.vn.attacker.example', 'evil.motcuabxd.moc.gov.vn',
    'motcua.moc.gov.vn.attacker.example', 'motcua.tphcm.gov.vn', 'motcuabxd.moc.gov.vn:443']) {
    assert.throws(() => gas.run('Sources', 'validateHost', source, hostname), { code: 'VALIDATION_ERROR' });
  }
});

test('GAS MOC collector tokens accept both supported hosts while remaining bound to the exact issued hostname', () => {
  const gas = harness();
  for (const hostname of ['motcuabxd.moc.gov.vn', 'motcua.moc.gov.vn']) {
    const token = gas.evaluate(`TTHC.Auth.createCollector(${gas.actor()},${JSON.stringify({ sourceSystem: 'MOC', hostname })})`);
    assert.equal(token.hostname, hostname);
    const payload = { action: 'collector.sync', token: token.token, sourceSystem: 'MOC', hostname,
      replaceSource: true, collectionContext: { submittedFrom: null, submittedTo: null, capturedAt: new Date().toISOString(), basis: 'VISIBLE_FILTERS', scope: 'CURRENT_PAGE_ONLY' },
      cases: [record('MOC-' + hostname, { sourceSystem: 'MOC' })], batchId: crypto.randomUUID() };
    assert.equal(gas.run('Cases', 'sync', payload).created, 1);
    assert.throws(() => gas.run('Cases', 'sync', { ...payload, hostname: hostname === 'motcuabxd.moc.gov.vn' ? 'motcua.moc.gov.vn' : 'motcuabxd.moc.gov.vn', batchId: crypto.randomUUID() }), { code: 'TOKEN_INVALID' });
    assert.throws(() => gas.run('Cases', 'sync', { ...payload, hostname: 'motcuabxd.moc.gov.vn.attacker.example', batchId: crypto.randomUUID() }));
  }
  assert.equal(gas.app.Repo.read('CASES').length, 2);
  assert.throws(() => gas.evaluate(`TTHC.Auth.createCollector(${gas.actor()},{sourceSystem:'MOC',hostname:'evil.motcuabxd.moc.gov.vn'})`), { code: 'VALIDATION_ERROR' });
});

test('GAS official deadline boundaries, completion timing, withdrawn dates and unconfirmed extensions', () => {
  const gas = harness(), now = Date.parse('2026-10-06T00:00:00Z'), rule = { warningSeconds: 172800, staleSeconds: 86400 };
  const evaluate = item => gas.run('Deadline', 'evaluate', item, rule, now);
  const base = { normalizedStatus: 'PROCESSING', originalDueAt: '2026-10-08T00:00:00Z' };
  assert.equal(evaluate(base).alertLevel, 'WARNING');
  assert.equal(evaluate({ ...base, originalDueAt: '2026-10-08T00:00:00.001Z' }).alertLevel, 'SAFE');
  assert.equal(evaluate({ ...base, originalDueAt: '2026-10-06T00:00:00.500Z' }).isOverdue, false);
  assert.equal(evaluate({ ...base, originalDueAt: '2026-10-06T00:00:00Z' }).alertLevel, 'OVERDUE');
  assert.equal(evaluate({ ...base, originalDueAt: '2026-10-05T23:59:59Z' }).overdueSeconds, 1);
  assert.equal(evaluate({ ...base, normalizedStatus: 'COMPLETED', completedAt: base.originalDueAt }).completionResult, 'ON_TIME');
  assert.equal(evaluate({ ...base, normalizedStatus: 'COMPLETED', completedAt: '2026-10-08T00:00:01Z' }).completionResult, 'LATE');
  assert.equal(evaluate({ ...base, dueAt: null }).alertLevel, 'NEEDS_REVIEW');
  assert.equal(evaluate({ ...base, extensionDueAt: '2026-10-10T00:00:00Z' }).effectiveDueAt, base.originalDueAt);
  assert.equal(evaluate({ ...base, extensionDueAt: '2026-10-10T00:00:00Z', extensionConfirmed: true }).alertLevel, 'SAFE');
  assert.equal(evaluate({ ...base, normalizedStatus: 'PAUSED' }).needsReview, true);
});

test('GAS normalization rejects PII, impossible timestamps, forged extensions and unmapped labels', () => {
  const gas = harness(), input = record();
  assert.equal(gas.run('Cases', 'normalize', input, 'TPHCM', {}).sourceSystem, 'TPHCM');
  for (const bad of [{ ...input, applicantName: 'CITIZEN' }, { ...input, metadata: { cookie: 'SECRET' } }, { ...input, phone: '0123' }, { ...input, lastObservedAt: iso(1) }, { ...input, dueAt: '31/02/2026 07:00:00' }, { ...input, sourceSystem: 'MOF' }, { ...input, extensionDueAt: iso(80), extensionConfirmed: true }, { ...input, effectiveDueAt: iso(80) }]) assert.throws(() => gas.run('Cases', 'normalize', bad, 'TPHCM', {}));
  const unmapped = gas.run('Cases', 'normalize', { ...input, sourceStatus: 'Unknown source label', normalizedStatus: 'PROCESSING' }, 'TPHCM', {});
  assert.equal(unmapped.normalizedStatus, 'UNKNOWN');
  assert.equal(gas.run('Cases', 'normalize', { ...input, sourceStatus: 'Đang xử lý' }, 'TPHCM', { statusMappings: { 'Đang xử lý': 'PROCESSING' } }).normalizedStatus, 'PROCESSING');
});

test('GAS scopes use every dimension, explicit global grants and deny officer/admin escalation', () => {
  const gas = harness(), actor = { id: 'synthetic', status: 'ACTIVE', role: 'ADMIN', scope: { sources: ['TPHCM'], agencies: ['Đơn vị A'], departments: ['*'], officers: ['*'] } };
  assert.equal(gas.run('Permissions', 'hasAccess', actor, record()), true);
  assert.equal(gas.run('Permissions', 'hasAccess', actor, record('X', { agencyName: 'Đơn vị B' })), false);
  assert.equal(gas.run('Permissions', 'hasAccess', actor, record('X', { sourceSystem: 'MOF' })), false);
  assert.throws(() => gas.run('Permissions', 'validateScope', ALL, 'OFFICER'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => gas.run('Permissions', 'requireGrant', actor, { role: 'SUPER_ADMIN', scope: ALL }), { code: 'ACCESS_DENIED' });
  assert.throws(() => gas.run('Permissions', 'requireGrant', actor, { role: 'VIEWER', scope: ALL }), { code: 'ACCESS_DENIED' });
  assert.equal(gas.run('Permissions', 'capability', { ...actor, role: 'VIEWER' }, 'manageUsers'), false);
  assert.equal(gas.run('Permissions', 'capability', actor, 'manageSettings'), false);
});

test('GAS sessions and collector grants lose access immediately after USERS disable', () => {
  const gas = harness();
  const user = gas.createUser({ username: 'staff', displayName: 'Staff', role: 'MANAGER', scope: { ...ALL, sources: ['TPHCM'], agencies: ['Đơn vị A'] } });
  const session = login(gas, user.username), token = gas.evaluate(`TTHC.Auth.createCollector(TTHC.Users.authorize(${JSON.stringify(user.id)}),{sourceSystem:'TPHCM',hostname:'motcua.tphcm.gov.vn'})`);
  gas.evaluate(`TTHC.Users.update(${gas.actor()},${JSON.stringify({ id: user.id, displayName: 'Staff', role: user.role, scope: user.scope, status: 'DISABLED' })})`);
  assert.throws(() => gas.run('Auth', 'authenticate', session.sessionToken), { code: 'AUTH_REQUIRED' });
  assert.throws(() => gas.sync(token.token, [record()]), { code: 'TOKEN_INVALID' });
  const denied = gas.evaluate(`rpc('users.list',{},${JSON.stringify(session.sessionToken)})`);
  assert.equal(denied.ok, false); assert.equal(denied.error.code, 'AUTH_REQUIRED'); assert.ok(denied.error.requestId);
});

test('GAS corrupt/nonfinite expiration never grants cached sessions or collector access', () => {
  const gas = harness(), session = login(gas), token = gas.issue();
  const sessionKey = 'auth:session:' + gas.app.Crypto.hashLookupKey('session:' + session.sessionToken);
  gas.cache.put(sessionKey, JSON.stringify({ userId: gas.adminId, expiresAt: 'not-a-time' }), 3600);
  assert.throws(() => gas.run('Auth', 'authenticate', session.sessionToken), { code: 'AUTH_REQUIRED' });
  const row = gas.app.Repo.read('COLLECTOR_TOKENS')[0];
  gas.app.Repo.writeBatch('COLLECTOR_TOKENS', [{ ...row, expires_at: 'not-a-time' }], 'token_hash');
  assert.throws(() => gas.sync(token.token, [record()]), { code: 'TOKEN_INVALID' });
});

test('GAS collector upsert, durable aliases, repeated batches and older observations do not duplicate', () => {
  const gas = harness(), token = gas.issue();
  const first = gas.sync(token.token, [record()], 'synthetic-batch-1'); assert.equal(first.created, 1);
  const replay = gas.sync(token.token, [record()], 'synthetic-batch-1'); assert.equal(replay.duplicateBatch, true);
  const renamed = gas.sync(token.token, [record('RENAMED', { sourceRecordId: 'source-MONITOR-01', lastObservedAt: iso(0) })]); assert.equal(renamed.updated, 1);
  const oldAlias = gas.sync(token.token, [record('MONITOR-01', { sourceRecordId: undefined, lastObservedAt: iso(0) })]); assert.equal(oldAlias.updated, 1);
  const stale = gas.sync(token.token, [record('MONITOR-01', { lastObservedAt: iso(-8) })]); assert.equal(stale.skipped, 1);
  assert.equal(gas.app.Repo.read('CASES').length, 1);
  assert.ok(gas.calls.some(call => call.op === 'crypto'));
  assert.ok(gas.calls.filter(call => call.op === 'crypto').every(call => !call.locked));
  assert.ok(!gas.calls.some(call => call.op === 'kms'));
  assert.ok(!JSON.stringify(gas.sheets.get('CASES').rows).includes('MONITOR-01'));
});

test('GAS conflicting identities and invalid PII rows fail independently without corrupting valid cases', () => {
  const gas = harness(), token = gas.issue();
  const first = gas.sync(token.token, [record('A'), record('B')]); assert.equal(first.created, 2);
  const result = gas.sync(token.token, [record('A', { sourceRecordId: 'source-B' }), record('C'), { ...record('D'), applicantName: 'REJECTED CITIZEN' }]);
  assert.equal(result.created, 1); assert.equal(result.failed, 2); assert.equal(gas.app.Repo.read('CASES').length, 3);
  assert.equal(result.errors.length, 2); assert.ok(!JSON.stringify(result).includes('REJECTED CITIZEN'));
});

test('GAS case detail/list, indexed search and completion/freshness drilldowns preserve user scope', () => {
  const gas = harness(), token = gas.issue();
  gas.sync(token.token, [record('A'), record('B', { officerName: 'Cán bộ B', lastObservedAt: iso(-30) }), record('C', { normalizedStatus: 'COMPLETED', originalDueAt: iso(-4), completedAt: iso(-5) })]);
  const viewer = gas.createUser({ username: 'viewer', displayName: 'Viewer', role: 'VIEWER', scope: { ...ALL, sources: ['TPHCM'], officers: ['Cán bộ A'] } });
  const list = gas.evaluate(`TTHC.Cases.list(TTHC.Users.authorize(${JSON.stringify(viewer.id)}),{})`); assert.equal(list.total, 2);
  const outsider = gas.app.Repo.read('CASES').find(row => gas.app.Crypto.decrypt(row.payload_encrypted).caseCode === 'B');
  assert.throws(() => gas.evaluate(`TTHC.Cases.detail(TTHC.Users.authorize(${JSON.stringify(viewer.id)}),{id:${JSON.stringify(outsider.record_id)}})`), { code: 'NOT_FOUND' });
  const options = q => gas.evaluate(`TTHC.Cases.list(${gas.actor()},${JSON.stringify(q)})`);
  assert.equal(options({ q: 'giám' }).total, 3);
  assert.equal(options({ bucket: 'onTime' }).total, 1); assert.equal(options({ bucket: 'stale' }).total, 1); assert.equal(options({ bucket: 'observed24h' }).total, 1);
  assert.throws(() => options({ bucket: 'made-up' }), { code: 'VALIDATION_ERROR' });
});

test('GAS warning/overdue/stale alerts are current and acknowledgments require case scope', () => {
  const gas = harness(), token = gas.issue(); gas.sync(token.token, [record('A', { originalDueAt: iso(-1), lastObservedAt: iso(-30) }), record('B')]);
  const before = gas.evaluate(`TTHC.Alerts.list(${gas.actor()},{})`); assert.equal(before.total, 3);
  const overdue = before.items.find(item => item.kind === 'OVERDUE');
  gas.evaluate(`TTHC.Alerts.acknowledge(${gas.actor()},{id:${JSON.stringify(overdue.id)}})`);
  const after = gas.evaluate(`TTHC.Alerts.list(${gas.actor()},{kind:'OVERDUE'})`); assert.equal(after.items[0].status, 'ACKNOWLEDGED');
  const viewer = gas.createUser({ username: 'viewer', displayName: 'Viewer', role: 'VIEWER', scope: ALL });
  assert.throws(() => gas.evaluate(`TTHC.Alerts.acknowledge(TTHC.Users.authorize(${JSON.stringify(viewer.id)}),{id:${JSON.stringify(overdue.id)}})`), { code: 'ACCESS_DENIED' });
});

test('GAS dashboard encrypted cache avoids CASES scans on repeated opens and invalidates on sync', () => {
  const gas = harness(), token = gas.issue(); gas.sync(token.token, [record('A'), record('B', { lastObservedAt: iso(-30) })]);
  gas.clearCache();
  gas.calls.length = 0;
  const initial = gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{})`); assert.equal(initial.kpis.totalProcessing, 2); assert.equal(initial.kpis.observed24hRate, 50);
  assert.equal(gas.calls.filter(call => call.op === 'write').length, 0, 'Cold dashboard reads must never write Sheets');
  const original = gas.app.Repo.read; let scans = 0;
  gas.app.Repo.read = table => { if (table === 'CASES') scans++; return original(table); };
  assert.equal(gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{})`).kpis.total, 2); assert.equal(scans, 0);
  assert.ok(!JSON.stringify(gas.sheets.get('DASHBOARD_CACHE').rows).includes('Cán bộ A'));
  gas.sync(token.token, [record('C')]); assert.equal(gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{})`).kpis.total, 3);
});

test('GAS large valid scopes retain scoped dashboard/cache access; oversized scope cells reject before writes', () => {
  const gas = harness(), token = gas.issue();
  gas.sync(token.token, [record('IN'), record('OUT', { agencyName: 'Outside this grant' })]);
  const agencies = ['Đơn vị A', ...Array.from({ length: 99 }, (_, i) => ('Đơn vị ' + i + ' ').padEnd(160, 'a'))];
  const scope = { ...ALL, sources: ['TPHCM'], agencies };
  assert.ok(JSON.stringify(scope).length > 2000);
  const viewer = gas.createUser({ username: 'large-scope', displayName: 'Large scope', role: 'VIEWER', scope });
  const actor = `TTHC.Users.authorize(${JSON.stringify(viewer.id)})`;
  assert.equal(gas.evaluate(`TTHC.Cases.list(${actor},{})`).total, 1);
  assert.equal(gas.evaluate(`TTHC.Dashboard.summary(${actor},{})`).kpis.total, 1);
  const original = gas.app.Repo.read; let scans = 0;
  gas.app.Repo.read = table => { if (table === 'CASES') scans++; return original(table); };
  assert.equal(gas.evaluate(`TTHC.Dashboard.summary(${actor},{})`).kpis.total, 1);
  assert.equal(scans, 0);
  const many = Array.from({ length: 100 }, (_, i) => ('scope-' + i + '-').padEnd(199, 'a'));
  const oversized = { sources: ['TPHCM'], agencies: many, departments: many, officers: many };
  const before = gas.app.Repo.read('USERS').length;
  assert.throws(() => gas.createUser({ username: 'oversized', displayName: 'Too large', role: 'VIEWER', scope: oversized }), error => error.code === 'VALIDATION_ERROR' && error.message.includes('45.000'));
  assert.equal(gas.app.Repo.read('USERS').length, before);
});

test('GAS RPC does not trust client roles; exports neutralize spreadsheet formulas and log audit', () => {
  const gas = harness(), token = gas.issue(); gas.sync(token.token, [record('=HYPERLINK("x")')]);
  const viewer = gas.createUser({ username: 'viewer', displayName: 'Viewer', role: 'VIEWER', scope: ALL }), session = login(gas, viewer.username);
  const denied = gas.evaluate(`rpc('settings.update',{warningSeconds:1,role:'SUPER_ADMIN'},${JSON.stringify(session.sessionToken)})`); assert.equal(denied.error.code, 'ACCESS_DENIED');
  assert.equal(gas.run('Reports', 'csvCell', '=1+1'), '"\'=1+1"');
  assert.equal(gas.run('Reports', 'csvCell', ' \t@formula'), '"\' \t@formula"');
  const exported = gas.evaluate(`TTHC.Reports.export(${gas.actor()},{type:'cases',period:'custom'})`);
  assert.ok(exported.content.includes("'=HYPERLINK")); assert.equal(exported.count, 1);
  assert.ok(gas.app.Repo.read('AUDIT_LOGS').some(row => row.action === 'EXPORT_REPORT'));
});

test('GAS client completion claims cannot override confirmed status mappings; sparse merged records are revalidated', () => {
  const gas = harness(), token = gas.issue();
  const fabricated = gas.run('Cases', 'normalize', record('CLAIM', { sourceStatus: undefined, normalizedStatus: 'COMPLETED', completedAt: iso(-1) }), 'TPHCM', {});
  assert.equal(fabricated.normalizedStatus, 'UNKNOWN');
  assert.equal(gas.run('Cases', 'normalize', record('CLAIM', { sourceStatus: 'COMPLETED' }), 'TPHCM', {}).normalizedStatus, 'UNKNOWN');
  gas.sync(token.token, [record('PARTIAL', { currentStep: 3, totalSteps: 5 })]);
  const badSteps = gas.sync(token.token, [{ caseCode: 'PARTIAL', totalSteps: 2, lastObservedAt: iso(0) }]); assert.equal(badSteps.failed, 1);
  const badDates = gas.sync(token.token, [{ caseCode: 'PARTIAL', sourceStatus: 'COMPLETED', completedAt: iso(-100), lastObservedAt: iso(0) }]); assert.equal(badDates.failed, 1);
  const update = gas.sync(token.token, [{ caseCode: 'PARTIAL', currentStep: 4, lastObservedAt: iso(0) }]); assert.equal(update.updated, 1);
  const saved = gas.app.Crypto.decrypt(gas.app.Repo.read('CASES')[0].payload_encrypted);
  assert.equal(saved.normalizedStatus, 'PROCESSING'); assert.equal(saved.currentStep, 4); assert.equal(saved.totalSteps, 5);
});

test('GAS stale callers cannot reuse another principal dashboard cache or disable sources after revocation', () => {
  const gas = harness(), token = gas.issue(); gas.sync(token.token, [record('A')]);
  const other = gas.createUser({ username: 'other', displayName: 'Other', role: 'SUPER_ADMIN', scope: ALL });
  const stale = gas.run('Users', 'authorize', other.id);
  gas.evaluate(`TTHC.Users.update(${gas.actor()},${JSON.stringify({ id: other.id, displayName: other.displayName, role: other.role, scope: other.scope, status: 'DISABLED' })})`);
  gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{})`);
  assert.throws(() => gas.run('Dashboard', 'summary', stale, {}), { code: 'ACCESS_DENIED' });
  assert.throws(() => gas.run('Sources', 'update', stale, { id: 'TPHCM', enabled: false }), { code: 'ACCESS_DENIED' });
  assert.equal(gas.run('Sources', 'find', 'TPHCM').enabled, true);
});

test('GAS crypto failures fail before sync writes and scoped admins cannot disable an entire shared source', () => {
  const gas = harness(), token = gas.issue(), revision = gas.app.Repo.revision();
  gas.setCryptoOffline(true); assert.throws(() => gas.sync(token.token, [record('A')]), { code: 'CRYPTO_UNAVAILABLE' });
  assert.equal(gas.app.Repo.read('CASES').length, 0); assert.equal(gas.app.Repo.read('SYNC_LOGS').length, 0); assert.equal(gas.app.Repo.revision(), revision);
  gas.setCryptoOffline(false);
  const admin = gas.createUser({ username: 'scoped-admin', displayName: 'Scoped admin', role: 'ADMIN', scope: { ...ALL, sources: ['TPHCM'], agencies: ['Đơn vị A'] } });
  assert.throws(() => gas.evaluate(`TTHC.Sources.update(TTHC.Users.authorize(${JSON.stringify(admin.id)}),{id:'TPHCM',enabled:false})`), { code: 'ACCESS_DENIED' });
});

test('GAS sparse observations preserve confirmed official extensions and opaque group keys match full labels', () => {
  const gas = harness(), token = gas.issue(), name = 'Đơn vị '.repeat(80).trim();
  gas.evaluate(`TTHC.Repo.writeBatch('SOURCE_MAPPING',[{mapping_id:'synthetic-extension',source_id:'TPHCM',payload_encrypted:TTHC.Crypto.encrypt({extensionPolicyConfirmed:true}),crypto_version:TTHC.Crypto.cryptoVersion,updated_at:${JSON.stringify(iso(0))}}],'mapping_id')`);
  gas.sync(token.token, [record('A', { agencyName: name, extensionDueAt: iso(96), extensionConfirmed: true })]);
  assert.equal(gas.sync(token.token, [{ caseCode: 'A', lastObservedAt: iso(0) }]).updated, 1);
  const saved = gas.app.Crypto.decrypt(gas.app.Repo.read('CASES')[0].payload_encrypted); assert.equal(saved.extensionConfirmed, true);
  const summary = gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{})`), key = summary.byAgency[0].key;
  assert.equal(summary.byAgency[0].label.length, 200);
  assert.equal(gas.evaluate(`TTHC.Cases.list(${gas.actor()},{agencyKey:${JSON.stringify(key)}})`).total, 1);
  assert.equal(gas.evaluate(`TTHC.Cases.list(${gas.actor()},{agencyKey:'UNASSIGNED'})`).total, 0);
});

test('GAS multilingual aggregate labels fit encrypted cache limits while retaining full KPIs', () => {
  const gas = harness(), token = gas.issue();
  const cases = Array.from({ length: 40 }, (_, i) => record('BIG-' + i, { agencyName: ('Đơn vị ' + i + ' ').repeat(90).slice(0, 990), departmentName: ('Phòng ' + i + ' ').repeat(90).slice(0, 990), officerName: ('Cán bộ ' + i + ' ').repeat(90).slice(0, 990), procedureName: ('Thủ tục ' + i + ' ').repeat(90).slice(0, 990) }));
  const result = gas.sync(token.token, cases); assert.equal(result.created, 40);
  const summary = gas.evaluate(`TTHC.Dashboard.summary(${gas.actor()},{})`); assert.equal(summary.kpis.total, 40);
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) <= 28000);
});
