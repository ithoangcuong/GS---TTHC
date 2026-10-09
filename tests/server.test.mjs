import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/database.mjs';
import { createApp } from '../server/app.mjs';
import { createUser, createSession, hashToken } from '../server/auth.mjs';
import { syncBatch, recalculateDue, listCases, dashboard } from '../server/cases.mjs';
import { parseFile, toXlsx } from '../server/import.mjs';

const randomPassword = () => randomBytes(24).toString('base64url');
const iso = offset => new Date(Date.now() + offset).toISOString();
const canonical = (code, overrides = {}) => ({ caseCode: code, normalizedStatus: 'PROCESSING', receivedAt: iso(-7 * 86400000), dueAt: iso(-86400000), ...overrides });

async function fixture(t, options = {}) {
  const db = openDatabase(':memory:');
  const password = randomPassword();
  const admin = await createUser(db, { username: 'admin', displayName: 'System Admin', password, role: 'SYSTEM_ADMIN' });
  const server = createApp(db, { origin: 'http://localhost:3000', allowAnyHost: true, background: false, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const sessionFor = user => {
    const session = createSession(db, user.id);
    return { cookie: `gs_session=${session.token}`, 'x-csrf-token': session.csrfToken };
  };
  async function request(path, { method = 'GET', body, headers = {}, session, raw = false } = {}) {
    const res = await fetch(base + path, { method, headers: { ...(session ?? {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const data = raw ? Buffer.from(await res.arrayBuffer()) : await res.json();
    return { status: res.status, headers: res.headers, data };
  }
  const user = async (username, role, scope) => createUser(db, { username, displayName: username, role, scope, password: randomPassword() });
  return { db, admin, password, request, sessionFor, user };
}

test('HTTP authentication: session cookies, CSRF, origin checks, viewer restrictions and logout', async t => {
  const { admin, password, request, sessionFor, user } = await fixture(t);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/cases')).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: { username: 'admin', password } });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get('set-cookie').includes('HttpOnly; SameSite=Strict'));
  assert.equal(login.data.user.passwordHash, undefined);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = { cookie, 'x-csrf-token': login.data.csrfToken };
  assert.equal((await request('/api/auth/me', { session })).data.user.id, admin.id);
  assert.equal((await request('/api/collector/tokens', { method: 'POST', session: { cookie } })).status, 403);
  assert.equal((await request('/api/collector/tokens', { method: 'POST', session, headers: { origin: 'https://evil.example' } })).status, 403);
  const viewer = await user('viewer', 'VIEWER', { sourceSystems: ['TPHCM'] });
  assert.equal((await request('/api/collector/tokens', { method: 'POST', session: sessionFor(viewer) })).status, 403);
  const collector = await request('/api/collector/tokens', { method: 'POST', session });
  assert.equal(collector.status, 201);
  assert.equal((await request('/api/auth/logout', { method: 'POST', session })).status, 200);
  assert.equal((await request('/api/auth/me', { session })).status, 401);
  assert.equal((await request('/api/collector/sync', { method: 'POST', headers: { authorization: 'Bearer ' + collector.data.token }, body: { sourceSystem: 'TPHCM', records: [canonical('AFTER-LOGOUT')] } })).status, 401);
});

test('Every role is scoped across list, detail, dashboard, alerts, notifications, catalogs and exports', async t => {
  const { db, admin, request, sessionFor, user } = await fixture(t);
  const records = [
    canonical('A1', { agencyId: 'A', agencyName: 'Agency A', departmentId: 'DA', departmentName: 'Dept A', officerId: 'O1', officerName: 'Officer 1', applicantName: 'Private Citizen One', metadata: { citizenAddress: 'PRIVATE-METADATA' } }),
    canonical('A2', { agencyId: 'A', agencyName: 'Agency A', departmentId: 'DB', departmentName: 'Dept B', officerId: 'O2', officerName: 'Officer 2', applicantName: 'Private Citizen Two' }),
    canonical('B1', { agencyId: 'B', agencyName: 'Agency B', departmentId: 'DC', departmentName: 'Dept C', officerId: 'O3', officerName: 'Officer 3', applicantName: 'Private Citizen Three' }),
  ];
  assert.equal(syncBatch(db, { sourceSystem: 'TPHCM', records }, admin).created, 3);
  assert.equal(syncBatch(db, { sourceSystem: 'MOF', records: [canonical('M1', { agencyId: 'M', agencyName: 'Ministry', applicantName: 'Private Ministry Citizen' })] }, admin).created, 1);
  const roles = [
    [admin, ['A1', 'A2', 'B1', 'M1']],
    [await user('central', 'CENTRAL_ADMIN', { sourceSystems: ['TPHCM'] }), ['A1', 'A2', 'B1']],
    [await user('agency', 'AGENCY_LEADER', { sourceSystems: ['TPHCM'], agencyId: 'A' }), ['A1', 'A2']],
    [await user('department', 'DEPARTMENT_LEADER', { sourceSystems: ['TPHCM'], agencyId: 'A', departmentId: 'DA' }), ['A1']],
    [await user('officer', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' }), ['A1']],
    [await user('viewer', 'VIEWER', { sourceSystems: ['TPHCM'], agencyId: 'A' }), ['A1', 'A2']],
  ];
  const allCases = db.prepare('SELECT id,caseCode FROM cases').all();
  for (const [account, expected] of roles) {
    const session = sessionFor(account);
    const list = await request('/api/cases?pageSize=100', { session });
    assert.equal(list.status, 200, account.role);
    assert.deepEqual(list.data.items.map(item => item.caseCode).sort(), [...expected].sort(), account.role);
    assert.equal((await request('/api/cases?sourceSystem=MOF', { session })).data.total, expected.includes('M1') ? 1 : 0);
    assert.equal((await request('/api/dashboard', { session })).data.metrics.total, expected.length);
    const alerts = await request('/api/alerts', { session });
    assert.equal(alerts.data.total, expected.length);
    assert.ok(alerts.data.items.every(item => expected.includes(item.caseCode)));
    const notifications = await request('/api/notifications', { session });
    assert.equal(notifications.data.items.length, expected.length);
    const catalogs = await request('/api/catalogs', { session });
    assert.equal(catalogs.status, 200);
    if (account.role === 'OFFICER') assert.deepEqual(catalogs.data.officers.map(item => item.id), ['O1']);
    const source = await request('/api/sources/TPHCM', { session });
    assert.equal(source.status, 200);
    assert.equal(source.data.source.records, expected.filter(code => code !== 'M1').length);
    assert.equal(source.data.jobs.length, account.role === 'SYSTEM_ADMIN' ? 1 : 0);
    assert.equal(source.data.source.lastSync === null, account.role !== 'SYSTEM_ADMIN');
    for (const row of allCases) {
      const detail = await request('/api/cases/' + row.id, { session });
      assert.equal(detail.status, expected.includes(row.caseCode) ? 200 : 404, `${account.role}/${row.caseCode}`);
      if (account.role === 'VIEWER' && detail.status === 200) {
        assert.equal(JSON.stringify(detail.data).includes('Private Citizen'), false);
        assert.equal(JSON.stringify(detail.data).includes('PRIVATE-METADATA'), false);
        assert.equal(detail.data.case.metadata, undefined);
        assert.ok(detail.data.history.every(item => item.changes.metadata === undefined));
      }
    }
    const exported = await request('/api/reports/export?format=xlsx', { session, raw: true });
    assert.equal(exported.status, 200);
    const parsed = parseFile('export.xlsx', exported.data.toString('base64'));
    assert.equal(parsed.totalRows, expected.length);
    const codeIndex = parsed.headers.indexOf('caseCode');
    assert.deepEqual(parsed.rows.map(row => row[codeIndex]).sort(), [...expected].sort());
    if (account.role === 'VIEWER') assert.equal(JSON.stringify(parsed.rows).includes('Private Citizen'), false);
  }
  const malicious = await request('/api/cases?q=%25%27%20OR%201%3D1--', { session: sessionFor(roles[4][0]) });
  assert.equal(malicious.data.total, 0);
});

test('Batch sync retains partial successes, stable identities, sparse values, source isolation, history and idempotence', async t => {
  const { db, admin } = await fixture(t);
  const initial = canonical('C1', { sourceRecordId: 'R1', officerId: 'O1', lastSourceUpdateAt: '2026-01-01T00:00:00+07:00' });
  const batch = syncBatch(db, { sourceSystem: 'TPHCM', batchId: 'first', records: [initial, { caseCode: '' }] }, admin);
  assert.equal(batch.status, 'PARTIAL_SUCCESS');
  assert.equal(batch.created, 1); assert.equal(batch.failed, 1); assert.equal(batch.errors[0].row, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cases').get().n, 1);
  const replay = syncBatch(db, { sourceSystem: 'TPHCM', batchId: 'first', records: [initial] }, admin);
  assert.equal(replay.id, batch.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM case_history').get().n, 1);
  const identical = syncBatch(db, { sourceSystem: 'TPHCM', records: [initial] }, admin);
  assert.equal(identical.skipped, 1);
  const update = syncBatch(db, { sourceSystem: 'TPHCM', records: [{ caseCode: 'C1', sourceRecordId: 'R1', officerId: 'O2', lastSourceUpdateAt: '2026-01-02T00:00:00+07:00' }] }, admin);
  assert.equal(update.updated, 1);
  const record = JSON.parse(db.prepare('SELECT data FROM cases').get().data);
  assert.equal(record.normalizedStatus, 'PROCESSING'); assert.equal(record.dueAt, initial.dueAt);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM case_history WHERE kind='ASSIGNMENT_CHANGED'").get().n, 1);
  assert.equal(syncBatch(db, { sourceSystem: 'TPHCM', records: [initial] }, admin).skipped, 1);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM cases').get().data).officerId, 'O2');
  assert.equal(syncBatch(db, { sourceSystem: 'MOF', records: [initial] }, admin).created, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cases').get().n, 2);
  assert.equal(syncBatch(db, { sourceSystem: 'TPHCM', records: [canonical('C2', { sourceRecordId: 'R2' })] }, admin).created, 1);
  const conflict = syncBatch(db, { sourceSystem: 'TPHCM', records: [canonical('C2', { sourceRecordId: 'R1' })] }, admin);
  assert.equal(conflict.failed, 1); assert.match(conflict.errors[0].error, /xung đột/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cases').get().n, 3);
});

test('Sparse updates are revalidated against retained chronology and scoped users cannot claim existing outside records', async t => {
  const { db, admin, user } = await fixture(t);
  const original = canonical('DONE', { sourceRecordId: 'DONE-ID', normalizedStatus: 'COMPLETED', receivedAt: '2026-01-01T00:00:00+07:00', completedAt: '2026-01-03T00:00:00+07:00', dueAt: '2026-01-04T00:00:00+07:00', officerId: 'O2' });
  assert.equal(syncBatch(db, { sourceSystem: 'TPHCM', records: [original] }, admin).created, 1);
  const bad = syncBatch(db, { sourceSystem: 'TPHCM', records: [{ caseCode: 'DONE', receivedAt: '2026-01-05T00:00:00+07:00' }] }, admin);
  assert.equal(bad.failed, 1);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM cases').get().data).receivedAt, new Date(original.receivedAt).toISOString());
  assert.equal(db.prepare('SELECT COUNT(*) n FROM case_history').get().n, 1);
  const officer = await user('officer', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' });
  const claim = syncBatch(db, { sourceSystem: 'TPHCM', records: [{ ...original, officerId: 'O1' }] }, officer);
  assert.equal(claim.failed, 1);
  assert.match(claim.errors[0].error, /ngoài phạm vi/);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM cases').get().data).officerId, 'O2');
  const missingStatus = syncBatch(db, { sourceSystem: 'TPHCM', records: [{ caseCode: 'UNKNOWN-NEW' }] }, admin);
  assert.equal(missingStatus.created, 1);
  const unknown = db.prepare('SELECT normalizedStatus,alertLevel FROM cases WHERE caseCode=?').get('UNKNOWN-NEW');
  assert.equal(unknown.normalizedStatus, 'UNKNOWN'); assert.equal(unknown.alertLevel, 'NEEDS_REVIEW');
});

test('Collector token is restricted to sync, expires, honors scope, and cannot raise the collector limit through kind', async t => {
  const { db, admin, request, sessionFor, user } = await fixture(t);
  const officer = await user('officer', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' });
  const tokenResponse = await request('/api/collector/tokens', { method: 'POST', session: sessionFor(officer) });
  assert.equal(tokenResponse.status, 201);
  const bearer = { authorization: 'Bearer ' + tokenResponse.data.token, origin: 'chrome-extension://' + 'a'.repeat(32) };
  assert.equal((await request('/api/cases', { headers: bearer })).status, 403);
  const synced = await request('/api/collector/sync', { method: 'POST', headers: bearer, body: { sourceSystem: 'TPHCM', records: [canonical('OWN', { officerId: 'O1' }), canonical('OTHER', { officerId: 'O2' })] } });
  assert.equal(synced.status, 200); assert.equal(synced.data.created, 1); assert.equal(synced.data.failed, 1);
  const overLimit = await request('/api/collector/sync', { method: 'POST', headers: bearer, body: { sourceSystem: 'TPHCM', kind: 'IMPORT', records: Array.from({ length: 501 }, (_, index) => canonical('LIMIT-' + index, { officerId: 'O1' })) } });
  assert.equal(overLimit.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cases').get().n, 1);
  db.prepare('UPDATE collector_tokens SET expiresAt=0 WHERE tokenHash=?').run(hashToken(tokenResponse.data.token));
  assert.equal((await request('/api/collector/sync', { method: 'POST', headers: bearer, body: { sourceSystem: 'TPHCM', records: [canonical('EXPIRED')] } })).status, 401);
  const adminToken = await request('/api/collector/tokens', { method: 'POST', session: sessionFor(admin) });
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(admin.id);
  assert.equal((await request('/api/collector/sync', { method: 'POST', headers: { authorization: 'Bearer ' + adminToken.data.token }, body: { sourceSystem: 'TPHCM', records: [canonical('INACTIVE')] } })).status, 401);
});

test('CSV/XLSX import previews 20 rows, validates scope and commits partial successes with idempotence', async t => {
  const { db, request, sessionFor, user } = await fixture(t);
  const officer = await user('officer', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' });
  const session = sessionFor(officer);
  const csv = 'Mã,Cán bộ,Trạng thái\n' + Array.from({ length: 25 }, (_, index) => `IMPORT-${index},${index === 24 ? 'O2' : 'O1'},PROCESSING`).join('\n');
  const body = { fileName: 'input.csv', base64: Buffer.from(csv).toString('base64'), sourceSystem: 'TPHCM', mapping: { 'Mã': 'caseCode', 'Cán bộ': 'officerId', 'Trạng thái': 'normalizedStatus' }, batchId: 'import-once' };
  const preview = await request('/api/import/preview', { method: 'POST', session, body });
  assert.equal(preview.status, 200); assert.equal(preview.data.totalRows, 25); assert.equal(preview.data.rows.length, 20);
  const validate = await request('/api/import/validate', { method: 'POST', session, body });
  assert.equal(validate.status, 200); assert.equal(validate.data.valid, 24); assert.equal(validate.data.invalid, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cases').get().n, 0);
  const commit = await request('/api/import/commit', { method: 'POST', session, body });
  assert.equal(commit.status, 200); assert.equal(commit.data.created, 24); assert.equal(commit.data.failed, 1);
  const replay = await request('/api/import/commit', { method: 'POST', session, body });
  assert.equal(replay.data.id, commit.data.id); assert.equal(db.prepare('SELECT COUNT(*) n FROM cases').get().n, 24);
  assert.equal((await request('/api/import/commit', { method: 'POST', session, body: { ...body, sourceSystem: 'MOF', batchId: 'denied' } })).status, 403);
  const xlsx = toXlsx([{ Code: 'XLSX-1', Officer: 'O1', Status: 'PROCESSING', Due: '2026-10-10T12:00:00+07:00' }]);
  const xlsxCommit = await request('/api/import/commit', { method: 'POST', session, body: { fileName: 'input.xlsx', base64: xlsx.toString('base64'), sourceSystem: 'TPHCM', mapping: { Code: 'caseCode', Officer: 'officerId', Status: 'normalizedStatus', Due: 'dueAt' } } });
  assert.equal(xlsxCommit.status, 200); assert.equal(xlsxCommit.data.created, 1);
});

test('Alert lifecycle: scoped acknowledgment, deduplication, escalation and resolution preserve history', async t => {
  const { db, admin, request, sessionFor, user } = await fixture(t);
  const officer = await user('officer', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' });
  const record = canonical('ALERT', { officerId: 'O1' });
  syncBatch(db, { sourceSystem: 'TPHCM', records: [record] }, admin);
  const alert = db.prepare('SELECT * FROM alerts').get(); assert.equal(alert.level, 'OVERDUE');
  const viewer = await user('viewer', 'VIEWER', { sourceSystems: ['TPHCM'] });
  assert.equal((await request(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST', session: sessionFor(viewer) })).status, 403);
  const other = await user('other', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O2' });
  assert.equal((await request(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST', session: sessionFor(other) })).status, 404);
  assert.equal((await request(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST', session: sessionFor(officer) })).status, 200);
  syncBatch(db, { sourceSystem: 'TPHCM', records: [record] }, admin);
  assert.equal(db.prepare('SELECT status FROM alerts').get().status, 'ACKNOWLEDGED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 1);
  syncBatch(db, { sourceSystem: 'TPHCM', records: [{ ...record, dueAt: iso(-4 * 86400000) }] }, admin);
  const escalated = db.prepare('SELECT * FROM alerts').get(); assert.equal(escalated.id, alert.id); assert.equal(escalated.level, 'CRITICAL_OVERDUE'); assert.equal(escalated.status, 'OPEN');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 2);
  syncBatch(db, { sourceSystem: 'TPHCM', records: [{ ...record, normalizedStatus: 'COMPLETED', completedAt: iso(0) }] }, admin);
  assert.equal(db.prepare('SELECT status FROM alerts').get().status, 'RESOLVED');
  assert.equal((await request(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST', session: sessionFor(officer) })).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alert_history').get().n, 4);
});

test('Rule changes schedule recalculation for stored cases and system settings reject non-admin writes', async t => {
  const { db, admin, request, sessionFor, user } = await fixture(t);
  syncBatch(db, { sourceSystem: 'TPHCM', records: [canonical('FUTURE', { dueAt: iso(2 * 86400000) })] }, admin);
  assert.equal(db.prepare('SELECT alertLevel FROM cases').get().alertLevel, 'WARNING');
  const leader = await user('leader', 'AGENCY_LEADER', { sourceSystems: ['TPHCM'], agencyId: 'A' });
  const rule = { scopeType: 'GLOBAL', scopeId: '*', config: { watchSeconds: 4 * 86400, warningSeconds: 3 * 86400, highRiskSeconds: 3 * 86400 } };
  assert.equal((await request('/api/settings/rules', { method: 'PUT', session: sessionFor(leader), body: rule })).status, 403);
  assert.equal((await request('/api/settings/rules', { method: 'PUT', session: sessionFor(admin), body: rule })).status, 200);
  assert.equal(db.prepare('SELECT nextRecalculationAt FROM cases').get().nextRecalculationAt, 0);
  recalculateDue(db);
  assert.equal(db.prepare('SELECT alertLevel FROM cases').get().alertLevel, 'HIGH_RISK');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alerts').get().n, 1);
});

test('Migrations and source initialization can rerun without losing users or source configuration', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'gs-tthc-migration-'));
  const filename = join(directory, 'test.sqlite');
  t.after(() => { for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true }); rmdirSync(directory); });
  const first = openDatabase(filename);
  const account = await createUser(first, { username: 'persisted', displayName: 'Persisted Admin', password: randomPassword(), role: 'SYSTEM_ADMIN' });
  first.prepare('UPDATE source_systems SET enabled=0 WHERE id=?').run('TPHCM');
  const migrationCount = first.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n;
  const sourceCount = first.prepare('SELECT COUNT(*) n FROM source_systems').get().n;
  first.close();
  const reopened = openDatabase(filename);
  try {
    assert.equal(reopened.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, migrationCount);
    assert.equal(reopened.prepare('SELECT COUNT(*) n FROM source_systems').get().n, sourceCount);
    assert.equal(reopened.prepare('SELECT id FROM users WHERE username=?').get('persisted').id, account.id);
    assert.equal(reopened.prepare('SELECT enabled FROM source_systems WHERE id=?').get('TPHCM').enabled, 0);
    assert.equal(reopened.prepare('SELECT COUNT(*) n FROM source_field_mappings').get().n, sourceCount);
  } finally { reopened.close(); }
});

test('Background engine detects a due-time crossing and preserves one alert identity', async t => {
  const { db, admin } = await fixture(t, { background: true });
  const record = canonical('CROSSING', { dueAt: iso(25) });
  assert.equal(syncBatch(db, { sourceSystem: 'TPHCM', records: [record] }, admin).created, 1);
  const alertId = db.prepare('SELECT id FROM alerts').get().id;
  const deadline = Date.now() + 2500;
  let level;
  do {
    await new Promise(resolve => setTimeout(resolve, 25));
    level = db.prepare('SELECT alertLevel FROM cases').get().alertLevel;
  } while (level !== 'OVERDUE' && Date.now() < deadline);
  assert.equal(level, 'OVERDUE');
  assert.equal(db.prepare('SELECT id FROM alerts').get().id, alertId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alerts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM case_history').get().n, 1);
});
