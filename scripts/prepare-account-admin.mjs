// Prepare a narrowly scoped account migration from a fresh connector snapshot.
// This command writes only local files; it never uploads keys or passwords.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { createHmac, randomUUID, randomBytes } from 'node:crypto';

const directory = resolve('data/account-bootstrap-private');
const snapshot = JSON.parse(readFileSync(resolve(directory, 'sheet-before.json'), 'utf8'));
const props = Object.fromEntries(readFileSync(resolve('data/admin-bootstrap-private/script-properties.txt'), 'utf8').trim().split(/\r?\n/).map(line => {
  const index = line.indexOf('=');
  assert.ok(index > 0, 'Malformed private configuration.');
  return [line.slice(0, index), line.slice(index + 1)];
}));
assert.equal(snapshot.spreadsheetId, props.SPREADSHEET_ID);
const tables = Object.fromEntries(snapshot.sheets.map(sheet => [sheet.properties.title, {
  id: sheet.properties.sheetId,
  rows: sheet.data.flatMap(block => block.rowData || []).map(row => (row.values || []).map(cell => cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? cell.userEnteredValue?.boolValue ?? '')),
}]));
const context = createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: name => props[name] ?? null }) },
  Utilities: {
    getUuid: randomUUID, Charset: { UTF_8: 'UTF-8' },
    computeHmacSha256Signature: (value, pepper) => [...createHmac('sha256', pepper).update(value).digest()],
    base64Encode: value => Buffer.from(typeof value === 'string' ? value : Array.from(value, byte => byte & 255)).toString('base64'),
    base64Decode: value => [...Buffer.from(value, 'base64')],
    newBlob: value => { const bytes = Buffer.from(typeof value === 'string' ? value : Array.from(value, byte => byte & 255)); return { getBytes: () => [...bytes], getDataAsString: () => bytes.toString('utf8') }; },
  },
});
for (const name of ['CryptoVendor', 'Utils', 'Crypto', 'Passwords', 'SheetRepository']) new Script(readFileSync(`apps-script/${name}.gs`, 'utf8'), { filename: `${name}.gs` }).runInContext(context);
const app = context.TTHC;
const legacy = Array.from(app.Repo.schemas.USERS).slice(0, 11);
assert.deepEqual(tables.USERS.rows[0], legacy, 'Only the known legacy USERS schema can be migrated.');
assert.equal(tables.USERS.rows.length, 2, 'Inspect any additional users before provisioning.');
const admin = tables.USERS.rows[1];
assert.equal(admin[4], 'SUPER_ADMIN');
assert.equal(admin[6], 'ACTIVE');
const email = app.Utils.normalizeEmail(props.BOOTSTRAP_EMAIL);
assert.equal(admin[1], app.Crypto.hashLookupKey('email:' + email));
assert.equal(app.Crypto.decrypt(admin[2]), email, 'Existing admin must decrypt with the same private key.');
assert.deepEqual(tables.SETTINGS.rows[0], Array.from(app.Repo.schemas.SETTINGS));
assert.deepEqual(tables.AUDIT_LOGS.rows[0], Array.from(app.Repo.schemas.AUDIT_LOGS));
assert.ok(!tables.SETTINGS.rows.some(row => row[0] === 'defaultUserPasswordEncrypted'), 'Default password already configured; preserve it.');

const credentialsPath = resolve(directory, 'credentials.json');
const credentials = existsSync(credentialsPath) ? JSON.parse(readFileSync(credentialsPath, 'utf8')) : {
  username: 'admin',
  adminPassword: 'Tthc-' + randomBytes(12).toString('base64url') + '!',
  defaultUserPassword: 'Tthc-' + randomBytes(12).toString('base64url') + '!',
};
assert.equal(credentials.username, 'admin');
app.Passwords.validate(credentials.adminPassword);
app.Passwords.validate(credentials.defaultUserPassword);
writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
const at = new Date().toISOString(), suffix = Array.from(app.Repo.schemas.USERS).slice(11);
const started = performance.now(), passwordHash = app.Passwords.hash(credentials.adminPassword);
assert.ok(app.Passwords.verify(credentials.adminPassword, passwordHash));
assert.ok(!app.Passwords.verify('invalid-password', passwordHash));
const userSuffix = [app.Crypto.hashLookupKey('username:admin'), app.Crypto.encrypt('admin'), passwordHash, true, randomUUID(), at];
assert.equal(app.Crypto.decrypt(userSuffix[1]), 'admin');
const encryptedDefault = app.Crypto.encrypt(credentials.defaultUserPassword);
assert.equal(app.Crypto.decrypt(encryptedDefault), credentials.defaultUserPassword);
const audit = [randomUUID(), 'OWNER_AUTHORIZED_TOOL', 'PROVISION_PASSWORD_ADMIN', admin[0], '', app.Crypto.encrypt({ role: 'SUPER_ADMIN', result: 'SUCCESS', existingUserPreserved: true }), app.Crypto.cryptoVersion, at];
function block(sheetId, rowIndex, columnIndex, values) {
  return { updateCells: {
    range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + values.length, startColumnIndex: columnIndex, endColumnIndex: columnIndex + values[0].length },
    rows: values.map(row => ({ values: row.map(value => ({ userEnteredValue: typeof value === 'boolean' ? { boolValue: value } : { stringValue: String(value) } })) })),
    fields: 'userEnteredValue',
  } };
}
const requests = [
  block(tables.USERS.id, 0, 11, [suffix, userSuffix]),
  block(tables.SETTINGS.id, tables.SETTINGS.rows.length, 0, [['defaultUserPasswordEncrypted', encryptedDefault, at]]),
  block(tables.AUDIT_LOGS.id, tables.AUDIT_LOGS.rows.length, 0, [audit]),
  { copyPaste: { source: { sheetId: tables.USERS.id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 10, endColumnIndex: 11 }, destination: { sheetId: tables.USERS.id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 11, endColumnIndex: 17 }, pasteType: 'PASTE_FORMAT' } },
];
const plan = { spreadsheetId: snapshot.spreadsheetId, requests, preparedAt: at, userId: admin[0] };
writeFileSync(resolve(directory, 'write-plan.json'), JSON.stringify(plan, null, 2));
console.log(JSON.stringify({ prepared: true, username: credentials.username, existingUserPreserved: true, requestCount: requests.length, passwordHashVerificationMs: Math.round(performance.now() - started), secretValuesPrinted: false }));
