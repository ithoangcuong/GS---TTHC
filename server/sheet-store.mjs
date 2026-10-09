import { createHash, randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';

// Parent tables precede their children. Authentication sessions and secret material
// deliberately have no place in the shared workbook.
export const BUSINESS_TABLES = Object.freeze([
  'source_systems', 'users', 'source_field_mappings', 'source_status_mappings',
  'agencies', 'departments', 'officers', 'procedures', 'sync_jobs', 'alert_rules',
  'cases', 'case_aliases', 'case_history', 'alerts', 'alert_history', 'notifications',
  'system_settings', 'audit_logs',
]);
export const JOURNAL_HEADERS = Object.freeze(['eventId', 'batchId', 'tableName', 'key', 'operation', 'partIndex', 'partCount', 'payload', 'checksum']);
const CELL_CHARS = 40000;
const REQUEST_BYTES = 1800000;
const READ_ROWS = 100;
const MAX_BATCH_EVENTS = 200;
const MAX_JOURNAL_ROWS = 1100000; // A workbook also has Google's independent cell quota.
const GOOGLE_ONLY_HASH = '0'.repeat(32) + ':' + '0'.repeat(128);
const nonBootstrap = BUSINESS_TABLES.filter(table => !['source_systems', 'source_field_mappings', 'source_status_mappings', 'alert_rules', 'system_settings'].includes(table));
const digest = value => createHash('sha256').update(value).digest('hex');
const eventChecksum = event => digest(JSON.stringify([event.tableName, event.key, event.operation, event.payload]));
const quote = name => `"${name.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;

export class SheetStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'SheetStoreError'; this.code = code; this.status = 503; }
}
const corrupt = () => new SheetStoreError('SHEET_JOURNAL_CORRUPT', 'Nhật ký dữ liệu Google Sheet không hợp lệ; dừng khôi phục để bảo vệ dữ liệu.');

function schemasFor(db) {
  return new Map(BUSINESS_TABLES.map(table => {
    const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
    if (!columns.length) throw new SheetStoreError('SHEET_SCHEMA_MISSING', 'Thiếu cấu trúc bộ nhớ đệm dữ liệu Google Sheet.');
    const keys = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    const shared = columns.filter(column => column.name !== 'passwordHash').map(column => column.name);
    if (!keys.length) throw new SheetStoreError('SHEET_SCHEMA_MISSING', 'Bảng dữ liệu chưa có khóa định danh.');
    return [table, { columns: shared, keys }];
  }));
}

function validateEvent(event, schemas) {
  const schema = schemas.get(event.tableName);
  if (!schema || !['UPSERT', 'DELETE'].includes(event.operation) || typeof event.key !== 'string' || typeof event.payload !== 'string') throw corrupt();
  let key, value;
  try { key = JSON.parse(event.key); value = JSON.parse(event.payload); } catch { throw corrupt(); }
  if (!Array.isArray(key) || key.length !== schema.keys.length || key.some(item => item === null || !['string', 'number'].includes(typeof item))) throw corrupt();
  if (event.operation === 'DELETE') {
    if (value !== null) throw corrupt();
  } else {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== schema.columns.length || Object.keys(value).some(column => !schema.columns.includes(column)) || schema.columns.some(column => !Object.hasOwn(value, column)) || schema.keys.some((column, index) => value[column] !== key[index])) throw corrupt();
    if (Object.values(value).some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) throw corrupt();
  }
  return { key, value };
}

function manifestFor(events) {
  const entries = events.map(event => [event.eventId, eventChecksum(event)]);
  return JSON.stringify({ events: entries, digest: digest(JSON.stringify(entries)) });
}

function rowsFor(batchId, events, manifest) {
  const rows = [];
  for (const event of events) {
    const parts = Math.max(1, Math.ceil(event.payload.length / CELL_CHARS));
    const checksum = eventChecksum(event);
    for (let index = 0; index < parts; index++) rows.push([event.eventId, batchId, event.tableName, event.key, event.operation, String(index), String(parts), event.payload.slice(index * CELL_CHARS, (index + 1) * CELL_CHARS), checksum]);
  }
  rows.push([`COMMIT:${batchId}`, batchId, '__COMMIT__', '', 'COMMIT', '0', '1', manifest, digest(manifest)]);
  return rows;
}

// Only a complete, checksummed COMMIT is replayable. Duplicate identical rows
// are normal after an ambiguous network failure; conflicting copies are not.
function decodeJournal(rows, schemas) {
  const batches = new Map(); const commits = []; const committedEvents = new Map();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index].map(value => value === null || value === undefined ? '' : String(value));
    if (row.length !== 9 || !row[1] || !/^[a-zA-Z0-9_-]{1,100}$/.test(row[1])) throw corrupt();
    const batch = batches.get(row[1]) || { parts: new Map(), commit: null, order: -1 };
    batches.set(row[1], batch);
    if (row[4] === 'COMMIT') {
      if (row[0] !== `COMMIT:${row[1]}` || row[2] !== '__COMMIT__' || row[3] !== '' || row[5] !== '0' || row[6] !== '1' || digest(row[7]) !== row[8]) throw corrupt();
      if (batch.commit !== null && batch.commit !== row[7]) throw corrupt();
      if (batch.commit === null) { batch.commit = row[7]; batch.order = index; commits.push(row[1]); }
    } else {
      const identity = `${row[0]}:${row[5]}`;
      const prior = batch.parts.get(identity);
      if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw corrupt();
      batch.parts.set(identity, row);
    }
  }
  const result = []; const committedBatches = new Map();
  for (const batchId of commits.sort((a, b) => batches.get(a).order - batches.get(b).order)) {
    const batch = batches.get(batchId); let manifest;
    try { manifest = JSON.parse(batch.commit); } catch { throw corrupt(); }
    if (!manifest || !Array.isArray(manifest.events) || !manifest.events.length || manifest.events.length > MAX_BATCH_EVENTS || manifest.digest !== digest(JSON.stringify(manifest.events))) throw corrupt();
    const ids = new Set(); const used = new Set();
    for (const entry of manifest.events) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry[0]) || ids.has(entry[0]) || !/^[a-f0-9]{64}$/.test(entry[1])) throw corrupt();
      ids.add(entry[0]);
      const first = batch.parts.get(`${entry[0]}:0`);
      if (!first || !/^\d+$/.test(first[6])) throw corrupt();
      const count = Number(first[6]);
      if (!Number.isSafeInteger(count) || count < 1 || count > 10000) throw corrupt();
      const parts = [];
      for (let part = 0; part < count; part++) {
        const identity = `${entry[0]}:${part}`; const row = batch.parts.get(identity);
        if (!row || row[5] !== String(part) || row[6] !== String(count) || row[2] !== first[2] || row[3] !== first[3] || row[4] !== first[4] || row[8] !== entry[1] || row[7].length > CELL_CHARS) throw corrupt();
        used.add(identity); parts.push(row[7]);
      }
      const event = { eventId: entry[0], batchId, tableName: first[2], key: first[3], operation: first[4], payload: parts.join('') };
      if (eventChecksum(event) !== entry[1]) throw corrupt();
      validateEvent(event, schemas);
      if (committedEvents.has(event.eventId)) {
        if (committedEvents.get(event.eventId) !== entry[1]) throw corrupt();
      } else { committedEvents.set(event.eventId, entry[1]); result.push(event); }
    }
    if (used.size !== batch.parts.size) throw corrupt();
    committedBatches.set(batchId, batch.commit);
  }
  return { events: result, committedBatches, committedEvents };
}

export class GoogleSheetStore {
  #db; #client; #schemas; #tab; #range; #ready = false; #flight = null;
  #lastError = null; #lastCommittedAt = null; #remoteRows = 0; #gridRows = 1000;
  constructor(db, { client, tab = 'GS_Data', spreadsheetId = client?.spreadsheetId } = {}) {
    if (!client || typeof client.readValues !== 'function' || typeof client.request !== 'function' || !/^[a-zA-Z0-9_-]{10,200}$/.test(spreadsheetId || '') || typeof tab !== 'string' || !tab.trim() || tab.length > 100 || /[\u0000-\u001f\u007f\[\]:*?/\\]/.test(tab) || tab === 'Permissions') throw new SheetStoreError('SHEET_STORE_CONFIG', 'Cấu hình kho dữ liệu Google Sheet không hợp lệ.');
    this.#db = db; this.#client = client; this.#tab = tab;
    this.spreadsheetId = spreadsheetId;
    this.#range = `'${tab.replaceAll("'", "''")}'`;
    this.#schemas = schemasFor(db);
    this.#lastCommittedAt = Number(db.prepare("SELECT value FROM sheet_store_state WHERE key='lastCommittedAt'").get()?.value) || null;
  }

  status() {
    return { provider: 'google_sheets', enabled: true, ready: this.#ready, spreadsheetId: this.spreadsheetId, tab: this.#tab, pendingEvents: this.#db.prepare('SELECT COUNT(*) n FROM sheet_store_outbox').get().n, lastCommittedAt: this.#lastCommittedAt, lastError: this.#lastError };
  }

  #remember(error) {
    this.#lastError = { code: error instanceof SheetStoreError ? error.code : 'SHEET_DURABILITY_FAILED', message: error instanceof SheetStoreError ? error.message : 'Chưa xác nhận lưu dữ liệu vào Google Sheet; dữ liệu còn trong hàng đợi cục bộ.' };
    return error instanceof SheetStoreError ? error : new SheetStoreError(this.#lastError.code, this.#lastError.message);
  }

  async #ensureTab() {
    const metadata = await this.#client.request('GET', '?fields=sheets.properties');
    if (!Array.isArray(metadata.sheets)) throw corrupt();
    const existing = metadata.sheets.find(sheet => sheet.properties?.title === this.#tab);
    if (!existing) await this.#client.request('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: this.#tab, gridProperties: { rowCount: 1000, columnCount: 10 } } } }] });
    this.#gridRows = existing?.properties?.gridProperties?.rowCount || 1000;
    const lastColumn = (existing?.properties?.gridProperties?.columnCount || 10) >= 10 ? 'J' : 'I';
    const values = await this.#client.readValues(`${this.#range}!A1:${lastColumn}${Math.min(2, this.#gridRows)}`);
    if (!values.length || values.every(row => row.every(cell => cell === '' || cell === null))) {
      if (existing) {
        await this.#readJournal();
        if (this.#remoteRows) throw new SheetStoreError('SHEET_HEADER_CONFLICT', 'Tab dữ liệu đã có nội dung nhưng thiếu tiêu đề. Không ghi đè tab hiện có.');
      }
      await this.#client.request('PUT', `/values/${encodeURIComponent(`${this.#range}!A1:I1`)}?valueInputOption=RAW`, { majorDimension: 'ROWS', values: [[...JOURNAL_HEADERS]] });
    } else if (JSON.stringify(values[0]) !== JSON.stringify(JOURNAL_HEADERS)) throw new SheetStoreError('SHEET_HEADER_CONFLICT', 'Tab dữ liệu đã có nội dung khác mẫu. Không ghi đè tab hiện có.');
  }

  async #readJournal(refreshGrid = false) {
    if (refreshGrid) {
      const metadata = await this.#client.request('GET', '?fields=sheets.properties');
      const rows = metadata.sheets?.find(sheet => sheet.properties?.title === this.#tab)?.properties?.gridProperties?.rowCount;
      if (Number.isSafeInteger(rows) && rows > 0) this.#gridRows = rows;
    }
    const rows = [];
    for (let start = 2; start <= Math.min(MAX_JOURNAL_ROWS + 1, this.#gridRows); start += READ_ROWS) {
      const end = Math.min(start + READ_ROWS - 1, this.#gridRows);
      const page = await this.#client.readValues(`${this.#range}!A${start}:I${end}`);
      rows.push(...page);
      if (page.length < end - start + 1 || end === this.#gridRows) { this.#remoteRows = rows.length; return decodeJournal(rows, this.#schemas); }
    }
    if (this.#gridRows < 2) { this.#remoteRows = 0; return decodeJournal([], this.#schemas); }
    throw new SheetStoreError('SHEET_CAPACITY', 'Nhật ký Google Sheet quá lớn để khôi phục an toàn; cần bảo trì kho dữ liệu.');
  }

  #dropTriggers() {
    for (const table of BUSINESS_TABLES) for (const operation of ['insert', 'update', 'delete']) this.#db.exec(`DROP TRIGGER IF EXISTS ${quote(`sheet_outbox_${table}_${operation}`)}`);
  }

  #installTriggers() {
    for (const [table, schema] of this.#schemas) {
      const object = prefix => `json_object(${schema.columns.flatMap(column => [literal(column), `${prefix}.${quote(column)}`]).join(',')})`;
      const key = prefix => `json_array(${schema.keys.map(column => `${prefix}.${quote(column)}`).join(',')})`;
      for (const operation of ['insert', 'update', 'delete']) {
        const prefix = operation === 'delete' ? 'OLD' : 'NEW';
        const guard = operation === 'update' ? `WHEN ${object('OLD')} != ${object('NEW')}` : '';
        const deleteOldKey = operation === 'update' ? `INSERT INTO sheet_store_outbox(eventId,tableName,key,operation,payload,createdAt) SELECT lower(hex(randomblob(16))),${literal(table)},${key('OLD')},'DELETE','null',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE ${key('OLD')} != ${key('NEW')};` : '';
        this.#db.exec(`CREATE TRIGGER ${quote(`sheet_outbox_${table}_${operation}`)} AFTER ${operation.toUpperCase()} ON ${quote(table)} ${guard} BEGIN ${deleteOldKey} INSERT INTO sheet_store_outbox(eventId,tableName,key,operation,payload,createdAt) VALUES (lower(hex(randomblob(16))),${literal(table)},${key(prefix)},${literal(operation === 'delete' ? 'DELETE' : 'UPSERT')},${operation === 'delete' ? "'null'" : object(prefix)},CAST(strftime('%s','now') AS INTEGER)*1000); END`);
      }
    }
  }

  #apply(event, localPasswords) {
    const schema = this.#schemas.get(event.tableName); const { key, value } = validateEvent(event, this.#schemas);
    if (event.operation === 'DELETE') {
      this.#db.prepare(`DELETE FROM ${quote(event.tableName)} WHERE ${schema.keys.map(column => `${quote(column)}=?`).join(' AND ')}`).run(...key);
      return;
    }
    const columns = [...schema.columns]; const values = columns.map(column => value[column]);
    if (event.tableName === 'users') { columns.push('passwordHash'); values.push(localPasswords.get(value.id) || GOOGLE_ONLY_HASH); }
    const updates = columns.filter(column => !schema.keys.includes(column)).map(column => `${quote(column)}=excluded.${quote(column)}`).join(',');
    this.#db.prepare(`INSERT INTO ${quote(event.tableName)}(${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(${schema.keys.map(quote).join(',')}) DO UPDATE SET ${updates}`).run(...values);
  }

  #restore(remote, pending) {
    const localPasswords = new Map(this.#db.prepare('SELECT id,passwordHash FROM users').all().map(row => [row.id, row.passwordHash]));
    const sessions = this.#db.prepare('SELECT * FROM sessions').all(); const tokens = this.#db.prepare('SELECT * FROM collector_tokens').all();
    // Reconstruct final durable state first; parent inserts and child deletes are
    // valid regardless of transaction event order or subsequent deleted parents.
    const final = new Map();
    for (const event of [...remote.events, ...pending]) {
      validateEvent(event, this.#schemas);
      final.set(`${event.tableName}:${event.key}`, event);
    }
    transaction(this.#db, () => {
      this.#db.exec('PRAGMA defer_foreign_keys=ON'); this.#dropTriggers();
      this.#db.exec('DELETE FROM sessions; DELETE FROM collector_tokens;');
      for (const table of [...BUSINESS_TABLES].reverse()) this.#db.exec(`DELETE FROM ${quote(table)}`);
      for (const table of BUSINESS_TABLES) for (const event of final.values()) if (event.tableName === table && event.operation === 'UPSERT') this.#apply(event, localPasswords);
      const exists = this.#db.prepare('SELECT 1 FROM users WHERE id=?');
      for (const session of sessions) if (exists.get(session.userId)) this.#db.prepare('INSERT INTO sessions(tokenHash,userId,csrfToken,expiresAt) VALUES (?,?,?,?)').run(session.tokenHash, session.userId, session.csrfToken, session.expiresAt);
      for (const token of tokens) if (exists.get(token.userId)) this.#db.prepare('INSERT INTO collector_tokens(tokenHash,userId,expiresAt) VALUES (?,?,?)').run(token.tokenHash, token.userId, token.expiresAt);
    });
  }

  #stageBootstrap() {
    const insert = this.#db.prepare('INSERT INTO sheet_store_outbox(eventId,tableName,key,operation,payload,createdAt) VALUES (?,?,?,?,?,?)');
    for (const [table, schema] of this.#schemas) for (const row of this.#db.prepare(`SELECT ${schema.columns.map(quote).join(',')} FROM ${quote(table)}`).all()) insert.run(randomUUID(), table, JSON.stringify(schema.keys.map(column => row[column])), 'UPSERT', JSON.stringify(row), Date.now());
  }

  async initialize() {
    if (this.#ready) return this.status();
    try {
      const identity = `${this.spreadsheetId}:${this.#tab}`;
      const cacheIdentity = this.#db.prepare("SELECT value FROM sheet_store_state WHERE key='identity'").get()?.value;
      if (cacheIdentity && cacheIdentity !== identity) throw new SheetStoreError('SHEET_CACHE_CONFLICT', 'Bộ nhớ đệm thuộc Google Sheet khác. Cần dùng đường dẫn cache riêng.');
      if (!cacheIdentity && nonBootstrap.some(table => this.#db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get())) throw new SheetStoreError('SHEET_CACHE_NOT_EMPTY', 'Không tự chuyển dữ liệu/tài khoản cục bộ vào Google Sheet. Hãy dùng một bộ nhớ đệm Google mới.');
      await this.#ensureTab(); const remote = await this.#readJournal();
      const lastBatch = this.#db.prepare("SELECT value FROM sheet_store_state WHERE key='lastCommittedBatch'").get()?.value;
      const priorRows = Number(this.#db.prepare("SELECT value FROM sheet_store_state WHERE key='remoteRows'").get()?.value) || 0;
      if (cacheIdentity && ((lastBatch && !remote.committedBatches.has(lastBatch)) || this.#remoteRows < priorRows)) throw new SheetStoreError('SHEET_JOURNAL_TRUNCATED', 'Nhật ký Google Sheet đã mất dữ liệu từng xác nhận. Dừng khôi phục; cần kiểm tra lịch sử phiên bản của Sheet.');
      const pending = this.#db.prepare('SELECT * FROM sheet_store_outbox ORDER BY sequence').all();
      if (remote.events.length || cacheIdentity) this.#restore(remote, pending);
      transaction(this.#db, () => {
        this.#dropTriggers(); this.#installTriggers();
        if (!remote.events.length && !cacheIdentity && !pending.length) this.#stageBootstrap();
        this.#db.prepare("INSERT INTO sheet_store_state(key,value) VALUES ('identity',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(identity);
      });
      this.#ready = true; this.#lastError = null;
      await this.flush();
      return this.status();
    } catch (error) { this.#ready = false; throw this.#remember(error); }
  }

  #nextBatch() {
    const existing = this.#db.prepare('SELECT * FROM sheet_store_batches ORDER BY createdAt,id LIMIT 1').get();
    if (existing) {
      const events = this.#db.prepare('SELECT * FROM sheet_store_outbox WHERE batchId=? ORDER BY sequence').all(existing.id);
      if (!events.length || manifestFor(events) !== existing.manifest) throw corrupt();
      return { id: existing.id, manifest: existing.manifest, events, retried: true };
    }
    const events = this.#db.prepare('SELECT * FROM sheet_store_outbox WHERE batchId IS NULL ORDER BY sequence LIMIT ?').all(MAX_BATCH_EVENTS);
    if (!events.length) return null;
    events.forEach(event => validateEvent(event, this.#schemas));
    const id = randomUUID(); const manifest = manifestFor(events);
    transaction(this.#db, () => {
      this.#db.prepare('INSERT INTO sheet_store_batches(id,manifest,createdAt) VALUES (?,?,?)').run(id, manifest, Date.now());
      const setBatch = this.#db.prepare('UPDATE sheet_store_outbox SET batchId=? WHERE eventId=?');
      for (const event of events) setBatch.run(id, event.eventId);
    });
    return { id, manifest, events, retried: false };
  }

  async #append(rows) {
    const chunks = []; let current = [];
    for (const row of rows) {
      const next = [...current, row];
      if (Buffer.byteLength(JSON.stringify({ majorDimension: 'ROWS', values: next })) > REQUEST_BYTES && current.length) { chunks.push(current); current = [row]; }
      else current = next;
    }
    if (current.length) chunks.push(current);
    for (const values of chunks) {
      if (Buffer.byteLength(JSON.stringify({ majorDimension: 'ROWS', values })) > REQUEST_BYTES) throw new SheetStoreError('SHEET_EVENT_TOO_LARGE', 'Một phần dữ liệu vượt kích thước ghi an toàn của Google Sheet.');
      const result = await this.#client.request('POST', `/values/${encodeURIComponent(`${this.#range}!A:I`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { majorDimension: 'ROWS', values });
      const end = /(?:!)?[^:]+:[A-Z]+(\d+)$/.exec(result?.updates?.updatedRange || '');
      if (end) this.#gridRows = Math.max(this.#gridRows, Number(end[1]));
    }
  }

  async #flush() {
    if (!this.#ready) throw new SheetStoreError('SHEET_NOT_READY', 'Kho dữ liệu Google Sheet chưa sẵn sàng.');
    for (let batch = this.#nextBatch(); batch; batch = this.#nextBatch()) {
      // A prior HTTP timeout can mean the whole batch was already committed.
      const before = batch.retried ? await this.#readJournal(true) : null;
      if (before?.committedBatches.has(batch.id) && before.committedBatches.get(batch.id) !== batch.manifest) throw corrupt();
      if (!before?.committedBatches.has(batch.id)) {
        const start = this.#remoteRows + 2;
        await this.#append(rowsFor(batch.id, batch.events, batch.manifest));
        const rows = [];
        for (let offset = start; offset <= Math.min(MAX_JOURNAL_ROWS + 1, this.#gridRows); offset += READ_ROWS) {
          const end = Math.min(offset + READ_ROWS - 1, this.#gridRows);
          const page = await this.#client.readValues(`${this.#range}!A${offset}:I${end}`); rows.push(...page);
          if (page.length < end - offset + 1 || end === this.#gridRows) break;
        }
        const confirmed = decodeJournal(rows, this.#schemas);
        if (confirmed.committedBatches.get(batch.id) !== batch.manifest) throw new SheetStoreError('SHEET_COMMIT_UNCONFIRMED', 'Chưa đọc lại được xác nhận lưu Google Sheet; giữ nguyên hàng đợi để thử lại.');
        if (rows.some(row => row[1] !== batch.id)) throw new SheetStoreError('SHEET_MULTIPLE_WRITERS', 'Phát hiện lượt ghi khác vào tab dữ liệu; chỉ chạy một tiến trình máy chủ cho workbook này.');
        this.#remoteRows += rows.length;
      }
      transaction(this.#db, () => {
        this.#db.prepare('DELETE FROM sheet_store_outbox WHERE batchId=?').run(batch.id);
        this.#db.prepare('DELETE FROM sheet_store_batches WHERE id=?').run(batch.id);
        this.#lastCommittedAt = Date.now();
        this.#db.prepare("INSERT INTO sheet_store_state(key,value) VALUES ('lastCommittedAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(this.#lastCommittedAt));
        this.#db.prepare("INSERT INTO sheet_store_state(key,value) VALUES ('lastCommittedBatch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(batch.id);
        this.#db.prepare("INSERT INTO sheet_store_state(key,value) VALUES ('remoteRows',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(this.#remoteRows));
      });
      this.#lastError = null;
    }
    return this.status();
  }

  async flush() {
    if (this.#flight) return this.#flight;
    this.#flight = this.#flush().catch(error => { throw this.#remember(error); });
    try { return await this.#flight; } finally { this.#flight = null; }
  }
}
