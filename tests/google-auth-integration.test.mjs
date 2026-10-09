import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/database.mjs';
import { createApp } from '../server/app.mjs';
import { createSession, createUser, hashToken } from '../server/auth.mjs';
import { SheetPermissions } from '../server/sheet-permissions.mjs';
import { SheetStoreError } from '../server/sheet-store.mjs';
import { syncBatch } from '../server/cases.mjs';

const spreadsheetId = '18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU';
const secret = () => randomBytes(32).toString('base64url');
const grant = (email, role = 'SYSTEM_ADMIN', scope = {}, active = true) => ({ email, displayName: email, role, scope, active });
const identity = (email = 'admin@example.com', sub = 'google-admin-subject') => ({ email, sub, displayName: 'Google Name' });
const canonical = (caseCode, overrides = {}) => ({ caseCode, normalizedStatus: 'PROCESSING',
  receivedAt: new Date(Date.now() - 86400000 * 3).toISOString(), dueAt: new Date(Date.now() + 86400000).toISOString(), ...overrides });

async function fixture(t, options = {}) {
  const db = openDatabase(':memory:');
  const localPassword = secret();
  const localAdmin = await createUser(db, { username: 'local.admin', displayName: 'Local Admin', role: 'SYSTEM_ADMIN', password: localPassword });
  const state = { rows: options.grants || [grant('admin@example.com')], unavailable: false, identity: options.identity || identity(), readerCalls: 0,
    finishCalls: [], now: Date.now() };
  const reader = { async read() { state.readerCalls++; if (state.unavailable) throw new Error('Private provider error'); return state.rows; } };
  const permissions = new SheetPermissions(db, { reader, spreadsheetId, refreshSeconds: 10, maxAgeSeconds: 120, clock: () => state.now });
  await permissions.refresh();
  const flows = new Map();
  const googleOidc = {
    start() {
      const flow = { state: secret(), browserToken: secret() };
      flows.set(flow.state, flow.browserToken);
      return { ...flow, authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=' + flow.state };
    },
    async finish(args) {
      state.finishCalls.push(args);
      const expected = flows.get(args.state); flows.delete(args.state);
      if (!expected || expected !== args.browserToken || args.code !== 'valid-code') { const error = new Error('Mock authentication denied'); error.status = 401; throw error; }
      return state.identity;
    },
  };
  const server = createApp(db, { authMode: 'google', googleOidc, permissions, sheetStore: options.store,
    origin: 'http://localhost:3000', allowAnyHost: true, background: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  async function request(path, { method = 'GET', body, headers = {}, session } = {}) {
    const response = await fetch(base + path, { method, redirect: 'manual', headers: { ...session, ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const raw = await response.text();
    const data = raw && response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(raw) : raw;
    return { status: response.status, headers: response.headers, data };
  }
  async function start() {
    const response = await request('/api/auth/google/start');
    assert.equal(response.status, 302);
    const flowState = new URL(response.headers.get('location')).searchParams.get('state');
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    return { state: flowState, cookie, response };
  }
  const callback = flow => request('/api/auth/google/callback?state=' + encodeURIComponent(flow.state) + '&code=valid-code', { headers: { cookie: flow.cookie } });
  async function login(nextIdentity) {
    if (nextIdentity) state.identity = nextIdentity;
    const flow = await start();
    return callback(flow);
  }
  function sessionFrom(response) {
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('gs_session='))?.split(';')[0];
    assert.ok(cookie, 'Successful login issues a session cookie');
    const session = db.prepare('SELECT * FROM sessions WHERE tokenHash=?').get(hashToken(cookie.split('=')[1]));
    assert.ok(session);
    return { cookie, 'x-csrf-token': session.csrfToken };
  }
  return { db, permissions, state, localAdmin, localPassword, request, start, callback, login, sessionFrom };
}

test('Google configuration exposes the auth provider and disables local password fallback', async t => {
  const f = await fixture(t);
  const config = await f.request('/api/auth/config');
  assert.equal(config.status, 200);
  assert.equal(config.data.mode, 'google');
  assert.equal(config.data.permissionsProvider, 'google_sheets');
  assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { username: 'local.admin', password: f.localPassword } })).status, 403);
  const localSession = createSession(f.db, f.localAdmin.id);
  assert.equal((await f.request('/api/auth/me', { headers: { cookie: 'gs_session=' + localSession.token } })).status, 401);
});

test('Callback forwards browser binding and creates an account by Google subject with Sheet grants', async t => {
  const f = await fixture(t);
  const flow = await f.start();
  assert.match(flow.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.match(flow.response.headers.get('set-cookie'), /Path=\/api\/auth\/google/);
  const callback = await f.callback(flow);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/dashboard');
  assert.deepEqual(f.state.finishCalls[0], { state: flow.state, code: 'valid-code', browserToken: flow.cookie.split('=')[1] });
  const row = f.db.prepare('SELECT * FROM users WHERE googleSubject=?').get('google-admin-subject');
  assert.equal(row.email, 'admin@example.com');
  assert.equal(row.role, 'SYSTEM_ADMIN');
  assert.equal(row.passwordHash, '!GOOGLE_ONLY!');
  assert.notEqual(row.id, f.localAdmin.id);
  const me = await f.request('/api/auth/me', { session: f.sessionFrom(callback) });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'admin@example.com');
  assert.equal(me.data.user.authProvider, 'google');
  assert.equal(me.data.user.passwordHash, undefined);
  assert.equal(me.data.user.googleSubject, undefined);
});

test('Missing browser cookie and authentication cancellation never create a session', async t => {
  const f = await fixture(t);
  const flow = await f.start();
  const response = await f.request('/api/auth/google/callback?state=' + flow.state + '&code=valid-code');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login?authError=google_failed');
  assert.equal(f.state.finishCalls[0].browserToken, undefined);
  const cancelled = await f.request('/api/auth/google/callback?error=access_denied');
  assert.equal(cancelled.status, 303);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
});

test('Missing or disabled Sheet email denies login without creating an account or session', async t => {
  const f = await fixture(t, { grants: [grant('admin@example.com'), grant('disabled@example.com', 'VIEWER', { sourceSystems: ['TPHCM'] }, false)] });
  for (const email of ['missing@example.com', 'disabled@example.com']) {
    const response = await f.login(identity(email, 'subject-' + email));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login?authError=permission_denied');
    assert.equal(response.headers.getSetCookie().some(value => value.startsWith('gs_session=')), false);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users WHERE googleSubject IS NOT NULL').get().n, 0);
});

test('Google identity cannot automatically link an existing local or different Google email owner', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE users SET email=? WHERE id=?').run('admin@example.com', f.localAdmin.id);
  const response = await f.login();
  assert.equal(response.headers.get('location'), '/login?authError=permission_denied');
  const local = f.db.prepare('SELECT * FROM users WHERE id=?').get(f.localAdmin.id);
  assert.equal(local.googleSubject, null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  f.db.prepare('UPDATE users SET email=NULL WHERE id=?').run(f.localAdmin.id);
  assert.equal((await f.login()).headers.get('location'), '/dashboard');
  const sessionCount = f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n;
  const different = await f.login(identity('admin@example.com', 'different-subject'));
  assert.equal(different.headers.get('location'), '/login?authError=permission_denied');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, sessionCount);
});

test('Sheet changes revoke sessions and collector tokens for changed roles, scopes, disabled and removed emails', async t => {
  const f = await fixture(t, { grants: [grant('admin@example.com'), grant('officer@example.com', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' })] });
  const accountIdentity = identity('officer@example.com', 'officer-subject');
  let response = await f.login(accountIdentity);
  for (const change of [
    grant('officer@example.com', 'CENTRAL_ADMIN', { sourceSystems: ['TPHCM'] }),
    grant('officer@example.com', 'CENTRAL_ADMIN', { sourceSystems: ['MOF'] }),
    grant('officer@example.com', 'CENTRAL_ADMIN', { sourceSystems: ['MOF'] }, false),
    null,
  ]) {
    const session = f.sessionFrom(response);
    const tokenResponse = await f.request('/api/collector/tokens', { method: 'POST', session });
    assert.equal(tokenResponse.status, 201);
    const account = f.db.prepare('SELECT * FROM users WHERE googleSubject=?').get('officer-subject');
    f.state.rows = [grant('admin@example.com'), ...(change ? [change] : [])];
    await f.permissions.refresh();
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE userId=?').get(account.id).n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collector_tokens WHERE userId=?').get(account.id).n, 0);
    assert.equal((await f.request('/api/auth/me', { session })).status, 401);
    assert.equal((await f.request('/api/collector/sync', { method: 'POST', headers: { authorization: 'Bearer ' + tokenResponse.data.token },
      body: { sourceSystem: 'TPHCM', records: [] } })).status, 401);
    f.state.rows = [grant('admin@example.com'), grant('officer@example.com', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' })];
    await f.permissions.refresh();
    response = await f.login(accountIdentity);
    assert.equal(response.headers.get('location'), '/dashboard');
  }
});

test('A failed Sheet refresh denies previously valid sessions and local fallback', async t => {
  const f = await fixture(t);
  const session = f.sessionFrom(await f.login());
  assert.equal((await f.request('/api/auth/me', { session })).status, 200);
  f.state.unavailable = true;
  f.state.now += 10000;
  const unavailable = await f.request('/api/auth/me', { session });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.data.user, undefined);
  assert.equal((await f.request('/api/auth/google/start')).status, 503);
  assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { username: 'local.admin', password: f.localPassword } })).status, 403);
});

test('Manual permissions refresh requires SYSTEM_ADMIN and session CSRF', async t => {
  const f = await fixture(t, { grants: [grant('admin@example.com'), grant('viewer@example.com', 'VIEWER', { sourceSystems: ['TPHCM'] })] });
  const admin = f.sessionFrom(await f.login());
  const previousCalls = f.state.readerCalls;
  assert.equal((await f.request('/api/admin/permissions/refresh', { method: 'POST', session: { cookie: admin.cookie } })).status, 403);
  assert.equal(f.state.readerCalls, previousCalls);
  const refreshed = await f.request('/api/admin/permissions/refresh', { method: 'POST', session: admin });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.data.provider.provider, 'google_sheets');
  assert.equal(f.state.readerCalls, previousCalls + 1);
  const viewer = f.sessionFrom(await f.login(identity('viewer@example.com', 'viewer-subject')));
  assert.equal((await f.request('/api/admin/permissions/refresh', { method: 'POST', session: viewer })).status, 403);
});

test('Users administration lists Sheet grants, including never logged-in users, and blocks local rights writes', async t => {
  const f = await fixture(t, { grants: [grant('admin@example.com'), grant('pending@example.com', 'VIEWER', { sourceSystems: ['MOF'] })] });
  const session = f.sessionFrom(await f.login());
  const result = await f.request('/api/admin/users', { session });
  assert.equal(result.status, 200);
  assert.equal(result.data.provider.provider, 'google_sheets');
  assert.deepEqual(result.data.items.map(row => row.email).sort(), ['admin@example.com', 'pending@example.com']);
  assert.equal(result.data.items.find(row => row.email === 'pending@example.com').id, null);
  assert.equal(result.data.items.some(row => row.username === 'local.admin'), false);
  assert.equal((await f.request('/api/admin/users', { method: 'POST', session, body: { username: 'unsafe-new-admin' } })).status, 403);
  assert.equal((await f.request('/api/admin/users/' + f.localAdmin.id, { method: 'PATCH', session, body: { role: 'SYSTEM_ADMIN' } })).status, 403);
});

test('Successful Google login waits for durable Sheet flush before issuing a session cookie', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const store = { flush: async () => { entered(); await gate; }, status: () => ({ provider: 'google_sheets', ready: true }) };
  const f = await fixture(t, { store });
  const flow = await f.start();
  const pending = f.callback(flow);
  await started;
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users WHERE googleSubject IS NOT NULL').get().n, 1);
  release();
  const response = await pending;
  assert.equal(response.headers.get('location'), '/dashboard');
  assert.ok(f.sessionFrom(response));
});

test('Failed durable login flush denies session creation with an unavailable redirect', async t => {
  const store = { flush: async () => { throw new SheetStoreError('SHEET_COMMIT_UNCONFIRMED', 'Chưa xác nhận lưu Google Sheet.'); }, status: () => ({ ready: false }) };
  const f = await fixture(t, { store });
  const response = await f.login();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login?authError=unavailable');
  assert.equal(response.headers.getSetCookie().some(value => value.startsWith('gs_session=')), false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
});

test('Durability failure after a mutation returns 503 and retains the pending local operation for retry', async t => {
  let mode = 'healthy';
  let flushes = 0;
  const store = { flush: async () => {
    flushes++;
    if (mode === 'fail-mutation' && flushes % 2 === 0) throw new SheetStoreError('SHEET_COMMIT_UNCONFIRMED', 'Chưa xác nhận lưu Google Sheet.');
  }, status: () => ({ ready: mode === 'healthy' }) };
  const f = await fixture(t, { store });
  const session = f.sessionFrom(await f.login());
  flushes = 0; mode = 'fail-mutation';
  const result = await f.request('/api/collector/tokens', { method: 'POST', session });
  assert.equal(result.status, 503);
  assert.equal(result.data.token, undefined);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collector_tokens').get().n, 1);
  mode = 'healthy';
  assert.equal((await f.request('/api/auth/me', { session })).status, 200);
});

test('Backend data scope follows Google Sheet role and officer scope for existing cases', async t => {
  const f = await fixture(t, { grants: [grant('admin@example.com'), grant('officer@example.com', 'OFFICER', { sourceSystems: ['TPHCM'], officerId: 'O1' })] });
  syncBatch(f.db, { sourceSystem: 'TPHCM', records: [canonical('OWN', { officerId: 'O1' }), canonical('OTHER', { officerId: 'O2' })] }, f.localAdmin);
  syncBatch(f.db, { sourceSystem: 'MOF', records: [canonical('MINISTRY', { officerId: 'O1' })] }, f.localAdmin);
  const session = f.sessionFrom(await f.login(identity('officer@example.com', 'officer-subject')));
  const result = await f.request('/api/cases?pageSize=100', { session });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.items.map(row => row.caseCode), ['OWN']);
  assert.equal((await f.request('/api/dashboard', { session })).data.metrics.total, 1);
  const other = f.db.prepare('SELECT id FROM cases WHERE caseCode=?').get('OTHER');
  assert.equal((await f.request('/api/cases/' + other.id, { session })).status, 404);
  const account = f.db.prepare('SELECT id FROM users WHERE googleSubject=?').get('officer-subject');
  f.db.prepare('UPDATE users SET role=?,scope=? WHERE id=?').run('SYSTEM_ADMIN', '{}', account.id);
  assert.deepEqual((await f.request('/api/cases?pageSize=100', { session })).data.items.map(row => row.caseCode), ['OWN']);
});
