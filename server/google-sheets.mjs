import { createPrivateKey, sign, constants } from 'node:crypto';
import { open } from 'node:fs/promises';
import { ROLES, validateScope } from './auth.mjs';

export const SHEET_HEADERS = Object.freeze(['email', 'displayName', 'role', 'sourceSystems', 'agencyId', 'departmentId', 'officerId', 'active']);
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets/';
const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const MAX_USERS = 5000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CREDENTIAL_BYTES = 64 * 1024;

export class GoogleSheetsError extends Error {
  constructor(code, message, httpStatus) {
    super(message);
    this.name = 'GoogleSheetsError';
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

const sheetError = (row, message) => new GoogleSheetsError('INVALID_PERMISSIONS', `Google Sheet, dòng ${row}: ${message}`);
const blank = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
function textCell(value, row, label, { required = false, max = 200 } = {}) {
  if (blank(value)) {
    if (required) throw sheetError(row, `cột ${label} không được để trống.`);
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw sheetError(row, `cột ${label} không hợp lệ.`);
  return value.trim();
}

/** The whole snapshot must validate before any application permissions change. */
export function parsePermissionRows(values, { sourceIds } = {}) {
  if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) throw sheetError(1, 'thiếu hàng tiêu đề.');
  // Bound the complete used grid, including blank gaps between populated rows.
  if (values.length > MAX_USERS + 1) throw sheetError(MAX_USERS + 2, `vượt giới hạn ${MAX_USERS} dòng dữ liệu.`);
  const headerRow = values[0];
  const headers = [];
  for (let i = 0; i < headerRow.length; i++) {
    if (blank(headerRow[i]) && i >= SHEET_HEADERS.length) continue;
    const header = textCell(headerRow[i], 1, 'tiêu đề', { required: true, max: 40 });
    if (!SHEET_HEADERS.includes(header) || headers.includes(header)) throw sheetError(1, 'tiêu đề có cột lạ hoặc trùng lặp. Chỉ sử dụng mẫu phân quyền.');
    headers.push(header);
  }
  if (headers.length !== SHEET_HEADERS.length || SHEET_HEADERS.some(header => !headers.includes(header))) throw sheetError(1, `cần đủ các cột ${SHEET_HEADERS.join(', ')}.`);
  const allowedSources = sourceIds === undefined ? null : new Set(sourceIds);
  const users = [];
  const seen = new Set();
  for (let index = 1; index < values.length; index++) {
    const row = values[index];
    const line = index + 1;
    if (!Array.isArray(row)) throw sheetError(line, 'dữ liệu hàng không hợp lệ.');
    if (row.every(blank)) continue;
    if (row.slice(headers.length).some(value => !blank(value))) throw sheetError(line, 'có dữ liệu ngoài các cột của mẫu.');
    const cells = Object.fromEntries(headers.map((header, column) => [header, row[column]]));
    const email = textCell(cells.email, line, 'email', { required: true, max: 254 }).toLowerCase();
    const [local, domain] = email.split('@');
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) || local.length > 64 || local.startsWith('.') || local.endsWith('.') || email.includes('..') || domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw sheetError(line, 'email không hợp lệ.');
    if (seen.has(email)) throw sheetError(line, 'email bị trùng lặp.');
    seen.add(email);
    const displayName = textCell(cells.displayName, line, 'displayName', { required: true });
    const role = textCell(cells.role, line, 'role', { required: true, max: 50 });
    if (!ROLES.includes(role)) throw sheetError(line, 'vai trò không hợp lệ.');
    const sources = textCell(cells.sourceSystems, line, 'sourceSystems', { max: 5100 });
    const scopeInput = {};
    if (sources) {
      const parts = sources.split(/[,;]/).map(value => value.trim());
      if (parts.some(value => !value)) throw sheetError(line, 'danh sách nguồn có mục trống.');
      scopeInput.sourceSystems = [...new Set(parts)];
      if (allowedSources && scopeInput.sourceSystems.some(value => !allowedSources.has(value))) throw sheetError(line, 'mã nguồn chưa được hệ thống đăng ký.');
    }
    for (const key of ['agencyId', 'departmentId', 'officerId']) {
      const value = textCell(cells[key], line, key);
      if (value) scopeInput[key] = value;
    }
    let scope;
    try { scope = validateScope(role, scopeInput); }
    catch { throw sheetError(line, 'phạm vi dữ liệu không đủ hoặc không hợp lệ với vai trò.'); }
    const activeCell = cells.active;
    const active = typeof activeCell === 'boolean' ? activeCell : typeof activeCell === 'string' && ['TRUE', 'FALSE'].includes(activeCell.trim()) ? activeCell.trim() === 'TRUE' : null;
    if (active === null) throw sheetError(line, 'active phải là TRUE hoặc FALSE.');
    users.push({ email, displayName, role, scope, active });
  }
  if (!users.length) throw sheetError(2, 'cần ít nhất một tài khoản; dùng active=FALSE để thu hồi toàn bộ quyền.');
  return users;
}

/** Service-account transport with fixed Google endpoints and no user impersonation. */
export class GoogleSheetsClient {
  #fetch;
  #clock;
  #timeoutMs;
  #credentialInput;
  #credentialsPath;
  #credentials = null;
  #token = null;
  #tokenFlight = null;
  #scope;
  #maxResponseBytes;
  constructor({ spreadsheetId, credentialsPath, credentials, fetch: fetchImpl = globalThis.fetch, clock = Date.now, timeoutMs = 10000, readonly = true, maxResponseBytes = MAX_RESPONSE_BYTES } = {}) {
    if (typeof spreadsheetId !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(spreadsheetId)) throw new GoogleSheetsError('INVALID_CONFIG', 'ID Google Sheet không hợp lệ.');
    if (typeof readonly !== 'boolean' || typeof fetchImpl !== 'function' || typeof clock !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 64 * 1024 * 1024) throw new GoogleSheetsError('INVALID_CONFIG', 'Cấu hình kết nối Google Sheet không hợp lệ.');
    if ((!credentialsPath && !credentials) || (credentialsPath && credentials)) throw new GoogleSheetsError('INVALID_CONFIG', 'Cần đúng một nguồn thông tin service account trên máy chủ.');
    if (credentialsPath && (typeof credentialsPath !== 'string' || !credentialsPath.trim())) throw new GoogleSheetsError('INVALID_CONFIG', 'Đường dẫn service account không hợp lệ.');
    Object.defineProperties(this, {
      spreadsheetId: { value: spreadsheetId, enumerable: true },
      readonly: { value: readonly, enumerable: true }
    });
    this.#scope = readonly ? READ_SCOPE : WRITE_SCOPE;
    this.#fetch = fetchImpl;
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
    this.#credentialInput = credentials;
    this.#credentialsPath = credentialsPath;
  }

  async #loadCredentials() {
    if (this.#credentials) return this.#credentials;
    let input = this.#credentialInput;
    let handle;
    try {
      if (this.#credentialsPath) {
        handle = await open(this.#credentialsPath, 'r');
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_CREDENTIAL_BYTES) throw new Error('credentials');
        input = JSON.parse(await handle.readFile({ encoding: 'utf8' }));
      }
      if (!input || typeof input !== 'object' || Array.isArray(input) || input.type !== 'service_account' || typeof input.client_email !== 'string' || !/^[a-zA-Z0-9._-]+@(?:[a-zA-Z0-9-]+\.)+gserviceaccount\.com$/.test(input.client_email) || typeof input.private_key !== 'string' || input.private_key.length > MAX_CREDENTIAL_BYTES) throw new Error('credentials');
      const key = createPrivateKey(input.private_key);
      if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('credentials');
      if (input.private_key_id !== undefined && (typeof input.private_key_id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(input.private_key_id))) throw new Error('credentials');
      // token_uri is intentionally ignored. Never let credential JSON select a URL.
      this.#credentials = { email: input.client_email, key, keyId: input.private_key_id };
      return this.#credentials;
    } catch {
      throw new GoogleSheetsError('INVALID_CREDENTIALS', 'Không đọc được service account hợp lệ. Kiểm tra cấu hình khóa trên máy chủ.');
    } finally { if (handle) { try { await handle.close(); } catch { /* No filesystem details may escape. */ } } }
  }

  async #json(url, options, maxBytes = this.#maxResponseBytes) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new GoogleSheetsError('TIMEOUT', 'Kết nối Google Sheet quá thời gian chờ.'));
      }, this.#timeoutMs);
    });
    const operation = (async () => {
      let reader;
      try {
        const response = await this.#fetch(url, { ...options, redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', ...options.headers } });
        if (!response || !Number.isInteger(response.status) || response.redirected || response.status < 200 || response.status >= 300) {
          try { await response?.body?.cancel(); } catch { /* Do not expose rejected response bodies. */ }
          throw new GoogleSheetsError('PROVIDER_ERROR', 'Google từ chối kết nối. Kiểm tra API, quyền chia sẻ Sheet và service account.', Number.isInteger(response?.status) ? response.status : undefined);
        }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về dữ liệu không đúng định dạng.');
        const length = response.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new GoogleSheetsError('RESPONSE_TOO_LARGE', 'Dữ liệu Google Sheet vượt giới hạn cho phép.');
        if (!response.body || typeof response.body.getReader !== 'function') throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về dữ liệu không đúng định dạng.');
        reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new GoogleSheetsError('RESPONSE_TOO_LARGE', 'Dữ liệu Google Sheet vượt giới hạn cho phép.');
          chunks.push(Buffer.from(value));
        }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
        catch { throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về dữ liệu không đúng định dạng.'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về dữ liệu không đúng định dạng.');
        return data;
      } catch (error) {
        if (reader) { try { await reader.cancel(); } catch { /* Connection has already closed. */ } }
        if (error instanceof GoogleSheetsError) throw error;
        throw new GoogleSheetsError('CONNECTION_ERROR', 'Không thể kết nối Google Sheet. Kiểm tra kết nối máy chủ.');
      } finally { if (reader) reader.releaseLock(); }
    })();
    try { return await Promise.race([operation, timeout]); }
    finally { clearTimeout(timer); }
  }

  async #accessToken() {
    if (this.#token && this.#token.expiresAt > this.#clock() + 60000) return this.#token.value;
    if (this.#tokenFlight) return this.#tokenFlight;
    this.#tokenFlight = (async () => {
      const credentials = await this.#loadCredentials();
      const now = Math.floor(this.#clock() / 1000);
      const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const header = { alg: 'RS256', typ: 'JWT' };
      if (credentials.keyId) header.kid = credentials.keyId;
      const claims = { iss: credentials.email, scope: this.#scope, aud: TOKEN_URL, iat: now, exp: now + 3600 };
      const input = `${encoded(header)}.${encoded(claims)}`;
      const signature = sign('sha256', Buffer.from(input), { key: credentials.key, padding: constants.RSA_PKCS1_PADDING }).toString('base64url');
      const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` });
      const data = await this.#json(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, MAX_CREDENTIAL_BYTES);
      if (typeof data.access_token !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(data.access_token) || data.token_type !== 'Bearer' || !Number.isInteger(data.expires_in) || data.expires_in < 1 || data.expires_in > 3600 || (data.scope !== undefined && data.scope !== this.#scope)) throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về thông tin xác thực không hợp lệ.');
      this.#token = { value: data.access_token, expiresAt: this.#clock() + data.expires_in * 1000 };
      return this.#token.value;
    })();
    try { return await this.#tokenFlight; }
    finally { this.#tokenFlight = null; }
  }

  async request(method, suffix, body) {
    if (!['GET', 'POST', 'PUT'].includes(method) || (this.readonly && method !== 'GET') || typeof suffix !== 'string' || !/^(?:\/|:|\?)/.test(suffix) || suffix.startsWith('//') || suffix.includes('\\') || /[\u0000-\u0020\u007f]/.test(suffix) || suffix.includes('#') || (method === 'GET' && body !== undefined)) throw new GoogleSheetsError('INVALID_REQUEST', 'Yêu cầu Google Sheet không hợp lệ hoặc vượt quyền chỉ đọc.');
    const base = `${SHEETS_ROOT}${this.spreadsheetId}`;
    const url = new URL(base + suffix);
    const expectedPath = `/v4/spreadsheets/${this.spreadsheetId}`;
    if (url.origin !== 'https://sheets.googleapis.com' || !(url.pathname === expectedPath || url.pathname.startsWith(`${expectedPath}/`) || url.pathname.startsWith(`${expectedPath}:`))) throw new GoogleSheetsError('INVALID_REQUEST', 'Yêu cầu Google Sheet không hợp lệ.');
    let bodyText;
    try { bodyText = body === undefined ? undefined : JSON.stringify(body); }
    catch { throw new GoogleSheetsError('INVALID_REQUEST', 'Dữ liệu gửi Google Sheet không hợp lệ.'); }
    if (bodyText && Buffer.byteLength(bodyText) > this.#maxResponseBytes) throw new GoogleSheetsError('INVALID_REQUEST', 'Dữ liệu gửi Google Sheet vượt giới hạn.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#accessToken();
      try {
        return await this.#json(url.href, { method, headers: { authorization: `Bearer ${token}`, ...(bodyText ? { 'content-type': 'application/json' } : {}) }, ...(bodyText ? { body: bodyText } : {}) });
      } catch (error) {
        if (error.httpStatus !== 401 || attempt > 0) throw error;
        this.#token = null;
        this.#credentials = null;
      }
    }
  }

  async readValues(range) {
    if (typeof range !== 'string' || !range.trim() || range.length > 500 || /[\u0000-\u001f\u007f]/.test(range)) throw new GoogleSheetsError('INVALID_REQUEST', 'Vùng đọc Google Sheet không hợp lệ.');
    const data = await this.request('GET', `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`);
    if (data.majorDimension !== undefined && data.majorDimension !== 'ROWS') throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về hướng dữ liệu không đúng.');
    if (data.values === undefined) return [];
    if (!Array.isArray(data.values) || data.values.some(row => !Array.isArray(row) || row.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))) throw new GoogleSheetsError('INVALID_RESPONSE', 'Google trả về dữ liệu ô không đúng định dạng.');
    return data.values;
  }
}

export class GoogleSheetsReader extends GoogleSheetsClient {
  #sheetName;
  #sourceIds;
  #reading = null;
  constructor({ sheetName = 'Permissions', sourceIds, ...options } = {}) {
    if (options.readonly !== undefined && options.readonly !== true) throw new GoogleSheetsError('INVALID_CONFIG', 'Kết nối phân quyền chỉ được phép đọc Google Sheet.');
    super({ ...options, readonly: true });
    if (typeof sheetName !== 'string' || !sheetName.trim() || sheetName.length > 100 || /[\u0000-\u001f\u007f]/.test(sheetName)) throw new GoogleSheetsError('INVALID_CONFIG', 'Tên tab phân quyền không hợp lệ.');
    this.#sheetName = sheetName.trim();
    this.#sourceIds = sourceIds;
  }
  async read() {
    if (this.#reading) return this.#reading;
    this.#reading = (async () => {
      // Sheet-only A1 notation reads the complete used grid, so rows and columns
      // outside a fixed window cannot be silently excluded from validation.
      const range = `'${this.#sheetName.replaceAll("'", "''")}'`;
      return parsePermissionRows(await this.readValues(range), { sourceIds: this.#sourceIds });
    })();
    try { return await this.#reading; }
    finally { this.#reading = null; }
  }
}
