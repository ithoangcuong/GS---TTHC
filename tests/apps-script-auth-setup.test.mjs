import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gasRuntime } from './helpers/apps-script.mjs';

const MODULES = ['Utils', 'Crypto', 'Passwords', 'SheetRepository', 'Settings', 'Audit', 'Permissions', 'Users', 'Auth', 'Router', 'Setup'];
const REQUIRED = ['SPREADSHEET_ID', 'DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEY_ID', 'LOOKUP_PEPPER'];
const snapshot = gas => JSON.stringify([...gas.sheets].map(([name, sheet]) => [name, sheet.rows]));
function provision() {
  const gas = gasRuntime(MODULES);
  gas.context.setupTthcMonitor_();
  gas.context.bootstrapAdmin_();
  gas.calls.length = 0;
  return gas;
}
function mutateAdmin(gas, update) {
  const current = gas.app.Repo.read('USERS')[0];
  gas.app.Repo.writeBatch('USERS', [{ ...current, ...update }], 'user_id');
  gas.calls.length = 0;
}
function assertNoWrites(gas, before) {
  assert.equal(snapshot(gas), before);
  assert.equal(gas.calls.filter(call => call.op === 'write' || call.op === 'urlfetch').length, 0);
}

test('GAS public readiness requires local storage and crypto configuration without email/OAuth or account reads', () => {
  const gas = gasRuntime(MODULES);
  for (const property of ['EMAIL_PEPPER', 'BOOTSTRAP_EMAIL', 'DEFAULT_USER_PASSWORD', 'BOOTSTRAP_PASSWORD']) gas.properties.delete(property);
  gas.context.SpreadsheetApp.openById = () => { throw new Error('Public diagnostics must not read account data'); };
  const complete = gas.plain(gas.app.Auth.config());
  assert.equal(complete.configured, true);
  assert.deepEqual(complete.setupIssues, []);
  const serialized = JSON.stringify(complete);
  for (const property of REQUIRED) assert.ok(!serialized.includes(gas.properties.get(property)));
  for (const property of REQUIRED) {
    const value = gas.properties.get(property);
    gas.properties.delete(property);
    const result = gas.plain(gas.app.Router.rpc('auth.config', {}, ''));
    assert.equal(result.ok, true);
    assert.equal(result.data.configured, false);
    assert.deepEqual(result.data.setupIssues, [{ property, reason: 'missing' }]);
    gas.properties.set(property, value);
  }
  assert.equal(gas.sheets.size, 0);
  assert.equal(gas.calls.length, 0);
});

test('GAS malformed readiness stops password login before any account read or session issue', () => {
  const gas = gasRuntime(MODULES), cachePuts = [];
  const put = gas.cache.put;
  gas.cache.put = (...args) => { cachePuts.push(args[0]); return put(...args); };
  const invalid = [
    ['SPREADSHEET_ID', 'short'], ['SPREADSHEET_ID', 'https://docs.google.com/spreadsheets/d/a'],
    ['DATA_ENCRYPTION_KEY', 'g'.repeat(128)], ['DATA_ENCRYPTION_KEY', 'a'.repeat(64)],
    ['DATA_ENCRYPTION_KEY_ID', 'invalid key'], ['DATA_ENCRYPTION_KEY_ID', 'a'.repeat(65)],
    ['LOOKUP_PEPPER', 'l'.repeat(31)]
  ];
  for (const [property, value] of invalid) {
    const original = gas.properties.get(property);
    gas.properties.set(property, value);
    assert.deepEqual(gas.plain(gas.app.Auth.config()).setupIssues, [{ property, reason: 'invalid' }]);
    const result = gas.plain(gas.app.Router.rpc('auth.login', { username: 'admin', password: 'SYNTHETIC-login-password' }, ''));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'CONFIGURATION_ERROR');
    assert.ok(result.error.message.includes(property));
    assert.ok(!result.error.message.includes(value));
    assert.equal(cachePuts.length, 0);
    gas.properties.set(property, original);
  }
  assert.equal(gas.calls.length, 0);
});

test('GAS Editor verification reads credentialed encrypted admin without creating a session or exposing secrets', () => {
  const gas = provision(), before = snapshot(gas), properties = JSON.stringify(Object.fromEntries(gas.properties)), logs = [];
  gas.context.console.log = value => logs.push(JSON.parse(value));
  const result = gas.plain(gas.context.verifyAdminLogin_());
  assert.equal(result.ok, true);
  assert.equal(result.configured, true);
  assert.equal(result.passwordLoginReady, true);
  assert.equal(result.username, 'admin');
  assert.equal(result.adminRole, 'SUPER_ADMIN');
  assert.equal(result.adminStatus, 'ACTIVE');
  assert.equal(result.tablesValidated, 11);
  assert.equal(result.sheetDataWritten, false);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assertNoWrites(gas, before);
  assert.equal(JSON.stringify(Object.fromEntries(gas.properties)), properties);
  const output = JSON.stringify({ result, logs });
  for (const property of [...REQUIRED, 'BOOTSTRAP_EMAIL', 'BOOTSTRAP_PASSWORD', 'DEFAULT_USER_PASSWORD']) assert.ok(!output.includes(gas.properties.get(property)));
  assert.ok(!output.includes('ciphertext'));
  assert.ok(logs.some(entry => entry.event === 'ADMIN_LOGIN_SETUP_VERIFIED'));
  assert.throws(() => gas.app.Auth.authenticate(''), { code: 'AUTH_REQUIRED' });
  assert.equal(gas.app.Router.rpc('users.list', {}, '').error.code, 'AUTH_REQUIRED');
  assert.equal(gas.app.Router.rpc('verifyAdminLogin_', {}, '').error.code, 'AUTH_REQUIRED');
  assert.match(readFileSync('apps-script/Setup.gs', 'utf8'), /^function verifyAdminLogin_\(\)/m);
});

test('GAS Editor verification denies nonowners and missing, disabled or downgraded admin without changing USERS', () => {
  for (const scenario of ['activeStranger', 'effectiveStranger', 'missing', 'disabled', 'downgraded']) {
    const gas = provision();
    if (scenario === 'activeStranger') gas.context.Session.getActiveUser = () => ({ getEmail: () => 'stranger@example.test' });
    if (scenario === 'effectiveStranger') gas.context.Session.getEffectiveUser = () => ({ getEmail: () => 'stranger@example.test' });
    if (scenario === 'missing') gas.sheets.get('USERS').rows = gas.sheets.get('USERS').rows.slice(0, 1);
    if (scenario === 'disabled') mutateAdmin(gas, { status: 'DISABLED' });
    if (scenario === 'downgraded') mutateAdmin(gas, { role: 'ADMIN' });
    const before = snapshot(gas);
    assert.throws(() => gas.context.verifyAdminLogin_(), { code: scenario.includes('Stranger') ? 'SETUP_DENIED' : 'ADMIN_NOT_READY' });
    assertNoWrites(gas, before);
  }
});

test('GAS verification detects mismatched encrypted username, broken credentials, key and scope without replacing data', () => {
  for (const scenario of ['differentUsername', 'tamper', 'credentials', 'wrongKey', 'invalidScope', 'offline']) {
    const gas = provision();
    if (scenario === 'differentUsername') mutateAdmin(gas, { username_encrypted: gas.app.Crypto.encrypt('another.admin') });
    if (scenario === 'tamper') {
      const encrypted = JSON.parse(gas.app.Repo.read('USERS')[0].username_encrypted);
      const bytes = Buffer.from(encrypted.ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1;
      mutateAdmin(gas, { username_encrypted: JSON.stringify({ ...encrypted, ciphertext: bytes.toString('base64') }) });
    }
    if (scenario === 'credentials') mutateAdmin(gas, { password_hash: '' });
    if (scenario === 'wrongKey') gas.properties.set('DATA_ENCRYPTION_KEY', 'ab'.repeat(64));
    if (scenario === 'invalidScope') mutateAdmin(gas, { scope: 'not-json' });
    if (scenario === 'offline') gas.setCryptoOffline(true);
    const before = snapshot(gas), properties = JSON.stringify(Object.fromEntries(gas.properties));
    const code = { differentUsername: 'ADMIN_IDENTITY_MISMATCH', tamper: 'CRYPTO_INVALID', credentials: 'ADMIN_NOT_READY', wrongKey: 'CRYPTO_INVALID', invalidScope: 'ACCESS_DENIED', offline: 'CRYPTO_UNAVAILABLE' }[scenario];
    assert.throws(() => gas.context.verifyAdminLogin_(), { code });
    assertNoWrites(gas, before);
    assert.equal(JSON.stringify(Object.fromEntries(gas.properties)), properties);
  }
});

test('GAS Editor verification fails safely for missing settings, schema damage, blocked storage and unexpected failures', () => {
  for (const scenario of ['missingKey', 'missingSheet', 'schema', 'blocked', 'accessError']) {
    const gas = provision(), logs = [];
    gas.context.console.log = value => logs.push(JSON.parse(value));
    if (scenario === 'missingKey') gas.properties.delete('LOOKUP_PEPPER');
    if (scenario === 'missingSheet') gas.sheets.delete('AUDIT_LOGS');
    if (scenario === 'schema') gas.sheets.get('USERS').rows[0][0] = 'legacy_email';
    if (scenario === 'blocked') gas.properties.set('REPOSITORY_PENDING', 'synthetic-interrupted');
    if (scenario === 'accessError') gas.context.SpreadsheetApp.openById = () => { throw new Error('SYNTHETIC_SERVICE_FAILURE_WITH_PRIVATE_TEXT'); };
    const before = snapshot(gas);
    const code = { missingKey: 'CONFIGURATION_ERROR', missingSheet: 'SHEET_MISSING', schema: 'SHEET_SCHEMA_CONFLICT', blocked: 'REPOSITORY_BLOCKED', accessError: 'SETUP_VERIFICATION_FAILED' }[scenario];
    assert.throws(() => gas.context.verifyAdminLogin_(), error => {
      assert.equal(error.code, code);
      assert.ok(!error.message.includes('SYNTHETIC_SERVICE_FAILURE_WITH_PRIVATE_TEXT'));
      return true;
    });
    assertNoWrites(gas, before);
    assert.deepEqual(logs.at(-1), { level: 'ERROR', event: 'ADMIN_LOGIN_SETUP_FAILED', code });
  }
});
