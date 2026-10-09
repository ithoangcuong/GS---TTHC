import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, scryptSync } from 'node:crypto';
import { gasRuntime } from './helpers/apps-script.mjs';

const MODULES = ['Utils', 'Crypto', 'Passwords', 'SheetRepository', 'Settings', 'Audit', 'Permissions', 'Users', 'Sources', 'Auth', 'Router', 'Setup'];
const ALL = { sources: ['*'], agencies: ['*'], departments: ['*'], officers: ['*'] };
const CHANGED = 'SYNTHETIC-changed-password-2026!';
const snapshot = gas => JSON.stringify([...gas.sheets].map(([name, sheet]) => [name, sheet.rows]));
const rpc = (gas, action, payload = {}, token = '') => gas.plain(gas.app.Router.rpc(action, payload, token));
function successful(gas, action, payload = {}, token = '') {
  const result = rpc(gas, action, payload, token);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  return result.data;
}
function fixture(changeAdmin = true) {
  const gas = gasRuntime(MODULES);
  gas.context.setupTthcMonitor_();
  gas.adminId = gas.context.bootstrapAdmin_().userId;
  gas.admin = successful(gas, 'auth.login', { username: 'admin', password: gas.properties.get('BOOTSTRAP_PASSWORD') });
  if (changeAdmin) gas.admin = successful(gas, 'auth.changePassword', { currentPassword: gas.properties.get('BOOTSTRAP_PASSWORD'), newPassword: CHANGED }, gas.admin.sessionToken);
  return gas;
}
function create(gas, username, role = 'VIEWER', scope = ALL) {
  return successful(gas, 'users.create', { username, displayName: 'Synthetic ' + username, role, scope, status: 'ACTIVE' }, gas.admin.sessionToken);
}
function login(gas, username, password) { return successful(gas, 'auth.login', { username, password }); }
function change(gas, session, currentPassword, newPassword = CHANGED) {
  return successful(gas, 'auth.changePassword', { currentPassword, newPassword }, session.sessionToken);
}
function beforeNextSnapshot(gas, callback) {
  const original = gas.app.Repo.readSnapshot;
  gas.app.Repo.readSnapshot = function (tables) {
    gas.app.Repo.readSnapshot = original;
    callback();
    return original(tables);
  };
}

test('GAS admin provisions usernames without email and returns the shared default only when issuing credentials', () => {
  const gas = fixture(), issued = create(gas, 'Staff.One'), second = create(gas, 'staff.two');
  assert.equal(issued.user.username, 'staff.one');
  assert.equal(issued.defaultPassword, gas.properties.get('DEFAULT_USER_PASSWORD'));
  assert.equal(second.defaultPassword, issued.defaultPassword);
  assert.equal(issued.user.mustChangePassword, true);
  const rows = gas.app.Repo.read('USERS'), row = rows.find(item => item.user_id === issued.user.id), row2 = rows.find(item => item.user_id === second.user.id);
  assert.ok(row.password_hash && row2.password_hash);
  assert.notEqual(row.password_hash, row2.password_hash, 'Identical defaults must use distinct password salts');
  assert.equal(row.email_hash, '');
  assert.equal(row.email_encrypted, '');
  const sheetData = snapshot(gas);
  assert.ok(!sheetData.includes(issued.defaultPassword));
  assert.ok(!sheetData.includes('staff.one'));
  const listed = successful(gas, 'users.list', {}, gas.admin.sessionToken);
  assert.ok(listed.items.some(item => item.username === 'staff.one'));
  assert.ok(!JSON.stringify(listed).includes('password_hash'));
  assert.ok(!JSON.stringify(listed).includes(issued.defaultPassword));
  assert.equal(rpc(gas, 'users.create', { username: 'anonymous', displayName: 'Anonymous', role: 'VIEWER', scope: ALL }).error.code, 'AUTH_REQUIRED');
  assert.equal(rpc(gas, 'users.create', { username: 'STAFF.ONE', displayName: 'Duplicate', role: 'VIEWER', scope: ALL }, gas.admin.sessionToken).error.code, 'CONFLICT');
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS username login gives opaque sessions, refuses unknown/default guesses and leaves account state unchanged on failure', () => {
  const gas = fixture(), before = snapshot(gas), logs = [];
  gas.context.console.log = value => logs.push(JSON.parse(value));
  const wrong = rpc(gas, 'auth.login', { username: 'admin', password: 'SYNTHETIC-private-wrong-password' });
  const unknown = rpc(gas, 'auth.login', { username: 'unlisted', password: gas.properties.get('DEFAULT_USER_PASSWORD') });
  assert.equal(wrong.error.code, 'AUTH_INVALID');
  assert.equal(unknown.error.code, 'AUTH_INVALID');
  assert.equal(wrong.error.message, unknown.error.message);
  assert.equal(snapshot(gas), before);
  assert.ok(!JSON.stringify({ logs, wrong, unknown }).includes('SYNTHETIC-private-wrong-password'));
  assert.ok(!JSON.stringify({ logs, wrong, unknown }).includes(gas.properties.get('DEFAULT_USER_PASSWORD')));
  const session = login(gas, 'ADMIN', CHANGED);
  assert.match(session.sessionToken, /^tthc\.s\.[a-f0-9]{64}$/);
  assert.equal(session.user.username, 'admin');
  assert.equal(session.mustChangePassword, false);
  assert.ok(Number.isFinite(Date.parse(session.expiresAt)));
  assert.equal(successful(gas, 'auth.session', {}, session.sessionToken).user.id, gas.adminId);
  successful(gas, 'auth.logout', {}, session.sessionToken);
  assert.equal(rpc(gas, 'auth.session', {}, session.sessionToken).error.code, 'AUTH_REQUIRED');
});

test('GAS first login is restricted to changing its password and rotates the session before granting business access', () => {
  const gas = fixture(false), initial = gas.admin;
  assert.equal(initial.mustChangePassword, true);
  assert.equal(initial.user.mustChangePassword, true);
  assert.equal(successful(gas, 'auth.session', {}, initial.sessionToken).mustChangePassword, true);
  assert.equal(rpc(gas, 'users.list', {}, initial.sessionToken).error.code, 'PASSWORD_CHANGE_REQUIRED');
  const before = snapshot(gas);
  for (const payload of [
    { currentPassword: 'wrong-current-password', newPassword: CHANGED },
    { currentPassword: gas.properties.get('BOOTSTRAP_PASSWORD'), newPassword: 'short' },
    { currentPassword: gas.properties.get('BOOTSTRAP_PASSWORD'), newPassword: gas.properties.get('BOOTSTRAP_PASSWORD') },
    { currentPassword: gas.properties.get('BOOTSTRAP_PASSWORD'), newPassword: gas.properties.get('DEFAULT_USER_PASSWORD') }
  ]) {
    assert.equal(rpc(gas, 'auth.changePassword', payload, initial.sessionToken).ok, false);
    assert.equal(snapshot(gas), before);
  }
  const renewed = change(gas, initial, gas.properties.get('BOOTSTRAP_PASSWORD'));
  assert.notEqual(renewed.sessionToken, initial.sessionToken);
  assert.equal(renewed.mustChangePassword, false);
  assert.equal(rpc(gas, 'auth.session', {}, initial.sessionToken).error.code, 'AUTH_REQUIRED');
  successful(gas, 'users.list', {}, renewed.sessionToken);
  assert.equal(rpc(gas, 'auth.login', { username: 'admin', password: gas.properties.get('BOOTSTRAP_PASSWORD') }).error.code, 'AUTH_INVALID');
  assert.equal(login(gas, 'admin', CHANGED).mustChangePassword, false);
});

test('GAS password reset invalidates every user session and collector grant, then requires another first-use change', () => {
  const gas = fixture(), issued = create(gas, 'collector.user', 'MANAGER', { ...ALL, sources: ['TPHCM'], agencies: ['Agency A'] });
  let userSession = login(gas, issued.user.username, issued.defaultPassword);
  userSession = change(gas, userSession, issued.defaultPassword);
  const second = login(gas, issued.user.username, CHANGED);
  const collector = successful(gas, 'extension.tokens.create', { sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn' }, userSession.sessionToken);
  const reset = successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken);
  assert.equal(reset.defaultPassword, issued.defaultPassword);
  assert.equal(reset.user.mustChangePassword, true);
  for (const session of [userSession, second]) assert.equal(rpc(gas, 'auth.session', {}, session.sessionToken).error.code, 'AUTH_REQUIRED');
  assert.throws(() => gas.app.Auth.collector(collector.token, 'TPHCM', 'motcua.tphcm.gov.vn'), { code: 'TOKEN_INVALID' });
  assert.equal(rpc(gas, 'auth.login', { username: issued.user.username, password: CHANGED }).error.code, 'AUTH_INVALID');
  const defaultSession = login(gas, issued.user.username, reset.defaultPassword);
  assert.equal(defaultSession.mustChangePassword, true);
  assert.equal(rpc(gas, 'extension.tokens.create', { sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn' }, defaultSession.sessionToken).error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal(rpc(gas, 'users.resetPassword', { id: gas.adminId }, gas.admin.sessionToken).error.code, 'ACCESS_DENIED');
});

test('GAS issuance and resets respect administrator scope and deny viewer grants and privilege escalation', () => {
  const gas = fixture(), scope = { ...ALL, sources: ['TPHCM'], agencies: ['Agency A'] };
  const scoped = create(gas, 'scoped.admin', 'ADMIN', scope), viewer = create(gas, 'scoped.viewer', 'VIEWER', scope), outside = create(gas, 'outside.viewer', 'VIEWER', { ...ALL, sources: ['MOF'] });
  const adminSession = change(gas, login(gas, scoped.user.username, scoped.defaultPassword), scoped.defaultPassword);
  const viewerSession = change(gas, login(gas, viewer.user.username, viewer.defaultPassword), viewer.defaultPassword);
  const payload = { username: 'scope.staff', displayName: 'Scope staff', role: 'VIEWER', scope, status: 'ACTIVE' };
  assert.equal(rpc(gas, 'users.create', payload, viewerSession.sessionToken).error.code, 'ACCESS_DENIED');
  assert.equal(rpc(gas, 'users.resetPassword', { id: scoped.user.id }, viewerSession.sessionToken).error.code, 'ACCESS_DENIED');
  assert.equal(rpc(gas, 'users.create', { ...payload, role: 'SUPER_ADMIN', scope: ALL }, adminSession.sessionToken).error.code, 'ACCESS_DENIED');
  assert.equal(rpc(gas, 'users.resetPassword', { id: outside.user.id }, adminSession.sessionToken).error.code, 'ACCESS_DENIED');
  assert.equal(successful(gas, 'users.create', payload, adminSession.sessionToken).user.username, payload.username);
  assert.equal(successful(gas, 'users.resetPassword', { id: viewer.user.id }, adminSession.sessionToken).user.id, viewer.user.id);
});

test('GAS account disable blocks password login and re-enabling does not restore old sessions', () => {
  const gas = fixture(), issued = create(gas, 'disabled.user');
  const session = change(gas, login(gas, issued.user.username, issued.defaultPassword), issued.defaultPassword);
  const payload = { id: issued.user.id, displayName: issued.user.displayName, role: issued.user.role, scope: issued.user.scope, status: 'DISABLED' };
  successful(gas, 'users.update', payload, gas.admin.sessionToken);
  assert.equal(rpc(gas, 'auth.login', { username: issued.user.username, password: CHANGED }).error.code, 'AUTH_INVALID');
  assert.equal(rpc(gas, 'auth.session', {}, session.sessionToken).ok, false);
  successful(gas, 'users.update', { ...payload, status: 'ACTIVE' }, gas.admin.sessionToken);
  assert.equal(rpc(gas, 'auth.session', {}, session.sessionToken).error.code, 'AUTH_REQUIRED');
  assert.equal(login(gas, issued.user.username, CHANGED).user.id, issued.user.id);
});

test('GAS login throttles repeated guesses without changing users or calling Google services', () => {
  const gas = fixture(), before = snapshot(gas);
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(rpc(gas, 'auth.login', { username: 'nonexistent', password: 'SYNTHETIC-wrong-password' }).error.code, 'AUTH_INVALID');
  assert.equal(rpc(gas, 'auth.login', { username: 'nonexistent', password: 'SYNTHETIC-wrong-password' }).error.code, 'RATE_LIMITED');
  assert.equal(snapshot(gas), before);
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS additive migration preserves legacy user columns, encrypted data and unrelated tables', () => {
  const gas = gasRuntime(MODULES);
  gas.context.setupTthcMonitor_();
  const legacyHeader = gas.plain(gas.app.Repo.schemas.USERS).slice(0, 11), at = '2026-10-01T00:00:00.000Z';
  const legacy = ['legacy-admin-id', gas.app.Users.emailHash('owner@example.test'), gas.app.Crypto.encrypt('owner@example.test'), gas.app.Crypto.encrypt('Legacy Admin'), 'SUPER_ADMIN', JSON.stringify(ALL), 'ACTIVE', at, at, 'LEGACY_OWNER', at];
  const legacyStaff = ['legacy-staff-id', gas.app.Users.emailHash('staff@example.test'), gas.app.Crypto.encrypt('staff@example.test'), gas.app.Crypto.encrypt('Legacy Staff'), 'VIEWER', JSON.stringify(ALL), 'ACTIVE', at, at, 'LEGACY_OWNER', ''];
  gas.sheets.get('USERS').rows = [legacyHeader, legacy, legacyStaff];
  const original = JSON.stringify([legacy, legacyStaff]), sources = JSON.stringify(gas.sheets.get('SOURCES').rows), key = gas.properties.get('DATA_ENCRYPTION_KEY');
  const migration = gas.plain(gas.context.setupSpreadsheet_());
  assert.ok(migration.migratedTables.includes('USERS'));
  assert.equal(JSON.stringify(gas.sheets.get('USERS').rows.slice(1).map(row => row.slice(0, 11))), original);
  assert.equal(JSON.stringify(gas.sheets.get('SOURCES').rows), sources);
  assert.equal(gas.properties.get('DATA_ENCRYPTION_KEY'), key);
  assert.equal(gas.context.setupSpreadsheet_().migratedTables.length, 0);
  assert.equal(gas.context.bootstrapAdmin_().userId, 'legacy-admin-id');
  const admin = gas.app.Users.byId('legacy-admin-id');
  assert.equal(admin.email_encrypted, legacy[2]);
  assert.equal(admin.display_name_encrypted, legacy[3]);
  assert.equal(admin.created_at, at);
  assert.equal(gas.app.Repo.read('USERS').length, 2);
  assert.throws(() => gas.context.bootstrapAdmin_(), { code: 'BOOTSTRAP_CLOSED' });
  let session = login(gas, 'admin', gas.properties.get('BOOTSTRAP_PASSWORD'));
  session = change(gas, session, gas.properties.get('BOOTSTRAP_PASSWORD'));
  const staffBefore = gas.app.Users.byId('legacy-staff-id');
  const issued = successful(gas, 'users.update', { id: 'legacy-staff-id', username: 'legacy.staff', displayName: 'Legacy Staff', role: 'VIEWER', scope: ALL, status: 'ACTIVE' }, session.sessionToken);
  assert.equal(issued.defaultPassword, gas.properties.get('DEFAULT_USER_PASSWORD'));
  assert.equal(issued.user.id, 'legacy-staff-id');
  assert.equal(gas.app.Users.byId('legacy-staff-id').email_encrypted, staffBefore.email_encrypted);
  assert.equal(login(gas, 'legacy.staff', issued.defaultPassword).mustChangePassword, true);
});

test('GAS missing default password refuses issuance and resets without altering existing credentials', () => {
  const gas = fixture(), issued = create(gas, 'existing.user');
  gas.properties.delete('DEFAULT_USER_PASSWORD');
  const before = snapshot(gas);
  assert.equal(rpc(gas, 'users.create', { username: 'new.user', displayName: 'New user', role: 'VIEWER', scope: ALL }, gas.admin.sessionToken).ok, false);
  assert.equal(rpc(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken).ok, false);
  assert.equal(snapshot(gas), before);
  assert.equal(login(gas, 'admin', CHANGED).user.id, gas.adminId);
});

test('GAS password hashes agree with independent Node scrypt and reject malformed stored profiles', () => {
  const gas = fixture(), row = gas.app.Users.byId(gas.adminId), encoded = JSON.parse(row.password_hash);
  const secret = createHmac('sha256', gas.properties.get('LOOKUP_PEPPER')).update('password:' + CHANGED).digest();
  const expected = scryptSync(secret, Buffer.from(encoded.salt, 'hex'), 32, { N: 16384, r: 8, p: 5, maxmem: 33554432 });
  assert.equal(encoded.hash, expected.toString('hex'));
  secret.fill(0); expected.fill(0);
  for (const malformed of ['not-json', JSON.stringify({ ...encoded, n: 1 }), JSON.stringify({ ...encoded, extra: true })]) {
    assert.equal(gas.app.Passwords.configuredHash(malformed), false);
    assert.equal(gas.app.Passwords.verify(CHANGED, malformed), false);
  }
});

test('GAS encrypted default setting supports issuance and resets without exposing plaintext settings', () => {
  const gas = fixture(), password = gas.properties.get('DEFAULT_USER_PASSWORD');
  gas.app.Repo.writeBatch('SETTINGS', [{ key: 'defaultUserPasswordEncrypted', value: gas.app.Crypto.encrypt(password), updated_at: gas.app.Utils.now() }], 'key');
  gas.properties.delete('DEFAULT_USER_PASSWORD');
  const issued = create(gas, 'encrypted.default');
  assert.equal(issued.defaultPassword, password);
  assert.equal(successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken).defaultPassword, password);
  assert.ok(!snapshot(gas).includes(password));
  assert.ok(!JSON.stringify(successful(gas, 'settings.get', {}, gas.admin.sessionToken)).includes(password));
  assert.equal(login(gas, issued.user.username, password).mustChangePassword, true);
});

test('GAS admin reset restores login for a throttled user while keeping first-use restrictions', () => {
  const gas = fixture(), issued = create(gas, 'throttled.user');
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(rpc(gas, 'auth.login', { username: issued.user.username, password: 'SYNTHETIC-invalid-password!' }).error.code, 'AUTH_INVALID');
  assert.equal(rpc(gas, 'auth.login', { username: issued.user.username, password: issued.defaultPassword }).error.code, 'RATE_LIMITED');
  successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken);
  assert.equal(login(gas, issued.user.username, issued.defaultPassword).mustChangePassword, true);
});

test('GAS admin reset clears password-change throttle so a default-password user can recover access', () => {
  const gas = fixture(), issued = create(gas, 'change.throttled'), initial = login(gas, issued.user.username, issued.defaultPassword);
  const invalid = { currentPassword: 'SYNTHETIC-invalid-password!', newPassword: CHANGED };
  for (let attempt = 0; attempt < 5; attempt++) assert.equal(rpc(gas, 'auth.changePassword', invalid, initial.sessionToken).error.code, 'AUTH_INVALID');
  assert.equal(rpc(gas, 'auth.changePassword', { currentPassword: issued.defaultPassword, newPassword: CHANGED }, initial.sessionToken).error.code, 'RATE_LIMITED');
  successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken);
  const renewed = change(gas, login(gas, issued.user.username, issued.defaultPassword), issued.defaultPassword);
  assert.equal(renewed.mustChangePassword, false);
  assert.equal(rpc(gas, 'auth.session', {}, initial.sessionToken).error.code, 'AUTH_REQUIRED');
  assert.equal(successful(gas, 'auth.session', {}, renewed.sessionToken).user.id, issued.user.id);
});

test('GAS stale session cannot change even the same default password after a concurrent reset', () => {
  const gas = fixture(), issued = create(gas, 'reset.race'), initial = login(gas, issued.user.username, issued.defaultPassword);
  let resetState;
  beforeNextSnapshot(gas, () => {
    successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken);
    resetState = snapshot(gas);
  });
  const result = rpc(gas, 'auth.changePassword', { currentPassword: issued.defaultPassword, newPassword: CHANGED }, initial.sessionToken);
  assert.equal(result.error.code, 'AUTH_REQUIRED');
  assert.equal(snapshot(gas), resetState);
  assert.equal(login(gas, issued.user.username, issued.defaultPassword).mustChangePassword, true);
});

test('GAS reset during password verification cannot be overwritten by a stale change commit', () => {
  const gas = fixture(), issued = create(gas, 'commit.race'), initial = login(gas, issued.user.username, issued.defaultPassword);
  const original = gas.app.Passwords.verify;
  let resetState;
  gas.app.Passwords.verify = function (password, hash) {
    gas.app.Passwords.verify = original;
    successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken);
    resetState = snapshot(gas);
    return original(password, hash);
  };
  const result = rpc(gas, 'auth.changePassword', { currentPassword: issued.defaultPassword, newPassword: CHANGED }, initial.sessionToken);
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(snapshot(gas), resetState);
  assert.equal(login(gas, issued.user.username, issued.defaultPassword).mustChangePassword, true);
});

test('GAS concurrent reset stops an authenticated administrator before account creation', () => {
  const gas = fixture(), scope = { ...ALL, sources: ['TPHCM'] }, issued = create(gas, 'race.admin', 'ADMIN', scope);
  const session = change(gas, login(gas, issued.user.username, issued.defaultPassword), issued.defaultPassword);
  let resetState;
  beforeNextSnapshot(gas, () => {
    successful(gas, 'users.resetPassword', { id: issued.user.id }, gas.admin.sessionToken);
    resetState = snapshot(gas);
  });
  const result = rpc(gas, 'users.create', { username: 'race.staff', displayName: 'Race staff', role: 'VIEWER', scope }, session.sessionToken);
  assert.equal(result.error.code, 'AUTH_REQUIRED');
  assert.equal(snapshot(gas), resetState);
});

test('GAS old authenticated actor cannot issue or revoke collector grants after password rotation', () => {
  const gas = fixture(), stale = gas.app.Auth.authenticate(gas.admin.sessionToken);
  const renewed = change(gas, gas.admin, CHANGED, 'SYNTHETIC-admin-rotated-2026!');
  const collector = successful(gas, 'extension.tokens.create', { sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn' }, renewed.sessionToken);
  const before = snapshot(gas);
  assert.throws(() => gas.app.Auth.createCollector(stale, { sourceSystem: 'TPHCM', hostname: 'motcua.tphcm.gov.vn' }), { code: 'AUTH_REQUIRED' });
  assert.throws(() => gas.app.Auth.revokeCollector(stale, { id: collector.id }), { code: 'AUTH_REQUIRED' });
  assert.equal(snapshot(gas), before);
  assert.equal(gas.app.Auth.collector(collector.token, 'TPHCM', 'motcua.tphcm.gov.vn').id, gas.adminId);
});
