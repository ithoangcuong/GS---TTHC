import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { audit } from './database.mjs';
const scrypt = promisify(scryptCallback);
export const ROLES = ['SYSTEM_ADMIN', 'CENTRAL_ADMIN', 'AGENCY_LEADER', 'DEPARTMENT_LEADER', 'OFFICER', 'VIEWER'];
export const ADMIN_ROLES = ['SYSTEM_ADMIN', 'CENTRAL_ADMIN'];
export function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Mật khẩu phải có 12–256 ký tự.');
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt}:${key.toString('hex')}`;
}
const DUMMY_HASH = '00112233445566778899aabbccddeeff:'.padEnd(161, '0');
export async function verifyPassword(password, encoded = DUMMY_HASH) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const safeEncoded = typeof encoded === 'string' && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded) ? encoded : DUMMY_HASH;
  const [salt, value] = safeEncoded.split(':');
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(value, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected);
}
export function publicUser(row) { return { id: row.id, username: row.username, displayName: row.displayName, role: row.role, scope: JSON.parse(row.scope), active: Boolean(row.active), ...(row.email ? { email: row.email, authProvider: 'google' } : {}) }; }
export async function createUser(db, input, actor = null) {
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(input.username || '') || !input.displayName?.trim() || input.displayName.length > 200 || !ROLES.includes(input.role)) throw new Error('Tên đăng nhập/tên hiển thị/vai trò không hợp lệ.');
  const scope = validateScope(input.role, input.scope || {});
  const row = { id: randomUUID(), username: input.username, displayName: input.displayName.trim(), passwordHash: await hashPassword(input.password), role: input.role, scope: JSON.stringify(scope), active: 1, createdAt: Date.now() };
  db.prepare('INSERT INTO users(id,username,displayName,passwordHash,role,scope,active,createdAt) VALUES (?,?,?,?,?,?,?,?)').run(...Object.values(row));
  audit(db, actor, 'USER_CREATED', row.id, { role: row.role, scope });
  return publicUser(row);
}
export function validateScope(role, scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw new Error('Phạm vi dữ liệu không hợp lệ.');
  const clean = {};
  if (scope.sourceSystems !== undefined) {
    if (!Array.isArray(scope.sourceSystems) || scope.sourceSystems.length > 100 || scope.sourceSystems.some(s => typeof s !== 'string' || !/^[A-Z0-9_]{1,50}$/.test(s))) throw new Error('Danh sách nguồn không hợp lệ.');
    clean.sourceSystems = [...new Set(scope.sourceSystems)];
  }
  for (const key of ['agencyId', 'departmentId', 'officerId']) if (scope[key]) {
    if (typeof scope[key] !== 'string' || scope[key].length > 200) throw new Error('Phạm vi đơn vị/cán bộ không hợp lệ.');
    clean[key] = scope[key];
  }
  if (role === 'AGENCY_LEADER' && !clean.agencyId) throw new Error('Lãnh đạo cơ quan cần agencyId được cấp.');
  if (role === 'DEPARTMENT_LEADER' && !clean.departmentId) throw new Error('Lãnh đạo phòng cần departmentId được cấp.');
  if (role === 'OFFICER' && !clean.officerId) throw new Error('Cán bộ cần officerId được cấp.');
  if (role !== 'SYSTEM_ADMIN' && (!clean.sourceSystems || !clean.sourceSystems.length)) throw new Error('Cần cấp rõ danh sách nguồn được phép truy cập.');
  return clean;
}
export function hasAccess(user, record) {
  if (user.role === 'SYSTEM_ADMIN') return true;
  const scope = user.scope || {};
  if (!scope.sourceSystems?.includes(record.sourceSystem)) return false;
  return ['agencyId', 'departmentId', 'officerId'].every(key => !scope[key] || scope[key] === record[key]);
}
export function scopeWhere(user, alias = 'c') {
  if (user.role === 'SYSTEM_ADMIN') return { clauses: [], params: [] };
  const ids = user.scope?.sourceSystems || [];
  if (!ids.length) return { clauses: ['0=1'], params: [] };
  const clauses = [`${alias}.sourceSystem IN (${ids.map(() => '?').join(',')})`];
  const params = [...ids];
  for (const key of ['agencyId', 'departmentId', 'officerId']) if (user.scope[key]) { clauses.push(`${alias}.${key}=?`); params.push(user.scope[key]); }
  return { clauses, params };
}
export function authenticate(db, request, resolveUser = publicUser) {
  const bearer = /^Bearer ([a-zA-Z0-9_-]{40,200})$/.exec(request.headers.authorization || '');
  if (bearer) {
    const token = db.prepare('SELECT userId,expiresAt FROM collector_tokens WHERE tokenHash=?').get(hashToken(bearer[1]));
    if (!token || token.expiresAt <= Date.now()) return null;
    const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(token.userId);
    const resolved = user ? resolveUser(user) : null;
    return resolved ? { user: resolved, collector: true } : null;
  }
  const match = /(?:^|;\s*)gs_session=([a-zA-Z0-9_-]{40,200})(?:;|$)/.exec(request.headers.cookie || '');
  if (!match) return null;
  const session = db.prepare('SELECT userId,csrfToken,expiresAt FROM sessions WHERE tokenHash=?').get(hashToken(match[1]));
  if (!session || session.expiresAt <= Date.now()) return null;
  const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(session.userId);
  const resolved = user ? resolveUser(user) : null;
  return resolved ? { user: resolved, csrfToken: session.csrfToken, sessionHash: hashToken(match[1]), collector: false } : null;
}
export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url'); const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + Math.max(1, Math.min(24, Number(process.env.SESSION_HOURS) || 8)) * 3600000;
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hashToken(token), userId, csrfToken, expiresAt);
  return { token, csrfToken, expiresAt };
}
