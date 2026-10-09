// Produce an encrypted provisioning plan from a fresh Google Sheets read.
// This command never uploads credentials, changes Script Properties, or writes Google Sheets.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { createHmac, randomUUID } from 'node:crypto';

const directory = resolve('data/admin-bootstrap-private');
const props = Object.fromEntries(readFileSync(resolve(directory, 'script-properties.txt'), 'utf8').trim().split(/\r?\n/).map(line => {
  const separator = line.indexOf('=');
  if (separator < 1) throw new Error('Malformed private Script Properties file.');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
const sheet = JSON.parse(readFileSync(resolve(directory, 'sheet-before.json'), 'utf8'));
assert.equal(sheet.spreadsheetId, props.SPREADSHEET_ID, 'Spreadsheet identity differs from the private configuration.');
const context = createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name] ?? null }) },
  Utilities: {
    getUuid: randomUUID,
    Charset: { UTF_8: 'UTF-8' },
    computeHmacSha256Signature: (value, pepper) => [...createHmac('sha256', pepper).update(value).digest()],
    base64Encode: value => Buffer.from(typeof value === 'string' ? value : Array.from(value, byte => byte & 255)).toString('base64'),
    base64Decode: value => [...Buffer.from(value, 'base64')],
    newBlob: value => { const bytes = Buffer.from(typeof value === 'string' ? value : Array.from(value, byte => byte & 255)); return { getBytes: () => [...bytes], getDataAsString: () => bytes.toString('utf8') }; }
  }
});
for (const file of ['CryptoVendor', 'Utils', 'Crypto', 'SheetRepository', 'Permissions', 'Users']) new Script(readFileSync(`apps-script/${file}.gs`, 'utf8'), { filename: `${file}.gs` }).runInContext(context);
const app = context.TTHC;
const targets = Object.fromEntries(['USERS', 'AUDIT_LOGS'].map(name => {
  const target = sheet.sheets.find(item => item.properties.title === name);
  assert.ok(target, `Missing ${name} metadata.`);
  const rows = target.data?.flatMap(block => block.rowData || []) || [];
  const values = rows.map(row => (row.values || []).map(cell => cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? cell.userEnteredValue?.boolValue ?? cell.userEnteredValue?.formulaValue ?? ''));
  assert.deepEqual(values[0], Array.from(app.Repo.schemas[name]), `${name} schema conflict.`);
  assert.ok(values.slice(1).every(row => row.every(value => value === '')), `${name} contains existing records. Refresh the read and preserve them.`);
  return [name, target];
}));
const email = app.Utils.normalizeEmail(props.BOOTSTRAP_EMAIL);
const at = app.Utils.now(), id = app.Utils.id();
const encrypted = app.Crypto.encryptMany([email, 'Quản trị hệ thống']);
const user = {
  user_id: id, email_hash: app.Crypto.hashLookupKey('email:' + email), email_encrypted: encrypted[0], display_name_encrypted: encrypted[1],
  role: 'SUPER_ADMIN', scope: JSON.stringify({ sources: ['*'], agencies: ['*'], departments: ['*'], officers: ['*'] }), status: 'ACTIVE',
  created_at: at, updated_at: at, created_by: 'OWNER_AUTHORIZED_TOOL', last_login_at: ''
};
assert.equal(app.Users.validateRow(user).role, 'SUPER_ADMIN');
assert.equal(app.Crypto.decrypt(user.email_encrypted), email);
assert.equal(app.Crypto.decrypt(user.display_name_encrypted), 'Quản trị hệ thống');
const audit = {
  audit_id: app.Utils.id(), actor_id: 'OWNER_AUTHORIZED_TOOL', action: 'ADD_USER', target_id: id, source_id: '',
  details_encrypted: app.Crypto.encrypt({ role: 'SUPER_ADMIN', result: 'OWNER_AUTHORIZED_CONNECTOR' }),
  crypto_version: app.Crypto.cryptoVersion, created_at: at
};
const requests = Object.entries({ USERS: user, AUDIT_LOGS: audit }).map(([name, record]) => ({ updateCells: {
  range: { sheetId: targets[name].properties.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: app.Repo.schemas[name].length },
  rows: [{ values: Array.from(app.Repo.schemas[name], key => ({ userEnteredValue: { stringValue: record[key] } })) }],
  fields: 'userEnteredValue'
} }));
const plan = { spreadsheet_id: props.SPREADSHEET_ID, requests, include_spreadsheet_in_response: false };
assert.ok(!JSON.stringify(plan).includes(email), 'Provisioning plan must not include a plaintext email.');
const target = resolve(directory, 'google-admin-write-plan.json');
writeFileSync(target, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ file: 'data/admin-bootstrap-private/google-admin-write-plan.json', role: user.role, status: user.status, cryptoVersion: app.Crypto.cryptoVersion, realGoogleWrite: false, secretsPrinted: false }));
