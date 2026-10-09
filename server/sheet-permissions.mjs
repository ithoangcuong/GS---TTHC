import { createHash, randomUUID } from 'node:crypto';
import { audit, transaction } from './database.mjs';
import { publicUser } from './auth.mjs';

export class PermissionUnavailableError extends Error {
  constructor() { super('Chưa xác nhận được quyền từ Google Sheet. Vui lòng thử lại hoặc liên hệ quản trị viên.'); this.status = 503; }
}
const signature = grant => JSON.stringify([grant?.role, grant?.scope, grant?.active, grant?.displayName]);

export class SheetPermissions {
  constructor(db, { reader, spreadsheetId, sheetName = 'Permissions', refreshSeconds = 30, maxAgeSeconds = 120, clock = Date.now }) {
    this.db = db; this.reader = reader; this.clock = clock;
    this.spreadsheetId = spreadsheetId; this.sheetName = sheetName;
    this.refreshMs = Math.max(10, Math.min(300, refreshSeconds)) * 1000;
    this.maxAgeMs = Math.max(this.refreshMs, Math.min(900, maxAgeSeconds) * 1000);
    this.grants = new Map(); this.lastSuccess = null; this.lastAttempt = null; this.lastError = null; this.available = false;
  }
  status() {
    return { provider: 'google_sheets', spreadsheetId: this.spreadsheetId, sheetName: this.sheetName,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit`,
      ready: this.available && this.lastSuccess !== null && this.clock() - this.lastSuccess < this.maxAgeMs,
      lastSuccessAt: this.lastSuccess === null ? null : new Date(this.lastSuccess).toISOString(),
      lastError: this.lastError, refreshSeconds: this.refreshMs / 1000, maxAgeSeconds: this.maxAgeMs / 1000,
      total: this.grants.size, active: [...this.grants.values()].filter(row => row.active).length };
  }
  async refresh(actor = null) {
    if (this.inflight) return this.inflight;
    this.inflight = this.performRefresh(actor);
    try { return await this.inflight; } finally { this.inflight = null; }
  }
  async performRefresh(actor) {
    this.lastAttempt = this.clock();
    try {
      const rows = await this.reader.read();
      const next = new Map(rows.map(row => [row.email, row]));
      transaction(this.db, () => {
        for (const user of this.db.prepare('SELECT * FROM users WHERE googleSubject IS NOT NULL').all()) {
          const grant = next.get(user.email);
          const changed = signature(grant) !== signature(this.grants.get(user.email));
          const active = Number(Boolean(grant?.active));
          const different = user.active !== active || grant && (user.role !== grant.role || user.scope !== JSON.stringify(grant.scope) || user.displayName !== grant.displayName);
          if (different) this.db.prepare('UPDATE users SET active=?,role=?,scope=?,displayName=? WHERE id=?').run(active, grant?.role || user.role, grant ? JSON.stringify(grant.scope) : user.scope, grant?.displayName || user.displayName, user.id);
          if (changed || different) {
            this.db.prepare('DELETE FROM sessions WHERE userId=?').run(user.id);
            this.db.prepare('DELETE FROM collector_tokens WHERE userId=?').run(user.id);
            if (different) audit(this.db, actor, 'SHEET_PERMISSION_CHANGED', user.id, { email: user.email, role: grant?.role, active: Boolean(active), scope: grant?.scope || {} });
          }
        }
        if (actor) audit(this.db, actor, 'SHEET_PERMISSIONS_REFRESHED', this.sheetName, { total: rows.length, active: rows.filter(row => row.active).length });
      });
      this.grants = next; this.available = true; this.lastSuccess = this.clock(); this.lastError = null;
      return this.status();
    } catch {
      this.available = false; this.lastError = 'Không đọc được bảng quyền hợp lệ. Kiểm tra kết nối, quyền chia sẻ và dữ liệu từng dòng.';
      throw new PermissionUnavailableError();
    }
  }
  async ensureFresh() {
    const now = this.clock();
    if (this.lastAttempt === null || now - this.lastAttempt >= this.refreshMs) await this.refresh();
    if (!this.status().ready) throw new PermissionUnavailableError();
  }
  authorize(row) {
    if (!this.status().ready || !row.googleSubject || !row.email) return null;
    const grant = this.grants.get(row.email);
    return grant?.active ? { ...publicUser(row), displayName: grant.displayName, role: grant.role, scope: grant.scope, active: true } : null;
  }
  login(identity) {
    if (!this.status().ready) throw new PermissionUnavailableError();
    const grant = this.grants.get(identity.email);
    if (!grant?.active) { const error = new Error('Email Google chưa được cấp quyền hoạt động trên Sheet.'); error.status = 403; throw error; }
    let row = this.db.prepare('SELECT * FROM users WHERE googleSubject=?').get(identity.sub);
    const emailOwner = this.db.prepare('SELECT id FROM users WHERE email=?').get(identity.email);
    if (emailOwner && emailOwner.id !== row?.id) { const error = new Error('Email này đã gắn với tài khoản Google khác. Liên hệ quản trị viên.'); error.status = 403; throw error; }
    transaction(this.db, () => {
      if (!row) {
        const id = randomUUID(); const username = `google.${createHash('sha256').update(identity.sub).digest('hex').slice(0, 32)}`;
        this.db.prepare('INSERT INTO users(id,username,displayName,passwordHash,role,scope,active,createdAt,googleSubject,email) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .run(id, username, grant.displayName, '!GOOGLE_ONLY!', grant.role, JSON.stringify(grant.scope), 1, this.clock(), identity.sub, identity.email);
        audit(this.db, id, 'GOOGLE_ACCOUNT_CREATED', id, { email: identity.email, role: grant.role });
        row = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
      } else {
        if (row.email !== identity.email) {
          this.db.prepare('DELETE FROM sessions WHERE userId=?').run(row.id); this.db.prepare('DELETE FROM collector_tokens WHERE userId=?').run(row.id);
        }
        this.db.prepare('UPDATE users SET email=?,displayName=?,role=?,scope=?,active=1 WHERE id=?').run(identity.email, grant.displayName, grant.role, JSON.stringify(grant.scope), row.id);
        row = this.db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
      }
    });
    return this.authorize(row);
  }
  users() {
    const local = new Map(this.db.prepare('SELECT * FROM users WHERE googleSubject IS NOT NULL').all().map(row => [row.email, row]));
    return [...this.grants.values()].map(grant => ({ ...grant, id: local.get(grant.email)?.id || null, username: grant.email, lastLoginKnown: Boolean(local.get(grant.email)) }));
  }
}
