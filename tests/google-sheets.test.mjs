import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GoogleSheetsClient, GoogleSheetsReader, GoogleSheetsError, SHEET_HEADERS, parsePermissionRows } from '../server/google-sheets.mjs';

const spreadsheetId = '1_test_google_spreadsheet';
const scope = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const writerScope = 'https://www.googleapis.com/auth/spreadsheets';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = { type: 'service_account', client_email: 'permissions@project.iam.gserviceaccount.com', private_key_id: 'test-key', private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://attacker.invalid/token' };
const person = overrides => ({ email: 'Officer@example.gov.vn', displayName: 'Nguyễn Văn A', role: 'OFFICER', sourceSystems: 'TPHCM;MOC', agencyId: 'agency-1', departmentId: 'department-1', officerId: 'officer-1', active: true, ...overrides });
const values = (people = [person()], headers = SHEET_HEADERS) => [headers, ...people.map(person => headers.map(header => person[header]))];
const jsonResponse = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const goodToken = (overrides = {}) => ({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, ...overrides });
const makeReader = options => new GoogleSheetsReader({ spreadsheetId, credentials, ...options });

test('permissions validate reordered headers, normalize identity, keep explicit scopes and parse booleans', () => {
  const headers = [...SHEET_HEADERS].reverse();
  const rows = values([person({ sourceSystems: 'TPHCM, MOC;TPHCM', active: 'TRUE' }), person({ email: 'leader@example.gov.vn', role: 'AGENCY_LEADER', officerId: '', active: 'FALSE' })], headers);
  rows.push([]);
  assert.deepEqual(parsePermissionRows(rows, { sourceIds: ['TPHCM', 'MOC'] }), [
    { email: 'officer@example.gov.vn', displayName: 'Nguyễn Văn A', role: 'OFFICER', scope: { sourceSystems: ['TPHCM', 'MOC'], agencyId: 'agency-1', departmentId: 'department-1', officerId: 'officer-1' }, active: true },
    { email: 'leader@example.gov.vn', displayName: 'Nguyễn Văn A', role: 'AGENCY_LEADER', scope: { sourceSystems: ['TPHCM', 'MOC'], agencyId: 'agency-1', departmentId: 'department-1' }, active: false }
  ]);
});

test('header validation rejects password columns, unknown columns, missing columns and duplicates', () => {
  for (const headers of [[...SHEET_HEADERS, 'password'], [...SHEET_HEADERS.slice(0, -1)], ['email', ...SHEET_HEADERS.slice(1, -1), 'email'], [...SHEET_HEADERS.slice(0, -1), 'Active']]) {
    assert.throws(() => parsePermissionRows(values([person()], headers)), error => error instanceof GoogleSheetsError && error.code === 'INVALID_PERMISSIONS' && /dòng 1/.test(error.message));
  }
  assert.throws(() => parsePermissionRows([]), /dòng 1/);
  assert.throws(() => parsePermissionRows([SHEET_HEADERS, null]), /dòng 2/);
  assert.throws(() => parsePermissionRows([SHEET_HEADERS, [...SHEET_HEADERS.map(header => person()[header]), 'secret']]), /dòng 2/);
  assert.equal(parsePermissionRows([[...SHEET_HEADERS, ''], [...SHEET_HEADERS.map(header => person()[header]), '']]).length, 1);
});

test('identity collisions and unsupported values reject the complete snapshot with safe row numbers', () => {
  assert.throws(() => parsePermissionRows(values([person(), person({ email: 'officer@EXAMPLE.gov.vn' })])), /dòng 3.*trùng/);
  for (const email of ['bad email@example.gov.vn', 'not-an-email', 'a'.repeat(65) + '@example.gov.vn', 'person@example..gov.vn', 42]) assert.throws(() => parsePermissionRows(values([person({ email })])), /dòng 2/);
  assert.throws(() => parsePermissionRows(values([person({ displayName: 'A'.repeat(201) })])), /dòng 2/);
  assert.throws(() => parsePermissionRows(values([person({ displayName: 'name\nwith-newline' })])), /dòng 2/);
  assert.throws(() => parsePermissionRows(values([person({ displayName: { secret: 'not-surfaced' } })])), error => !error.message.includes('not-surfaced'));
});

test('all roles use existing scope requirements including inactive rows', () => {
  for (const change of [{ role: 'UNKNOWN' }, { sourceSystems: '' }, { sourceSystems: 'TPHCM,' }, { sourceSystems: 'OTHER' }, { role: 'AGENCY_LEADER', agencyId: '' }, { role: 'DEPARTMENT_LEADER', departmentId: '' }, { officerId: '' }, { active: false, officerId: '' }]) {
    assert.throws(() => parsePermissionRows(values([person(change)]), { sourceIds: ['TPHCM', 'MOC'] }), /dòng 2/);
  }
  const admin = parsePermissionRows(values([person({ role: 'SYSTEM_ADMIN', sourceSystems: '', agencyId: '', departmentId: '', officerId: '' })]));
  assert.deepEqual(admin[0].scope, {});
  for (const active of ['', 'true', 'false', 1, 0, null]) assert.throws(() => parsePermissionRows(values([person({ active })])), /active/);
  assert.equal(parsePermissionRows(values([person({ active: false })]))[0].active, false);
});

test('empty snapshot and physical row overflow cannot silently revoke or truncate permissions', () => {
  assert.throws(() => parsePermissionRows([SHEET_HEADERS, []]), /ít nhất một/);
  const rows = [SHEET_HEADERS, ...Array.from({ length: 5000 }, (_, index) => SHEET_HEADERS.map(header => person({ email: `person${index}@example.gov.vn` })[header]))];
  assert.equal(parsePermissionRows(rows).length, 5000);
  rows.push([]);
  assert.throws(() => parsePermissionRows(rows), /dòng 5002/);
});

test('service account JWT is verifiably RS256 and uses fixed readonly endpoint without impersonation', async () => {
  const calls = [];
  const reader = makeReader({ clock: () => 1800000000000, sheetName: "Quyền 'A'", fetch: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [header, claims, signature] = params.get('assertion').split('.');
      assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'test-key' });
      assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: credentials.client_email, scope, aud: url, iat: 1800000000, exp: 1800003600 });
      assert.ok(verify('sha256', Buffer.from(`${header}.${claims}`), keys.publicKey, Buffer.from(signature, 'base64url')));
      return jsonResponse(goodToken({ scope }));
    }
    const request = new URL(url);
    assert.equal(request.origin, 'https://sheets.googleapis.com');
    assert.equal(decodeURIComponent(request.pathname), `/v4/spreadsheets/${spreadsheetId}/values/'Quyền ''A'''`);
    assert.equal(request.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    assert.equal(request.searchParams.get('majorDimension'), 'ROWS');
    assert.equal(options.headers.authorization, 'Bearer test-access-token');
    return jsonResponse({ majorDimension: 'ROWS', values: values() });
  } });
  assert.equal((await reader.read())[0].email, 'officer@example.gov.vn');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !call.url.includes('attacker')));
});

test('tokens cache until expiry skew; concurrent reader calls share one in-flight read', async () => {
  let now = 1800000000000;
  let tokenCalls = 0;
  let sheetCalls = 0;
  const reader = makeReader({ clock: () => now, fetch: async url => {
    if (url === 'https://oauth2.googleapis.com/token') { tokenCalls++; return jsonResponse(goodToken()); }
    sheetCalls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    return jsonResponse({ values: values() });
  } });
  await Promise.all([reader.read(), reader.read(), reader.read()]);
  assert.equal(tokenCalls, 1);
  assert.equal(sheetCalls, 1);
  await reader.read();
  assert.equal(tokenCalls, 1);
  assert.equal(sheetCalls, 2);
  now += 3541000;
  await reader.read();
  assert.equal(tokenCalls, 2);
});

test('different parallel client requests still share the same OAuth token flight', async () => {
  let tokens = 0;
  const client = new GoogleSheetsClient({ spreadsheetId, credentials, fetch: async url => {
    if (url === 'https://oauth2.googleapis.com/token') { tokens++; await new Promise(resolve => setTimeout(resolve, 5)); return jsonResponse(goodToken()); }
    return jsonResponse({ values: [['a']] });
  } });
  const rows = await Promise.all([client.readValues('A1'), client.readValues('B1')]);
  assert.equal(tokens, 1);
  assert.deepEqual(rows, [[['a']], [['a']]]);
});

test('private credential file loading and validation never expose keys or filesystem errors', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'gs-credentials-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'service-account.json');
  await writeFile(path, JSON.stringify(credentials));
  const client = new GoogleSheetsClient({ spreadsheetId, credentialsPath: path, fetch: async url => jsonResponse(url === 'https://oauth2.googleapis.com/token' ? goodToken() : { values: [] }) });
  assert.deepEqual(await client.readValues('A1'), []);
  for (const invalid of ['not-json-and-secret', JSON.stringify({ ...credentials, type: 'authorized_user' }), JSON.stringify({ ...credentials, client_email: 'bad@example.com' }), JSON.stringify({ ...credentials, private_key: 'secret-invalid-key' }), 'x'.repeat(65537)]) {
    await writeFile(path, invalid);
    const reader = new GoogleSheetsClient({ spreadsheetId, credentialsPath: path });
    await assert.rejects(reader.readValues('A1'), error => error.code === 'INVALID_CREDENTIALS' && !error.message.includes(path) && !error.message.includes('secret'));
  }
  const weakKeys = generateKeyPairSync('rsa', { modulusLength: 1024 });
  await assert.rejects(makeReader({ credentials: { ...credentials, private_key: weakKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }) } }).read(), { code: 'INVALID_CREDENTIALS' });
  const ecKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await assert.rejects(makeReader({ credentials: { ...credentials, private_key: ecKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }) } }).read(), { code: 'INVALID_CREDENTIALS' });
});

test('fixed endpoints reject invalid config, arbitrary URLs and traversal; readonly clients refuse writes', async () => {
  for (const config of [{ spreadsheetId: 'https://bad.invalid/a' }, { timeoutMs: 10001 }, { timeoutMs: 0 }, { maxResponseBytes: 64 * 1024 * 1024 + 1 }, { credentialsPath: 'a' }, { readonly: 'false' }]) assert.throws(() => makeReader(config), { code: 'INVALID_CONFIG' });
  const client = new GoogleSheetsClient({ spreadsheetId, credentials, fetch: () => { throw new Error('Must not fetch'); } });
  for (const suffix of ['https://attacker.invalid', '//attacker.invalid/path', '/../other/values/A1', '/%2e%2e/other/values/A1', '/values/A1#fragment', '/values/\nA1', '/values/\\other']) await assert.rejects(client.request('GET', suffix), { code: 'INVALID_REQUEST' });
  await assert.rejects(client.request('POST', ':batchUpdate', { requests: [] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(client.request('GET', '?fields=sheets', {}), { code: 'INVALID_REQUEST' });
});

test('writer explicitly uses writable Sheets scope, fixed metadata URL and RAW append payload', async () => {
  const calls = [];
  const client = new GoogleSheetsClient({ spreadsheetId, credentials, readonly: false, fetch: async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = new URLSearchParams(options.body).get('assertion');
      assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).scope, writerScope);
      return jsonResponse(goodToken({ scope: writerScope }));
    }
    return jsonResponse({ sheets: [], updates: { updatedRows: 1 } });
  } });
  await client.request('GET', '?fields=sheets.properties');
  const payload = { majorDimension: 'ROWS', values: [['=literal', 'value']] };
  await client.request('POST', `/values/${encodeURIComponent("'GS_Data'!A:I")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, payload);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`);
  assert.equal(JSON.parse(calls[2].options.body).values[0][0], '=literal');
  assert.equal(new URL(calls[2].url).searchParams.get('valueInputOption'), 'RAW');
});

test('401 invalidates token and retries once; subsequent provider failure is sanitized', async () => {
  let tokenCalls = 0;
  let sheetCalls = 0;
  const reader = makeReader({ fetch: async url => {
    if (url === 'https://oauth2.googleapis.com/token') { tokenCalls++; return jsonResponse(goodToken({ access_token: `token-${tokenCalls}` })); }
    sheetCalls++;
    return sheetCalls === 1 ? jsonResponse({ error: 'secret-token-and-private-key' }, 401) : jsonResponse({ values: values() });
  } });
  await reader.read();
  assert.equal(tokenCalls, 2);
  assert.equal(sheetCalls, 2);
  let calls = 0;
  const denied = makeReader({ fetch: async url => { calls++; return jsonResponse(url === 'https://oauth2.googleapis.com/token' ? goodToken() : { error: 'secret-token-and-private-key' }, url === 'https://oauth2.googleapis.com/token' ? 200 : 401); } });
  await assert.rejects(denied.read(), error => error.code === 'PROVIDER_ERROR' && error.httpStatus === 401 && !error.message.includes('secret'));
  assert.equal(calls, 4);
});

test('network, non-JSON and malformed OAuth responses expose only safe errors', async () => {
  const responses = [
    () => { throw new Error('secret-key-network-error'); },
    () => new Response('secret-key', { status: 403, headers: { 'content-type': 'text/html' } }),
    () => new Response('secret-key', { status: 200, headers: { 'content-type': 'text/html' } }),
    () => new Response('{not-json-secret}', { status: 200, headers: { 'content-type': 'application/json' } }),
    () => jsonResponse([]),
    () => jsonResponse(goodToken({ token_type: 'Other' })),
    () => jsonResponse(goodToken({ expires_in: '3600' })),
    () => jsonResponse(goodToken({ scope: writerScope })),
    () => jsonResponse(goodToken({ access_token: 'token\nsecret' }))
  ];
  for (const fetch of responses) await assert.rejects(makeReader({ fetch }).read(), error => error instanceof GoogleSheetsError && !error.message.includes('secret') && !error.message.includes('token'));
});

test('response body limits apply to OAuth, declared size and streamed Sheets bodies', async () => {
  await assert.rejects(makeReader({ fetch: async () => jsonResponse({ secret: 'x'.repeat(65536) }) }).read(), { code: 'RESPONSE_TOO_LARGE' });
  for (const declaredLength of [undefined, '2048']) {
    const reader = makeReader({ maxResponseBytes: 1024, fetch: async url => url === 'https://oauth2.googleapis.com/token' ? jsonResponse(goodToken()) : jsonResponse({ values: [['x'.repeat(2048)]] }, 200, declaredLength ? { 'content-length': declaredLength } : {}) });
    await assert.rejects(reader.read(), { code: 'RESPONSE_TOO_LARGE' });
  }
});

test('timeouts abort hanging fetch; recovery clears in-flight state', async () => {
  let hang = true;
  let aborted = false;
  const reader = makeReader({ timeoutMs: 30, fetch: async (url, options) => {
    if (hang) return new Promise((_, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('secret-aborted')); }, { once: true }));
    return jsonResponse(url === 'https://oauth2.googleapis.com/token' ? goodToken() : { values: values() });
  } });
  await assert.rejects(reader.read(), { code: 'TIMEOUT' });
  assert.ok(aborted);
  hang = false;
  assert.equal((await reader.read()).length, 1);
});

test('values response enforces rows and primitive cells before parsing permission data', async () => {
  for (const data of [{ majorDimension: 'COLUMNS', values: values() }, { values: 'invalid' }, { values: [[{ nested: 'secret' }]] }, { values: [null] }]) {
    await assert.rejects(makeReader({ fetch: async url => jsonResponse(url === 'https://oauth2.googleapis.com/token' ? goodToken() : data) }).read(), { code: 'INVALID_RESPONSE' });
  }
  const client = new GoogleSheetsClient({ spreadsheetId, credentials, fetch: async url => jsonResponse(url === 'https://oauth2.googleapis.com/token' ? goodToken() : {}) });
  assert.deepEqual(await client.readValues('A1'), []);
});

test('reader reads the whole quoted sheet and rejects populated cells beyond a former fixed window', async () => {
  const farHeader = [...SHEET_HEADERS, '', '', 'password'];
  const farCell = [...SHEET_HEADERS.map(header => person()[header]), '', '', 'unexpected-value'];
  const overflowRows = [SHEET_HEADERS, ...Array.from({ length: 5001 }, (_, index) => SHEET_HEADERS.map(header => person({ email: `person${index}@example.gov.vn` })[header]))];
  for (const data of [[farHeader, SHEET_HEADERS.map(header => person()[header])], [SHEET_HEADERS, farCell], overflowRows]) {
    let range;
    const reader = makeReader({ fetch: async url => {
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse(goodToken());
      range = decodeURIComponent(new URL(url).pathname.split('/values/')[1]);
      return jsonResponse({ values: data });
    } });
    await assert.rejects(reader.read(), { code: 'INVALID_PERMISSIONS' });
    assert.equal(range, "'Permissions'");
  }
});
