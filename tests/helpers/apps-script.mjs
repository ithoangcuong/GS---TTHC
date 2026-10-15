import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
import { createHmac, randomUUID, randomBytes } from 'node:crypto';

export function gasRuntime(files = ['Utils', 'Crypto', 'Passwords', 'SheetRepository', 'Settings', 'Audit', 'Permissions', 'Users', 'Auth', 'Setup'], initialProperties = {}) {
  const properties = new Map(Object.entries({ SPREADSHEET_ID: 'SYNTHETIC_SHEET_123456', DATA_ENCRYPTION_KEY: randomBytes(64).toString('hex'), DATA_ENCRYPTION_KEY_ID: 'test-key-v1', EMAIL_PEPPER: 'e'.repeat(64), LOOKUP_PEPPER: 'l'.repeat(64), BOOTSTRAP_EMAIL: 'owner@example.test', BOOTSTRAP_USERNAME: 'admin', BOOTSTRAP_PASSWORD: 'SYNTHETIC-admin-2026!', DEFAULT_USER_PASSWORD: 'SYNTHETIC-default-2026!', ...initialProperties }));
  const sheets = new Map(), calls = [], cacheValues = new Map(), mail = [];
  let locked = false, failingTable = null, failCount = 0, cryptoOffline = false;
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.maxColumns = 26; }
    getLastRow() { let last = this.rows.length; while (last && !(this.rows[last - 1] || []).some(v => v !== '' && v != null)) last--; return last; }
    getLastColumn() { return Math.max(0, ...this.rows.map(row => row.reduce((last, value, i) => value !== '' && value != null ? i + 1 : last, 0))); }
    getMaxRows() { return this.maxRows; }
    getMaxColumns() { return this.maxColumns; }
    insertRowsAfter(_, count) { this.maxRows += count; }
    insertColumnsAfter(_, count) { this.maxColumns += count; }
    setFrozenRows() {}
    getRange(startRow, startColumn, rowCount = 1, columnCount = 1) {
      return {
        getValues: () => { calls.push({ op: 'read', table: this.name, startRow, rowCount }); return Array.from({ length: rowCount }, (_, i) => Array.from({ length: columnCount }, (_, j) => this.rows[startRow - 1 + i]?.[startColumn - 1 + j] ?? '')); },
        setValues: values => {
          calls.push({ op: 'write', table: this.name, startRow, rowCount, locked });
          if (this.name === failingTable && failCount > 0) { failCount--; throw new Error('Synthetic sheet write failure'); }
          if (values.length !== rowCount || values.some(row => row.length !== columnCount)) throw new Error('Range size mismatch');
          values.forEach((row, i) => { this.rows[startRow - 1 + i] ||= []; row.forEach((v, j) => { this.rows[startRow - 1 + i][startColumn - 1 + j] = v; }); });
        },
        clearContent: () => { for (let i = 0; i < rowCount; i++) for (let j = 0; j < columnCount; j++) if (this.rows[startRow - 1 + i]) this.rows[startRow - 1 + i][startColumn - 1 + j] = ''; }
      };
    }
  }
  const workbook = { getSheetByName: name => sheets.get(name) || null, insertSheet: name => { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; } };
  const propertyService = { getProperty: key => properties.get(key) ?? null, setProperty: (key, value) => { properties.set(key, String(value)); return propertyService; }, deleteProperty: key => { properties.delete(key); return propertyService; }, getProperties: () => Object.fromEntries(properties) };
  const cache = { get: key => { const item = cacheValues.get(key); return item && item.expires > Date.now() ? item.value : null; }, put: (key, value, seconds) => cacheValues.set(key, { value, expires: Date.now() + seconds * 1000 }), remove: key => cacheValues.delete(key) };
  const unexpectedFetch = request => {
    calls.push({ op: 'urlfetch', locked, url: request.url });
    throw new Error('Unexpected external request in local GAS harness');
  };
  const context = createContext({
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: message => mail.push(message) },
    console: { log() {} },
    Utilities: {
      getUuid: randomUUID, Charset: { UTF_8: 'UTF-8' },
      computeHmacSha256Signature: (value, pepper) => [...createHmac('sha256', pepper).update(value).digest()],
      base64Encode: value => Buffer.from(typeof value === 'string' ? value : value.map(v => v & 255)).toString('base64'),
      base64EncodeWebSafe: value => Buffer.from(typeof value === 'string' ? value : value.map(v => v & 255)).toString('base64url'),
      base64Decode: value => [...Buffer.from(value, 'base64')],
      newBlob: value => { const buffer = Buffer.from(typeof value === 'string' ? value : value.map(v => v & 255)); return { getBytes: () => [...buffer], getDataAsString: () => buffer.toString('utf8') }; },
      formatDate: (date, _, format) => { const shifted = new Date(new Date(date).getTime() + 7 * 3600000); return format === 'yyyy-MM-dd' ? shifted.toISOString().slice(0,10) : shifted.toISOString(); }
    },
    PropertiesService: { getScriptProperties: () => propertyService },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) throw new Error('Nested lock'); locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    SpreadsheetApp: { openById: () => workbook, flush() {} },
    ScriptApp: { getOAuthToken: () => 'SYNTHETIC_OWNER_TOKEN', getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT/exec' }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'owner@example.test' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
    UrlFetchApp: { fetchAll: requests => requests.map(unexpectedFetch), fetch: (url, options) => unexpectedFetch({ url, ...options }) }
  });
  const modules = files.includes('Crypto') ? ['CryptoVendor', ...files.filter(file => file !== 'CryptoVendor')] : files;
  modules.forEach(file => {
    new Script(readFileSync(`apps-script/${file}.gs`, 'utf8'), { filename: `${file}.gs` }).runInContext(context);
    if (file === 'CryptoVendor') {
      const aessiv = context.TthcCipher.aessiv;
      // Execute the same bundled cipher as production; only failure injection
      // and call tracking belong to this local harness.
      const trackedCipher = (...args) => {
        const cipher = aessiv(...args);
        return Object.fromEntries(['encrypt', 'decrypt'].map(operation => [operation, value => {
          calls.push({ op: 'crypto', operation, locked });
          if (cryptoOffline) throw new Error('Synthetic cipher failure');
          return cipher[operation](value);
        }]));
      };
      context.TthcCipher = { ...context.TthcCipher, aessiv: trackedCipher };
    }
  });
  return { context, app: context.TTHC, properties, sheets, calls, cache, mail, clearCache: () => cacheValues.clear(), workbook, plain: value => JSON.parse(JSON.stringify(value)), failWrites: (table, count = 1) => { failingTable = table; failCount = count; }, setCryptoOffline: value => { cryptoOffline = value; } };
}
