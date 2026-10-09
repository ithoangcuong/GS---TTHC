import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { authenticate, ADMIN_ROLES, ROLES, publicUser, verifyPassword, createSession, createUser, hashToken, validateScope, scopeWhere, hasAccess } from './auth.mjs';
import { audit, sourceMappings, transaction } from './database.mjs';
import { caseView, caseFilter, listCases, dashboard, syncBatch, jobView, recalculateDue, pageOptions } from './cases.mjs';
import { parseFile, applyMapping, toCsv, toXlsx } from './import.mjs';
import { normalizeCase, CANONICAL_FIELDS, STATUSES } from '../shared/normalize.mjs';
import { DEFAULT_RULE, validateRule } from './engine.ts';
import { listNotifications } from './notifications.mjs';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function requirePermission(condition, message = 'Bạn không có quyền thực hiện thao tác này.') { if (!condition) throw new HttpError(403, message); }
async function readBody(req, limit = 15 * 1024 * 1024) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Cần gửi JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn.'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new HttpError(400, 'JSON không hợp lệ.'); }
}
function json(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
function dates(row) { const result = { ...row }; for (const key of ['createdAt', 'updatedAt', 'lastSyncedAt', 'lastSuccessAt', 'startedAt', 'completedAt', 'firstDetectedAt', 'lastDetectedAt', 'acknowledgedAt']) if (typeof result[key] === 'number') result[key] = new Date(result[key]).toISOString(); return result; }
function allowedSource(user, id) { return user.role === 'SYSTEM_ADMIN' || user.scope?.sourceSystems?.includes(id); }
function getCase(db, id, user) { const row = db.prepare('SELECT * FROM cases WHERE id=?').get(id); if (!row || !hasAccess(user, JSON.parse(row.data))) throw new HttpError(404, 'Không tìm thấy hồ sơ trong phạm vi được cấp.'); return row; }
function sourceView(db, row, user) {
  const { where, params } = caseFilter(user, { sourceSystem: row.id });
  const records = db.prepare(`SELECT COUNT(*) n FROM cases c ${where}`).get(...params).n;
  const latest = db.prepare(`SELECT * FROM sync_jobs WHERE sourceId=?${user.role === 'SYSTEM_ADMIN' ? '' : ' AND initiatedBy=?'} ORDER BY startedAt DESC LIMIT 1`).get(row.id, ...(user.role === 'SYSTEM_ADMIN' ? [] : [user.id]));
  const scoped = user.role === 'SYSTEM_ADMIN' ? row : { ...row, lastSyncedAt: latest?.completedAt || null, lastSuccessAt: latest && latest.status !== 'SYNC_ERROR' ? latest.completedAt : null, lastError: latest?.error || null };
  return { ...dates(scoped), adapterVersion: row.version, status: !row.enabled ? 'DISABLED' : scoped.lastError ? 'SYNC_ERROR' : scoped.lastSuccessAt ? 'SYNC_SUCCESS' : row.adapterStatus === 'WAITING_FOR_SAMPLE' ? 'ADAPTER_ERROR' : 'READY', records, lastSync: latest ? dates(jobView(latest)) : null };
}
function validateCalendar(calendar) {
  if (!calendar || typeof calendar.confirmed !== 'boolean' || !Array.isArray(calendar.workingWeekdays) || calendar.workingWeekdays.some(v => !Number.isInteger(v) || v < 0 || v > 6)) throw new HttpError(400, 'Lịch làm việc không hợp lệ.');
  for (const key of ['holidays', 'workingDates']) if (!Array.isArray(calendar[key]) || calendar[key].length > 10000 || calendar[key].some(v => typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) throw new HttpError(400, 'Danh sách ngày nghỉ/làm bù không hợp lệ.');
  if (calendar.confirmed && !calendar.workingWeekdays.length) throw new HttpError(400, 'Lịch đã xác nhận cần ngày làm việc.');
  return { confirmed: calendar.confirmed, workingWeekdays: [...new Set(calendar.workingWeekdays)], holidays: [...new Set(calendar.holidays)], workingDates: [...new Set(calendar.workingDates)] };
}
export function createApp(db, options = {}) {
  const appOrigin = options.origin || process.env.APP_ORIGIN || 'http://localhost:3000';
  const originUrl = new URL(appOrigin); const production = options.production ?? process.env.NODE_ENV === 'production';
  if (production && originUrl.protocol !== 'https:') throw new Error('Production cần APP_ORIGIN dùng HTTPS.');
  const webRoot = resolve(options.webRoot || './web'); const limits = new Map();
  const authMode = options.authMode || 'local'; const { googleOidc, permissions, sheetStore } = options;
  if (authMode === 'google' && (!googleOidc || !permissions)) throw new Error('Đăng nhập Google cần kết nối OAuth và bảng quyền.');
  function rateLimit(req, key, max, window) {
    const now = Date.now(); const identity = `${req.socket.remoteAddress}:${key}`; let entry = limits.get(identity);
    if (!entry || now >= entry.until) { entry = { count: 0, until: now + window }; limits.set(identity, entry); }
    if (++entry.count > max) throw new HttpError(429, 'Quá nhiều yêu cầu. Vui lòng thử lại sau.');
    if (limits.size > 20000) for (const [id, value] of limits) if (value.until < now) limits.delete(id);
  }
  const cookie = (token, age) => `gs_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production ? '; Secure' : ''}`;
  const googleCookie = (token, age) => `gs_google=${token}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? '; Secure' : ''}`;
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const respond = async (status, body, headers = {}) => { if (sheetStore) await sheetStore.flush(); json(res, status, body, headers); };
    try {
      const url = new URL(req.url, appOrigin); const path = url.pathname; const query = Object.fromEntries(url.searchParams); const method = req.method;
      if (req.headers.host !== originUrl.host && !(options.allowAnyHost || (!production && ['127.0.0.1', 'localhost'].includes(req.headers.host?.split(':')[0])))) throw new HttpError(403, 'Hostname không được phép.');
      const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin || '');
      if (extensionOrigin && path === '/api/collector/sync') {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      }
      if (!path.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Phương thức không hỗ trợ.');
        const asset = ['.js', '.css', '.svg', '.ico', '.png', '.mjs'].includes(extname(path));
        const decoded = decodeURIComponent(path); const filePath = resolve(webRoot, asset ? `.${decoded}` : 'index.html');
        if (!filePath.startsWith(`${webRoot}${sep}`)) throw new HttpError(404, 'Không tìm thấy tài nguyên.');
        let file; try { file = await readFile(filePath); } catch { throw new HttpError(404, 'Không tìm thấy tài nguyên.'); }
        const contentType = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.png': 'image/png' }[extname(filePath)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(method === 'HEAD' ? undefined : file); return;
      }
      rateLimit(req, 'api', 600, 60000);
      if (path === '/api/health' && method === 'GET') { json(res, 200, { status: 'ok', version: '0.1.0' }); return; }
      if (path === '/api/auth/config' && method === 'GET') { json(res, 200, { mode: authMode, googleConfigured: Boolean(googleOidc), permissionsProvider: permissions ? 'google_sheets' : 'local', dataBackend: sheetStore ? 'google_sheets' : 'sqlite' }); return; }
      if (path === '/api/auth/google/start' && method === 'GET') {
        requirePermission(authMode === 'google'); rateLimit(req, 'google-login', 20, 60000);
        await permissions.ensureFresh();
        const flow = googleOidc.start();
        res.writeHead(302, { Location: flow.authorizationUrl, 'Cache-Control': 'no-store', 'Set-Cookie': googleCookie(flow.browserToken, 300) }); res.end(); return;
      }
      if (path === '/api/auth/google/callback' && method === 'GET') {
        requirePermission(authMode === 'google'); rateLimit(req, 'google-callback', 20, 60000);
        try {
          if (query.error) throw new HttpError(401, 'Đăng nhập Google bị hủy.');
          const browserToken = /(?:^|;\s*)gs_google=([a-zA-Z0-9_-]{40,200})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
          const identity = await googleOidc.finish({ state: query.state, code: query.code, browserToken });
          await permissions.ensureFresh();
          const signedUser = permissions.login(identity); audit(db, signedUser.id, 'GOOGLE_LOGIN_SUCCEEDED');
          if (sheetStore) await sheetStore.flush();
          const session = createSession(db, signedUser.id);
          res.writeHead(303, { Location: '/dashboard', 'Cache-Control': 'no-store', 'Set-Cookie': [googleCookie('', 0), cookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000))] }); res.end(); return;
        } catch (error) {
          const reason = error.status === 403 ? 'permission_denied' : error.status === 503 ? 'unavailable' : 'google_failed';
          res.writeHead(303, { Location: `/login?authError=${reason}`, 'Cache-Control': 'no-store', 'Set-Cookie': googleCookie('', 0) }); res.end(); return;
        }
      }
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (mutating && !extensionOrigin && req.headers.origin && req.headers.origin !== appOrigin) throw new HttpError(403, 'Origin không được phép.');
      if (path === '/api/auth/login' && method === 'POST') {
        requirePermission(authMode === 'local', 'Hệ thống dùng đăng nhập Google.');
        rateLimit(req, 'login', 10, 15 * 60000); const body = await readBody(req, 4096);
        const row = typeof body.username === 'string' ? db.prepare('SELECT * FROM users WHERE username=?').get(body.username) : null;
        const valid = await verifyPassword(body.password, row?.passwordHash);
        if (!valid || !row?.active) { audit(db, null, 'LOGIN_FAILED', '', {}); throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng.'); }
        const session = createSession(db, row.id); audit(db, row.id, 'LOGIN_SUCCEEDED');
        await respond(200, { user: publicUser(row), csrfToken: session.csrfToken, demoMode: db.prepare('SELECT value FROM system_settings WHERE key=?').get('demoMode')?.value === 'true' }, { 'Set-Cookie': cookie(session.token, Math.floor((session.expiresAt - Date.now()) / 1000)) }); return;
      }
      if (permissions) await permissions.ensureFresh();
      const auth = authenticate(db, req, permissions ? row => permissions.authorize(row) : publicUser); if (!auth) throw new HttpError(401, 'Vui lòng đăng nhập hệ thống trung tâm.');
      const user = auth.user;
      if (auth.collector && !(method === 'POST' && path === '/api/collector/sync')) throw new HttpError(403, 'Token collector chỉ được dùng cho đồng bộ.');
      if (mutating && !auth.collector && req.headers['x-csrf-token'] !== auth.csrfToken) throw new HttpError(403, 'CSRF token không hợp lệ; hãy tải lại trang.');
      if (sheetStore) await sheetStore.flush();
      if (path === '/api/admin/permissions/refresh' && method === 'POST') {
        requirePermission(user.role === 'SYSTEM_ADMIN' && Boolean(permissions));
        const provider = await permissions.refresh(user.id); await respond(200, { provider }); return;
      }
      if (path === '/api/auth/me' && method === 'GET') { await respond(200, { user, csrfToken: auth.csrfToken, demoMode: db.prepare('SELECT value FROM system_settings WHERE key=?').get('demoMode')?.value === 'true' }); return; }
      if (path === '/api/auth/logout' && method === 'POST') { transaction(db, () => { db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(auth.sessionHash); db.prepare('DELETE FROM collector_tokens WHERE userId=?').run(user.id); audit(db, user.id, 'LOGOUT'); }); await respond(200, { ok: true }, { 'Set-Cookie': cookie('', 0) }); return; }
      if (path === '/api/collector/tokens' && method === 'POST') {
        requirePermission(user.role !== 'VIEWER'); rateLimit(req, `tokens:${user.id}`, 10, 60000);
        const token = randomBytes(32).toString('base64url'); const expiresAt = Date.now() + Math.max(5, Math.min(60, Number(process.env.COLLECTOR_TOKEN_MINUTES) || 30)) * 60000;
        db.prepare('INSERT INTO collector_tokens VALUES (?,?,?)').run(hashToken(token), user.id, expiresAt); audit(db, user.id, 'COLLECTOR_TOKEN_ISSUED');
        await respond(201, { token, expiresAt: new Date(expiresAt).toISOString() }); return;
      }
      if (path === '/api/collector/sync' && method === 'POST') {
        requirePermission(auth.collector, 'Đồng bộ extension cần token collector riêng.'); rateLimit(req, `sync:${user.id}`, 30, 60000);
        const body = await readBody(req, 2 * 1024 * 1024); await respond(200, syncBatch(db, { sourceSystem: body.sourceSystem, records: body.records, batchId: body.batchId, kind: 'COLLECTOR' }, user)); return;
      }
      if (method === 'GET' && (['/api/cases', '/api/dashboard', '/api/reports', '/api/reports/export', '/api/alerts'].includes(path) || path.startsWith('/api/cases/'))) recalculateDue(db);
      if (path === '/api/cases' && method === 'GET') { await respond(200, listCases(db, user, query)); return; }
      const caseMatch = /^\/api\/cases\/([^/]+)$/.exec(path);
      if (caseMatch && method === 'GET') {
        const row = getCase(db, caseMatch[1], user);
        const history = db.prepare('SELECT * FROM case_history WHERE caseId=? ORDER BY createdAt DESC LIMIT 200').all(row.id).map(item => ({ ...dates(item), type: item.kind, changes: JSON.parse(item.changes) }));
        if (user.role === 'VIEWER') for (const item of history) { if (item.changes.applicantName) item.changes.applicantName = { from: '***', to: '***' }; delete item.changes.metadata; }
        await respond(200, { case: caseView(row, user), history, alerts: db.prepare('SELECT * FROM alerts WHERE caseId=?').all(row.id).map(item => ({ ...dates(item), reason: JSON.parse(item.reason) })) }); return;
      }
      if (['/api/dashboard', '/api/reports'].includes(path) && method === 'GET') { await respond(200, dashboard(db, user, query)); return; }
      if (path === '/api/reports/export' && method === 'GET') {
        rateLimit(req, `export:${user.id}`, 5, 60000); const { where, params } = caseFilter(user, query);
        const total = db.prepare(`SELECT COUNT(*) n FROM cases c ${where}`).get(...params).n;
        if (total > 10000) throw new HttpError(400, 'Giới hạn 10.000 dòng mỗi lần xuất. Hãy lọc khoảng ngày hoặc đơn vị.');
        const rows = db.prepare(`SELECT c.* FROM cases c ${where} ORDER BY dueAt LIMIT 10000`).all(...params).map(row => caseView(row, user));
        const columns = ['caseCode', 'sourceSystem', 'procedureName', 'applicantName', 'agencyName', 'officerName', 'receivedAt', 'effectiveDueAt', 'normalizedStatus', 'alertLevel', 'riskScore'];
        const xlsx = query.format === 'xlsx'; const file = xlsx ? toXlsx(rows, columns) : Buffer.from(toCsv(rows, columns), 'utf8');
        audit(db, user.id, 'REPORT_EXPORTED', '', { rows: rows.length, format: xlsx ? 'xlsx' : 'csv' });
        if (sheetStore) await sheetStore.flush();
        res.writeHead(200, { 'Content-Type': xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ho-so.${xlsx ? 'xlsx' : 'csv'}"`, 'Cache-Control': 'no-store' }); res.end(file); return;
      }
      if (path === '/api/alerts' && method === 'GET') {
        const { where, params } = caseFilter(user, query); const { page, pageSize, offset } = pageOptions(query); const filter = `${where || 'WHERE 1=1'}${query.status ? ' AND a.status=?' : " AND a.status<>'RESOLVED'"}`; if (query.status) params.push(query.status);
        const total = db.prepare(`SELECT COUNT(*) n FROM alerts a JOIN cases c ON c.id=a.caseId ${filter}`).get(...params).n;
        const items = db.prepare(`SELECT a.*,c.caseCode,c.sourceSystem FROM alerts a JOIN cases c ON c.id=a.caseId ${filter} ORDER BY CASE a.level WHEN 'CRITICAL_OVERDUE' THEN 0 WHEN 'OVERDUE' THEN 1 WHEN 'HIGH_RISK' THEN 2 ELSE 3 END,c.dueAt LIMIT ? OFFSET ?`).all(...params, pageSize, offset).map(row => ({ ...dates(row), reason: JSON.parse(row.reason) }));
        await respond(200, { items, total, page, pageSize }); return;
      }
      const acknowledge = /^\/api\/alerts\/([^/]+)\/acknowledge$/.exec(path);
      if (acknowledge && method === 'POST') {
        requirePermission(user.role !== 'VIEWER'); const alert = db.prepare('SELECT * FROM alerts WHERE id=?').get(acknowledge[1]); if (!alert) throw new HttpError(404, 'Không tìm thấy cảnh báo.'); getCase(db, alert.caseId, user);
        if (alert.status === 'RESOLVED') throw new HttpError(409, 'Cảnh báo đã kết thúc.');
        transaction(db, () => { db.prepare('UPDATE alerts SET status=?,acknowledgedAt=?,acknowledgedBy=? WHERE id=?').run('ACKNOWLEDGED', Date.now(), user.id, alert.id); db.prepare('INSERT INTO alert_history VALUES (?,?,?,?,?,?)').run(randomUUID(), alert.id, alert.level, alert.level, 'ACKNOWLEDGED', Date.now()); audit(db, user.id, 'ALERT_ACKNOWLEDGED', alert.id); });
        await respond(200, { ok: true }); return;
      }
      if (path === '/api/sources' && method === 'GET') { await respond(200, { items: db.prepare('SELECT * FROM source_systems ORDER BY rowid').all().filter(source => allowedSource(user, source.id)).map(source => sourceView(db, source, user)) }); return; }
      const sourceMatch = /^\/api\/sources\/([^/]+)$/.exec(path);
      if (sourceMatch) {
        const id = sourceMatch[1].toUpperCase(); const source = db.prepare('SELECT * FROM source_systems WHERE id=?').get(id);
        if (!source || !allowedSource(user, id)) throw new HttpError(404, 'Không tìm thấy nguồn được cấp.');
        if (method === 'GET') { await respond(200, { source: sourceView(db, source, user), ...sourceMappings(db, id), jobs: db.prepare(`SELECT * FROM sync_jobs WHERE sourceId=?${user.role === 'SYSTEM_ADMIN' ? '' : ' AND initiatedBy=?'} ORDER BY startedAt DESC LIMIT 30`).all(id, ...(user.role === 'SYSTEM_ADMIN' ? [] : [user.id])).map(row => dates(jobView(row))) }); return; }
        if (method === 'PATCH') { requirePermission(user.role === 'SYSTEM_ADMIN' || user.role === 'CENTRAL_ADMIN' && !['agencyId', 'departmentId', 'officerId'].some(key => user.scope?.[key])); const body = await readBody(req, 4096); if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled cần là boolean.'); db.prepare('UPDATE source_systems SET enabled=? WHERE id=?').run(Number(body.enabled), id); audit(db, user.id, 'SOURCE_UPDATED', id, { enabled: body.enabled }); await respond(200, { ok: true }); return; }
      }
      if (path === '/api/catalogs' && method === 'GET') {
        const result = {};
        for (const [table, column] of [['agencies', 'agencyId'], ['departments', 'departmentId'], ['officers', 'officerId'], ['procedures', 'procedureCode']]) {
          const { where, params } = caseFilter(user); const join = table === 'procedures' ? 'e.code=c.procedureCode AND e.sourceSystem=c.sourceSystem' : `e.id=c.${column}`;
          result[table] = db.prepare(`SELECT DISTINCT e.* FROM ${table} e JOIN cases c ON ${join} ${where} ORDER BY e.name LIMIT 2000`).all(...params);
        }
        await respond(200, { ...result, roles: ROLES, statuses: STATUSES, canonicalFields: CANONICAL_FIELDS }); return;
      }
      if (path === '/api/settings' && method === 'GET') { requirePermission(ADMIN_ROLES.includes(user.role)); await respond(200, { rules: db.prepare('SELECT * FROM alert_rules').all().filter(row => user.role === 'SYSTEM_ADMIN' || row.scopeType === 'GLOBAL' || row.scopeType === 'SOURCE' && allowedSource(user, row.scopeId)).map(row => ({ ...row, config: JSON.parse(row.config) })), calendar: JSON.parse(db.prepare('SELECT value FROM system_settings WHERE key=?').get('calendar').value), defaultRule: DEFAULT_RULE }); return; }
      if (path === '/api/settings/rules' && method === 'PUT') {
        requirePermission(user.role === 'SYSTEM_ADMIN'); const body = await readBody(req, 16384);
        if (!['GLOBAL', 'SOURCE', 'AGENCY', 'PROCEDURE'].includes(body.scopeType) || typeof body.scopeId !== 'string' || !body.scopeId || body.scopeId.length > 200 || body.scopeType === 'GLOBAL' && body.scopeId !== '*') throw new HttpError(400, 'Phạm vi rule không hợp lệ.');
        const config = { ...DEFAULT_RULE, ...body.config, risk: { ...DEFAULT_RULE.risk, ...body.config?.risk } }; validateRule(config);
        transaction(db, () => { db.prepare('INSERT INTO alert_rules VALUES (?,?,?,?) ON CONFLICT(scopeType,scopeId) DO UPDATE SET config=excluded.config,updatedAt=excluded.updatedAt').run(body.scopeType, body.scopeId, JSON.stringify(config), Date.now()); db.prepare('UPDATE cases SET nextRecalculationAt=0').run(); audit(db, user.id, 'RULE_UPDATED', `${body.scopeType}:${body.scopeId}`, config); });
        await respond(200, { ok: true }); return;
      }
      if (path === '/api/settings/calendar' && method === 'PUT') { requirePermission(user.role === 'SYSTEM_ADMIN'); const body = await readBody(req, 256000); const calendar = validateCalendar(body.calendar); db.prepare('UPDATE system_settings SET value=? WHERE key=?').run(JSON.stringify(calendar), 'calendar'); audit(db, user.id, 'CALENDAR_UPDATED', 'calendar', calendar); await respond(200, { ok: true }); return; }
      if (path.startsWith('/api/import/') && method === 'POST') {
        requirePermission(user.role !== 'VIEWER'); rateLimit(req, `import:${user.id}`, 10, 60000); const body = await readBody(req); const parsed = parseFile(body.fileName, body.base64);
        if (path === '/api/import/preview') { await respond(200, { ...parsed, rows: parsed.rows.slice(0, 20) }); return; }
        requirePermission(allowedSource(user, body.sourceSystem), 'Nguồn import nằm ngoài phạm vi được cấp.');
        if (!body.mapping || typeof body.mapping !== 'object' || Array.isArray(body.mapping) || !Object.values(body.mapping).includes('caseCode')) throw new HttpError(400, 'Cần mapping cột mã hồ sơ.');
        const rows = applyMapping(parsed.rows, body.mapping, parsed.headers);
        if (path === '/api/import/validate') {
          const errors = []; let valid = 0;
          for (let index = 0; index < rows.length; index++) try { const record = normalizeCase(rows[index], body.sourceSystem, sourceMappings(db, body.sourceSystem)); if (!hasAccess(user, record) && user.role !== 'SYSTEM_ADMIN') throw new Error('Dữ liệu thiếu hoặc không khớp ID phạm vi được cấp.'); valid++; } catch (error) { errors.push({ row: index + 2, error: error.message }); }
          await respond(200, { totalRows: rows.length, valid, invalid: errors.length, errors }); return;
        }
        if (path === '/api/import/commit') { await respond(200, syncBatch(db, { sourceSystem: body.sourceSystem, records: rows, kind: 'IMPORT', batchId: body.batchId }, user)); return; }
      }
      if (path === '/api/admin/roles' && method === 'GET') { requirePermission(user.role === 'SYSTEM_ADMIN'); await respond(200, { items: ROLES.map(role => ({ id: role, name: role, permissions: role === 'SYSTEM_ADMIN' ? ['ALL'] : role === 'VIEWER' ? ['READ_SCOPED'] : ['READ_SCOPED', 'SYNC_SCOPED', 'ACKNOWLEDGE_SCOPED'], requiresScope: role !== 'SYSTEM_ADMIN' })) }); return; }
      if (path === '/api/admin/users') {
        requirePermission(user.role === 'SYSTEM_ADMIN');
        if (method === 'GET') { await respond(200, { items: permissions ? permissions.users() : db.prepare('SELECT * FROM users ORDER BY createdAt').all().map(publicUser), provider: permissions ? permissions.status() : { provider: 'local' }, storage: sheetStore?.status() || { provider: 'sqlite' } }); return; }
        if (method === 'POST') { requirePermission(!permissions, 'Cấp quyền và thêm email trực tiếp trong tab Permissions trên Google Sheet.'); const body = await readBody(req, 16384); await respond(201, { user: await createUser(db, body, user.id) }); return; }
      }
      const userMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(path);
      if (userMatch && method === 'PATCH') {
        requirePermission(!permissions, 'Chỉnh sửa quyền trực tiếp trên Google Sheet.');
        requirePermission(user.role === 'SYSTEM_ADMIN'); const body = await readBody(req, 16384); const target = db.prepare('SELECT * FROM users WHERE id=?').get(userMatch[1]); if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản.');
        const role = body.role || target.role; if (!ROLES.includes(role) || body.active !== undefined && typeof body.active !== 'boolean') throw new HttpError(400, 'Vai trò/trạng thái không hợp lệ.');
        if (target.id === user.id && (body.active === false || role !== 'SYSTEM_ADMIN')) throw new HttpError(400, 'Không tự vô hiệu hóa hoặc hạ quyền tài khoản đang quản trị.');
        const scope = validateScope(role, body.scope || JSON.parse(target.scope));
        transaction(db, () => { db.prepare('UPDATE users SET active=?,role=?,scope=? WHERE id=?').run(body.active === undefined ? target.active : Number(body.active), role, JSON.stringify(scope), target.id); db.prepare('DELETE FROM sessions WHERE userId=?').run(target.id); db.prepare('DELETE FROM collector_tokens WHERE userId=?').run(target.id); audit(db, user.id, 'USER_UPDATED', target.id, { role, active: body.active, scope }); });
        await respond(200, { ok: true }); return;
      }
      if (path === '/api/audit-logs' && method === 'GET') { requirePermission(user.role === 'SYSTEM_ADMIN'); const { page, pageSize, offset } = pageOptions(query); await respond(200, { items: db.prepare('SELECT a.*,u.displayName FROM audit_logs a LEFT JOIN users u ON u.id=a.userId ORDER BY a.createdAt DESC LIMIT ? OFFSET ?').all(pageSize, offset).map(row => ({ ...dates(row), details: JSON.parse(row.details) })), total: db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, page, pageSize }); return; }
      if (path === '/api/sync-jobs' && method === 'GET') { const sourceIds = db.prepare('SELECT id FROM source_systems').all().map(row => row.id).filter(id => allowedSource(user, id)); const items = sourceIds.length ? db.prepare(`SELECT * FROM sync_jobs WHERE sourceId IN (${sourceIds.map(() => '?').join(',')}) AND ${user.role === 'SYSTEM_ADMIN' ? '1=1' : 'initiatedBy=?'} ORDER BY startedAt DESC LIMIT 100`).all(...sourceIds, ...(user.role === 'SYSTEM_ADMIN' ? [] : [user.id])).map(row => dates(jobView(row))) : []; await respond(200, { items }); return; }
      if (path === '/api/notifications' && method === 'GET') { await respond(200, { items: listNotifications(db, caseFilter(user)).map(dates) }); return; }
      throw new HttpError(404, 'Không tìm thấy API.');
    } catch (error) {
      const status = error.status || (error.code?.startsWith('ERR_SQLITE') ? 409 : error instanceof SyntaxError || error.message?.match(/không hợp lệ|cần |phải |invalid|required|missing|timestamp|mapping|quá lớn|Giới hạn|ZIP|XML|CSV|XLSX|password|file|base64/i) ? 400 : 500);
      if (status >= 500) console.error(JSON.stringify({ requestId, event: 'REQUEST_FAILED', errorType: error.name }));
      if (!res.headersSent) json(res, status, { error: status >= 500 ? 'Hệ thống gặp lỗi; vui lòng thử lại.' : error.message, requestId }); else res.end();
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  let stopped = false; let timer;
  async function sweep() {
    if (stopped) return;
    try {
      if (permissions) await permissions.ensureFresh();
      if (stopped) return;
      if (sheetStore) await sheetStore.flush();
      const count = recalculateDue(db);
      db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(Date.now()); db.prepare('DELETE FROM collector_tokens WHERE expiresAt<=?').run(Date.now());
      if (sheetStore) await sheetStore.flush();
      if (count === 500 && !stopped) { setImmediate(sweep); return; }
    } catch (error) { console.error(JSON.stringify({ event: 'ENGINE_SWEEP_FAILED', errorType: error.name })); }
    if (!stopped) { timer = setTimeout(sweep, Math.max(1, Number(process.env.RECALCULATE_INTERVAL_SECONDS) || 30) * 1000); timer.unref(); }
  }
  if (options.background !== false) { timer = setTimeout(sweep, 100); timer.unref(); }
  server.on('close', () => { stopped = true; clearTimeout(timer); });
  return server;
}
