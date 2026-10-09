import test from 'node:test';
import assert from 'node:assert/strict';
import { setupGoogleSheet } from '../server/google-setup.mjs';
import { SHEET_HEADERS } from '../server/google-sheets.mjs';

const env = { GOOGLE_SHEETS_ID: '1_test_google_spreadsheet', GOOGLE_SHEETS_PERMISSIONS_TAB: 'Permissions', GOOGLE_ADMIN_EMAIL: 'ADMIN@example.gov.vn', GOOGLE_SERVICE_ACCOUNT_FILE: 'server-private-key.json' };
const adminRow = email => [email, 'Quản trị hệ thống', 'SYSTEM_ADMIN', '', '', '', '', true];

function clientFixture({ existing = false, current = [] } = {}) {
  const calls = [];
  const otherTab = { properties: { sheetId: 1, title: 'Other data', gridProperties: { rowCount: 1000, columnCount: 26 } } };
  const metadata = { sheets: [otherTab, ...(existing ? [{ properties: { sheetId: 2, title: 'Permissions', gridProperties: { rowCount: 1000, columnCount: 8 } } }] : [])] };
  const client = {
    async request(method, suffix, body) {
      calls.push({ method, suffix, body });
      if (method === 'GET') return structuredClone(metadata);
      return {};
    },
    async readValues(range) { calls.push({ method: 'READ', range }); return structuredClone(current); }
  };
  return { client, calls, metadata, otherTab };
}

test('setup creates only a missing permissions tab and seeds the explicitly supplied admin email', async t => {
  t.mock.method(console, 'log', () => {});
  const { client, calls, metadata, otherTab } = clientFixture();
  await setupGoogleSheet(env, { client });
  assert.equal(calls[0].method, 'GET');
  const create = calls.find(call => call.method === 'POST');
  assert.equal(create.suffix, ':batchUpdate');
  assert.equal(create.body.requests.length, 1);
  assert.equal(create.body.requests[0].addSheet.properties.title, 'Permissions');
  assert.ok(create.body.requests[0].addSheet.properties.gridProperties.columnCount >= SHEET_HEADERS.length);
  assert.equal(calls.find(call => call.method === 'READ').range, "'Permissions'");
  const write = calls.find(call => call.method === 'PUT');
  assert.equal(new URL(`https://sheets.googleapis.com${write.suffix}`).searchParams.get('valueInputOption'), 'RAW');
  assert.equal(write.body.majorDimension, 'ROWS');
  assert.deepEqual(write.body.values, [SHEET_HEADERS, adminRow('admin@example.gov.vn')]);
  assert.deepEqual(metadata.sheets, [otherTab]);
});

test('setup preserves a populated valid permissions tab without overwriting grants', async t => {
  t.mock.method(console, 'log', () => {});
  const { client, calls } = clientFixture({ existing: true, current: [SHEET_HEADERS, adminRow('existing@example.gov.vn')] });
  await setupGoogleSheet(env, { client });
  assert.deepEqual(calls.map(call => call.method), ['GET', 'READ']);
});

test('setup seeds an existing empty permissions tab without recreating it', async t => {
  t.mock.method(console, 'log', () => {});
  const { client, calls } = clientFixture({ existing: true, current: [[], ['', '', null]] });
  await setupGoogleSheet(env, { client });
  assert.deepEqual(calls.map(call => call.method), ['GET', 'READ', 'PUT']);
  assert.deepEqual(calls.at(-1).body.values[1], adminRow('admin@example.gov.vn'));
});

test('setup refuses malformed existing rows, duplicate identities and overflow without overwriting', async t => {
  t.mock.method(console, 'log', () => {});
  const malformed = [
    [['password', ...SHEET_HEADERS.slice(1)], adminRow('existing@example.gov.vn')],
    [SHEET_HEADERS, ['existing@example.gov.vn', 'Viewer', 'VIEWER', '', '', '', '', true]],
    [SHEET_HEADERS, adminRow('existing@example.gov.vn'), adminRow('EXISTING@example.gov.vn')],
    [SHEET_HEADERS, ...Array.from({ length: 5001 }, (_, index) => adminRow(`admin${index}@example.gov.vn`))]
  ];
  for (const current of malformed) {
    const { client, calls } = clientFixture({ existing: true, current });
    await assert.rejects(setupGoogleSheet(env, { client }), { code: 'INVALID_PERMISSIONS' });
    assert.deepEqual(calls.map(call => call.method), ['GET', 'READ']);
  }
});

test('setup rejects invalid admin identity and reserved tab names before any Google operation', async () => {
  for (const change of [{ GOOGLE_ADMIN_EMAIL: '' }, { GOOGLE_ADMIN_EMAIL: 'not-an-email' }, { GOOGLE_ADMIN_EMAIL: 'admin email@example.gov.vn' }, { GOOGLE_SHEETS_PERMISSIONS_TAB: 'GS_Data' }, { GOOGLE_SHEETS_PERMISSIONS_TAB: 'bad/tab' }]) {
    const { client, calls } = clientFixture();
    await assert.rejects(setupGoogleSheet({ ...env, ...change }, { client }));
    assert.deepEqual(calls, []);
  }
});

test('setup quotes tab names containing apostrophes and preserves unrelated spreadsheet tabs', async t => {
  t.mock.method(console, 'log', () => {});
  const { client, calls } = clientFixture();
  await setupGoogleSheet({ ...env, GOOGLE_SHEETS_PERMISSIONS_TAB: "Quyền 'A'" }, { client });
  assert.equal(calls.find(call => call.method === 'READ').range, "'Quyền ''A'''" );
  assert.equal(calls.find(call => call.method === 'POST').body.requests[0].addSheet.properties.title, "Quyền 'A'");
  assert.equal(calls.find(call => call.method === 'PUT').body.range, "'Quyền ''A'''!A1:H2");
});
