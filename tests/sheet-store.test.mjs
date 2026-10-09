import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.mjs';
import { syncBatch } from '../server/cases.mjs';
import { GoogleSheetStore, JOURNAL_HEADERS, BUSINESS_TABLES } from '../server/sheet-store.mjs';

const ID = '18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU';
class FakeSheets {
  spreadsheetId = ID;
  rows = [];
  tabs = ['Permissions'];
  writes = [];
  offline = false;
  appendFailure = null;
  readFailure = false;
  async request(method, suffix, body) {
    if (this.offline) throw new Error('remote unavailable secret-value');
    if (method === 'GET' && suffix === '?fields=sheets.properties') return { sheets: this.tabs.map(title => ({ properties: { title, gridProperties: { rowCount: Math.max(1000, this.rows.length), columnCount: 10 } } })) };
    if (suffix === ':batchUpdate') { this.tabs.push(body.requests[0].addSheet.properties.title); return {}; }
    if (method === 'PUT') { this.rows[0] = structuredClone(body.values[0]); return {}; }
    if (method === 'POST' && suffix.includes(':append')) {
      this.writes.push(structuredClone(body.values));
      if (this.appendFailure === 'before') { this.appendFailure = null; throw new Error('write unavailable secret'); }
      if (this.appendFailure === 'partial') { this.appendFailure = null; this.rows.push(...structuredClone(body.values.slice(0, 1))); throw new Error('partial write'); }
      this.rows.push(...structuredClone(body.values));
      if (this.appendFailure === 'after') { this.appendFailure = null; throw new Error('lost response after successful write'); }
      return { updates: { updatedRange: `GS_Data!A${this.rows.length - body.values.length + 1}:I${this.rows.length}` } };
    }
    throw new Error(`Unhandled fake call: ${method} ${suffix}`);
  }
  async readValues(range) {
    if (this.offline || this.readFailure) throw new Error('read unavailable private-token');
    const matches = /!A(\d+):[IJ](\d+)$/.exec(range);
    assert.ok(matches, range);
    return structuredClone(this.rows.slice(Number(matches[1]) - 1, Number(matches[2])));
  }
}
async function fixture(t) {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const client = new FakeSheets(); const store = new GoogleSheetStore(db, { client });
  await store.initialize(); return { db, client, store };
}
function putSetting(db, key, value) { db.prepare('INSERT INTO system_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
function newCache(t) { const db = openDatabase(':memory:'); t.after(() => db.close()); return db; }

test('bootstraps dedicated managed tab, confirms seeds and captures every business table', async t => {
  const { db, client, store } = await fixture(t);
  assert.deepEqual(client.rows[0], JOURNAL_HEADERS);
  assert.ok(client.tabs.includes('GS_Data')); assert.equal(store.status().pendingEvents, 0); assert.equal(store.status().ready, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'sheet_outbox_%'").get().n, BUSINESS_TABLES.length * 3);
  assert.ok(client.rows.slice(1).some(row => row[2] === 'source_systems'));
  assert.ok(client.rows.at(-1)[4] === 'COMMIT');
});

test('mutations, history, aliases, deletes and audit survive recovery into a new cache', async t => {
  const { db, client, store } = await fixture(t);
  const user = { id: 'sheet-test', role: 'SYSTEM_ADMIN', scope: {} };
  const result = syncBatch(db, { sourceSystem: 'MOC', records: [{ caseCode: 'SHEET-001', sourceRecordId: 'remote-1', normalizedStatus: 'PROCESSING', dueAt: '2030-01-01T10:00:00Z' }] }, user);
  assert.equal(result.created, 1);
  putSetting(db, 'temporary', { value: 1 }); await store.flush();
  db.prepare("DELETE FROM system_settings WHERE key='temporary'").run(); await store.flush();
  const restored = newCache(t); await new GoogleSheetStore(restored, { client }).initialize();
  assert.equal(restored.prepare('SELECT caseCode FROM cases').get().caseCode, 'SHEET-001');
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM cases').get().n, 1);
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM case_aliases').get().n, db.prepare('SELECT COUNT(*) n FROM case_aliases').get().n);
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM case_history').get().n, db.prepare('SELECT COUNT(*) n FROM case_history').get().n);
  assert.equal(restored.prepare("SELECT value FROM system_settings WHERE key='temporary'").get(), undefined);
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n);
});

test('password hashes, session/collector secrets and outbox metadata are never uploaded', async t => {
  const { db, client, store } = await fixture(t);
  db.prepare('INSERT INTO users(id,username,displayName,passwordHash,role,scope,active,createdAt,googleSubject,email) VALUES (?,?,?,?,?,?,?,?,?,?)').run('u1', 'google.user1', 'User', 'DO-NOT-UPLOAD-HASH', 'SYSTEM_ADMIN', '{}', 1, Date.now(), 'sub1', 'user@example.com');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('PRIVATE-SESSION-HASH', 'u1', 'PRIVATE-CSRF', Date.now() + 100000);
  db.prepare('INSERT INTO collector_tokens VALUES (?,?,?)').run('PRIVATE-COLLECTOR-HASH', 'u1', Date.now() + 100000);
  await store.flush(); const text = JSON.stringify(client.rows);
  for (const secret of ['DO-NOT-UPLOAD-HASH', 'PRIVATE-SESSION-HASH', 'PRIVATE-CSRF', 'PRIVATE-COLLECTOR-HASH', 'passwordHash', 'sessions', 'collector_tokens', 'sheet_store_outbox']) assert.equal(text.includes(secret), false, secret);
  const restored = newCache(t); await new GoogleSheetStore(restored, { client }).initialize();
  const user = restored.prepare('SELECT * FROM users WHERE id=?').get('u1');
  assert.equal(user.email, 'user@example.com'); assert.equal(user.googleSubject, 'sub1'); assert.notEqual(user.passwordHash, 'DO-NOT-UPLOAD-HASH');
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
});

test('outage fails durability confirmation, leaves pending changes and exposes no remote secrets', async t => {
  const { db, client, store } = await fixture(t);
  putSetting(db, 'pending', { pending: true }); client.offline = true;
  await assert.rejects(store.flush(), { code: 'SHEET_DURABILITY_FAILED' });
  assert.equal(store.status().pendingEvents, 1); assert.equal(JSON.stringify(store.status()).includes('secret'), false);
  client.offline = false; await store.flush();
  assert.equal(store.status().pendingEvents, 0); assert.equal(store.status().lastError, null);
});

test('ambiguous response after committed write is acknowledged on retry without duplicating it', async t => {
  const { db, client, store } = await fixture(t);
  putSetting(db, 'ambiguous', { hello: 'world' }); client.appendFailure = 'after';
  await assert.rejects(store.flush(), { code: 'SHEET_DURABILITY_FAILED' });
  const writes = client.writes.length; await store.flush();
  assert.equal(client.writes.length, writes); assert.equal(store.status().pendingEvents, 0);
  const restored = newCache(t); await new GoogleSheetStore(restored, { client }).initialize();
  assert.equal(JSON.parse(restored.prepare("SELECT value FROM system_settings WHERE key='ambiguous'").get().value).hello, 'world');
});

test('partial write remains invisible until committed; duplicate retry parts are safe', async t => {
  const { db, client, store } = await fixture(t);
  putSetting(db, 'first-part', 'not yet durable'); putSetting(db, 'second-part', 'not yet durable');
  client.appendFailure = 'partial'; await assert.rejects(store.flush());
  const prior = newCache(t); await new GoogleSheetStore(prior, { client }).initialize();
  assert.equal(prior.prepare("SELECT 1 FROM system_settings WHERE key='first-part'").get(), undefined);
  await store.flush(); assert.equal(store.status().pendingEvents, 0);
  const restored = newCache(t); await new GoogleSheetStore(restored, { client }).initialize();
  assert.ok(restored.prepare("SELECT 1 FROM system_settings WHERE key='first-part'").get());
  assert.ok(restored.prepare("SELECT 1 FROM system_settings WHERE key='second-part'").get());
});

test('cell/request chunks reassemble a large Unicode payload and concurrent flushes do not duplicate', async t => {
  const { db, client, store } = await fixture(t);
  const large = 'ồ😀'.repeat(250000);
  putSetting(db, 'large', large); await Promise.all([store.flush(), store.flush(), store.flush()]);
  for (const row of client.rows.slice(1)) assert.ok(row[7].length <= 40000);
  for (const values of client.writes) assert.ok(Buffer.byteLength(JSON.stringify({ majorDimension: 'ROWS', values })) <= 1800000);
  const restored = newCache(t); await new GoogleSheetStore(restored, { client }).initialize();
  assert.equal(JSON.parse(restored.prepare("SELECT value FROM system_settings WHERE key='large'").get().value), large);
  assert.equal(store.status().pendingEvents, 0);
});

test('committed corruption refuses recovery without touching existing cache', async t => {
  const { db, client, store } = await fixture(t);
  putSetting(db, 'verified', 'value'); await store.flush();
  const row = client.rows.find(row => row[2] === 'system_settings' && row[3] === '["verified"]'); row[7] = row[7].replace('value', 'altered');
  await assert.rejects(new GoogleSheetStore(db, { client }).initialize(), { code: 'SHEET_JOURNAL_CORRUPT' });
  assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='verified'").get().value, '"value"');
});

test('unrecognized tab content and an existing populated local database are never overwritten', async t => {
  const db = newCache(t); const client = new FakeSheets(); client.tabs.push('GS_Data'); client.rows.push(['custom existing data']);
  await assert.rejects(new GoogleSheetStore(db, { client }).initialize(), { code: 'SHEET_HEADER_CONFLICT' });
  assert.deepEqual(client.rows, [['custom existing data']]);
  client.rows = []; db.prepare('INSERT INTO agencies(id,sourceSystem,name) VALUES (?,?,?)').run('real-agency', 'MOC', 'Real');
  await assert.rejects(new GoogleSheetStore(db, { client }).initialize(), { code: 'SHEET_CACHE_NOT_EMPTY' });
  assert.equal(client.rows.length, 0);
});

test('same cache preserves queued changes across restart and rejects workbook changes/truncation', async t => {
  const { db, client, store } = await fixture(t);
  putSetting(db, 'durable', 1); await store.flush();
  putSetting(db, 'queued', 2); client.appendFailure = 'before'; await assert.rejects(store.flush());
  const restarted = new GoogleSheetStore(db, { client }); await restarted.initialize();
  assert.equal(JSON.parse(db.prepare("SELECT value FROM system_settings WHERE key='queued'").get().value), 2);
  assert.equal(restarted.status().pendingEvents, 0);
  await assert.rejects(new GoogleSheetStore(db, { client, spreadsheetId: 'different_sheet_id' }).initialize(), { code: 'SHEET_CACHE_CONFLICT' });
  client.rows = [client.rows[0]];
  await assert.rejects(new GoogleSheetStore(db, { client }).initialize(), { code: 'SHEET_JOURNAL_TRUNCATED' });
  assert.ok(db.prepare("SELECT 1 FROM system_settings WHERE key='durable'").get());
});

test('only sanitized user changes enqueue events; local sessions survive cache restart', async t => {
  const { db, client, store } = await fixture(t);
  db.prepare('INSERT INTO users(id,username,displayName,passwordHash,role,scope,active,createdAt,googleSubject,email) VALUES (?,?,?,?,?,?,?,?,?,?)').run('u2', 'google.user2', 'User', 'local-hash', 'VIEWER', '{"sourceSystems":["MOC"]}', 1, Date.now(), 'sub2', 'second@example.com'); await store.flush();
  db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run('changed-private-hash', 'u2');
  assert.equal(store.status().pendingEvents, 0);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run('local-session', 'u2', 'local-csrf', Date.now() + 10000);
  await new GoogleSheetStore(db, { client }).initialize();
  assert.equal(db.prepare('SELECT passwordHash FROM users WHERE id=?').get('u2').passwordHash, 'changed-private-hash');
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE tokenHash=?').get('local-session'));
});

test('a changed primary key deletes the old durable identity rather than leaving a duplicate', async t => {
  const { db, client, store } = await fixture(t);
  db.prepare('INSERT INTO agencies(id,sourceSystem,name) VALUES (?,?,?)').run('old-id', 'MOC', 'Agency'); await store.flush();
  db.prepare('UPDATE agencies SET id=? WHERE id=?').run('new-id', 'old-id'); await store.flush();
  const restored = newCache(t); await new GoogleSheetStore(restored, { client }).initialize();
  assert.deepEqual(restored.prepare('SELECT id FROM agencies').all().map(row => row.id), ['new-id']);
});

test('an append is not acknowledged if reading its COMMIT fails, and retry confirms it', async t => {
  const { db, client, store } = await fixture(t);
  putSetting(db, 'confirm-read', { confirmed: true }); client.readFailure = true;
  await assert.rejects(store.flush(), { code: 'SHEET_DURABILITY_FAILED' });
  assert.equal(store.status().pendingEvents, 1);
  const writes = client.writes.length; client.readFailure = false; await store.flush();
  assert.equal(client.writes.length, writes); assert.equal(store.status().pendingEvents, 0);
});
