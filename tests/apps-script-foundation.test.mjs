import test from 'node:test';
import assert from 'node:assert/strict';
import { gasRuntime } from './helpers/apps-script.mjs';

test('request reads are isolated, refreshed on revision/lock changes and fail closed', () => {
  const gas = gasRuntime(); gas.context.setupTthcMonitor_();
  const repo = gas.app.Repo;
  repo.withRequest(() => {
    const rows = repo.read('SOURCES'), id = rows[0].source_id;
    rows[0].name = 'not saved';
    assert.notEqual(repo.read('SOURCES')[0].name, 'not saved');
    repo.writeBatch('SOURCES', [{ ...repo.read('SOURCES')[0], name: 'Saved' }], 'source_id');
    assert.equal(repo.read('SOURCES').find(row => row.source_id === id).name, 'Saved');
    const nameColumn = repo.schemas.SOURCES.indexOf('name');
    gas.sheets.get('SOURCES').rows[1][nameColumn] = 'Concurrent update';
    gas.properties.set('DATA_REVISION', String(repo.revision() + 1));
    assert.equal(repo.read('SOURCES')[0].name, 'Concurrent update');
    gas.properties.set('REPOSITORY_PENDING', 'pending');
    assert.throws(() => repo.read('SOURCES'), { code: 'REPOSITORY_BLOCKED' });
    gas.properties.delete('REPOSITORY_PENDING');
  });
  gas.calls.length = 0;
  repo.withRequest(() => repo.read('SOURCES'));
  assert.equal(gas.calls.filter(call => call.op === 'read' && call.startRow === 2).length, 1);
});

test('GAS setup is idempotent and existing conflicting sheets are preserved', () => {
  const gas = gasRuntime();
  gas.context.setupTthcMonitor_(); gas.context.setupTthcMonitor_();
  assert.equal(gas.sheets.size, 11);
  assert.equal(gas.app.Repo.read('SOURCES').length, 11);
  assert.ok(gas.app.Repo.read('SOURCES').every(source => source.adapter_status === 'WAITING_FOR_SAMPLE'));
  const before = JSON.stringify(gas.sheets.get('SOURCES').rows);
  gas.sheets.get('USERS').rows[0][0] = 'existing_email';
  assert.throws(() => gas.context.setupSpreadsheet_(), { code: 'SHEET_SCHEMA_CONFLICT' });
  assert.equal(JSON.stringify(gas.sheets.get('SOURCES').rows), before);
});

test('GAS bundled cipher Unicode/object roundtrip, salted lookup and tamper fail closed', () => {
  const gas = gasRuntime(), value = { email: 'án@example.test', label: 'Hồ sơ 01', nested: [1, true] };
  const encrypted = gas.app.Crypto.encrypt(value);
  assert.ok(!encrypted.includes(value.email));
  assert.deepEqual(gas.plain(gas.app.Crypto.decrypt(encrypted)), value);
  assert.notEqual(gas.app.Crypto.encrypt(value), encrypted);
  const key = gas.app.Crypto.hashLookupKey('case:TPHCM:CODE:01');
  assert.equal(key, gas.app.Crypto.hashLookupKey('case:TPHCM:CODE:01'));
  assert.notEqual(key, gas.app.Crypto.hashLookupKey('case:MOF:CODE:01'));
  assert.notEqual(gas.app.Crypto.hashLookupKey('email:staff@example.test'), gas.app.Crypto.hashLookupKey('staff@example.test'));
  assert.match(gas.app.Crypto.hashLookupKey('dashboard:' + 'permitted-scope-'.repeat(700)), /^[a-f0-9]{64}$/);
  assert.throws(() => gas.app.Crypto.hashLookupKey('x'.repeat(100001)), { code: 'INVALID_LOOKUP' });
  const envelope = JSON.parse(encrypted), bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1; envelope.ciphertext = bytes.toString('base64');
  assert.throws(() => gas.app.Crypto.decrypt(JSON.stringify(envelope)), { code: 'CRYPTO_INVALID' });
  gas.properties.delete('DATA_ENCRYPTION_KEY');
  assert.throws(() => gas.app.Crypto.encrypt(value), { code: 'CRYPTO_NOT_CONFIGURED' });
});

test('GAS local encryption batches run outside repository locks and old keys are explicit', () => {
  const gas = gasRuntime(), values = Array.from({ length: 101 }, (_, i) => ({ i }));
  const encrypted = gas.app.Crypto.encryptMany(values);
  assert.deepEqual(gas.plain(gas.app.Crypto.decryptMany(encrypted)), values);
  const first = encrypted[0], originalKey = gas.properties.get('DATA_ENCRYPTION_KEY');
  gas.properties.set('DATA_ENCRYPTION_KEY_ID', 'test-key-v2');
  gas.properties.set('DATA_ENCRYPTION_KEY', 'a'.repeat(128));
  assert.throws(() => gas.app.Crypto.decrypt(first), { code: 'CRYPTO_KEY_UNAVAILABLE' });
  gas.properties.set('DATA_ENCRYPTION_PREVIOUS_KEYS', JSON.stringify({ 'test-key-v1': originalKey }));
  assert.deepEqual(gas.plain(gas.app.Crypto.decrypt(first)), { i: 0 });
  assert.ok(gas.calls.filter(call => call.op === 'crypto').length >= 202);
  assert.ok(gas.calls.filter(call => call.op === 'crypto').every(call => !call.locked));
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS Editor crypto verification is owner-only, writes no sheet data and rejects missing/failed crypto', () => {
  const gas = gasRuntime();
  const result = gas.context.verifyCrypto_();
  assert.equal(result.ok, true); assert.equal(result.cryptoVersion, 'aes-siv-v1'); assert.equal(result.sheetDataWritten, false);
  assert.equal(gas.sheets.size, 0);
  assert.equal(gas.calls.filter(call => call.op === 'crypto').length, 2);
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
  assert.ok(!JSON.stringify(result).includes('ciphertext'));
  const key = gas.properties.get('DATA_ENCRYPTION_KEY');
  gas.properties.delete('DATA_ENCRYPTION_KEY');
  assert.throws(() => gas.context.verifyCrypto_(), { code: 'CRYPTO_NOT_CONFIGURED' });
  gas.properties.set('DATA_ENCRYPTION_KEY', key);
  gas.setCryptoOffline(true);
  assert.throws(() => gas.context.verifyCrypto_(), { code: 'CRYPTO_UNAVAILABLE' });
  gas.properties.set('BOOTSTRAP_EMAIL', 'stranger@example.test');
  assert.throws(() => gas.context.verifyCrypto_(), { code: 'SETUP_DENIED' });
  assert.equal(gas.sheets.size, 0);
});

test('GAS bootstrap is owner-only, encrypted, one-time and preserves existing users', () => {
  const gas = gasRuntime(); gas.context.setupTthcMonitor_();
  gas.context.bootstrapAdmin_();
  const users = gas.app.Repo.read('USERS'); assert.equal(users.length, 1); assert.equal(users[0].role, 'SUPER_ADMIN');
  assert.ok(!JSON.stringify(gas.sheets.get('USERS').rows).includes('owner@example.test'));
  assert.throws(() => gas.context.bootstrapAdmin_(), { code: 'BOOTSTRAP_CLOSED' });
  gas.properties.set('BOOTSTRAP_EMAIL', 'stranger@example.test');
  assert.throws(() => gas.context.setupSpreadsheet_(), { code: 'SETUP_DENIED' });
});

test('GAS confirmed status mapping requires owner evidence, rejects unsafe labels and preserves valid mappings', () => {
  const gas = gasRuntime(['Utils', 'Crypto', 'SheetRepository', 'Settings', 'Audit', 'Sources', 'Cases', 'Setup']);
  gas.context.setupTthcMonitor_();
  const configure = (sourceStatus, normalizedStatus = 'PROCESSING', evidence = 'SYNTHETIC TEST EVIDENCE') => {
    gas.properties.set('VERIFIED_STATUS_MAPPING_JSON', JSON.stringify({ sourceSystem: 'TPHCM', evidence, statusMappings: { [sourceStatus]: normalizedStatus } }));
    return gas.context.configureStatusMapping_();
  };
  assert.deepEqual(gas.plain(configure('SYNTHETIC_PROCESSING')), { sourceSystem: 'TPHCM', confirmedMappings: 1 });
  const rows = gas.app.Repo.read('STATUS_MAPPING');
  assert.equal(rows[0].confirmed, true);
  assert.equal(rows[0].mapping_id, gas.app.Crypto.hashLookupKey('status:TPHCM:SYNTHETIC_PROCESSING'));
  const before = JSON.stringify(rows);
  for (const label of [' SYNTHETIC_PROCESSING', 'SYNTHETIC_PROCESSING ', '__proto__', 'constructor', 'prototype', '']) {
    assert.throws(() => configure(label), { code: 'INVALID_MAPPING' });
  }
  assert.throws(() => configure('NEW_LABEL', 'INVENTED_STATUS'), { code: 'INVALID_MAPPING' });
  assert.throws(() => configure('NEW_LABEL', 'PROCESSING', ''), { code: 'INVALID_MAPPING' });
  assert.equal(JSON.stringify(gas.app.Repo.read('STATUS_MAPPING')), before);
  gas.properties.set('BOOTSTRAP_EMAIL', 'stranger@example.test');
  assert.throws(() => configure('NEW_LABEL'), { code: 'SETUP_DENIED' });
  assert.equal(JSON.stringify(gas.app.Repo.read('STATUS_MAPPING')), before);
});

test('GAS repository serializes dedup upserts, rejects stale snapshots and rolls back partial writes', () => {
  const gas = gasRuntime(); gas.context.setupTthcMonitor_();
  const revision = gas.app.Repo.revision();
  gas.app.Repo.writeBatch('SETTINGS', [{ key: 'warningSeconds', value: '180000', updated_at: '2026-10-06T00:00:00Z' }], 'key', { expectedRevision: revision });
  assert.throws(() => gas.app.Repo.writeBatch('SETTINGS', [{ key: 'warningSeconds', value: '1' }], 'key', { expectedRevision: revision }), { code: 'CONFLICT' });
  const prior = JSON.stringify(gas.app.Repo.read('SETTINGS')), revision2 = gas.app.Repo.revision();
  gas.failWrites('SOURCES');
  assert.throws(() => gas.app.Repo.commit([
    { table: 'SETTINGS', keyField: 'key', rows: [{ key: 'warningSeconds', value: '3' }] },
    { table: 'SOURCES', keyField: 'source_id', rows: [{ ...gas.app.Repo.read('SOURCES')[0], synced_count: 20 }] }
  ], revision2), { code: 'SHEET_WRITE_FAILED' });
  assert.equal(JSON.stringify(gas.app.Repo.read('SETTINGS')), prior); assert.equal(gas.app.Repo.revision(), revision2);
  assert.equal(gas.properties.has('REPOSITORY_PENDING'), false);
  assert.ok(gas.calls.filter(call => call.op === 'write').every(call => call.locked));
});

test('GAS killed write or failed rollback blocks all further reads and writes', () => {
  const gas = gasRuntime(); gas.context.setupTthcMonitor_();
  gas.properties.set('REPOSITORY_PENDING', '{"id":"synthetic-interrupted"}');
  assert.throws(() => gas.app.Repo.read('CASES'), { code: 'REPOSITORY_BLOCKED' });
  assert.throws(() => gas.app.Repo.writeBatch('SETTINGS', [{ key: 'warningSeconds', value: '2' }], 'key'), { code: 'REPOSITORY_BLOCKED' });
  gas.properties.delete('REPOSITORY_PENDING');
  gas.failWrites('SETTINGS', 2);
  assert.throws(() => gas.app.Repo.writeBatch('SETTINGS', [{ key: 'warningSeconds', value: '2' }], 'key'), { code: 'SHEET_WRITE_FAILED' });
  assert.equal(gas.properties.has('REPOSITORY_BLOCKED'), true);
});

test('GAS repository updates contiguous rows in a single range without rewriting 10000 cases', () => {
  const gas = gasRuntime(); gas.context.setupTthcMonitor_();
  const rows = Array.from({ length: 10000 }, (_, i) => ({ record_id: `case-${i}`, case_key_hash: `hash-${i}`, source_id: 'TPHCM', payload_encrypted: '{}' }));
  gas.app.Repo.writeBatch('CASES', rows, 'record_id');
  gas.calls.length = 0;
  gas.app.Repo.writeBatch('CASES', rows.slice(40, 140).map(row => ({ ...row, alert_index: 'WARNING' })), 'record_id');
  const writes = gas.calls.filter(call => call.op === 'write');
  assert.equal(writes.length, 1); assert.equal(writes[0].rowCount, 100); assert.equal(gas.app.Repo.read('CASES').length, 10000);
});

test('GAS dates reject rollover, date-only input and absent timezone; VN dates use +07', () => {
  const gas = gasRuntime();
  assert.equal(gas.app.Utils.parseDate('06/10/2026 07:32:00'), '2026-10-06T00:32:00.000Z');
  for (const value of ['31/02/2026 07:32:00','2026-02-31T00:00:00Z','2026-10-06','2026-10-06T07:32:00','2026-10-06T24:00:00Z']) assert.throws(() => gas.app.Utils.parseDate(value), { code: 'INVALID_DATE' });
});
