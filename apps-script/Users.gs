var TTHC = TTHC || {};
TTHC.Users = (function () {
  'use strict';
  function emailHash(email) { return TTHC.Crypto.hashLookupKey('email:' + TTHC.Utils.normalizeEmail(email)); }
  function normalizeUsername(value) {
    if (typeof value !== 'string') TTHC.Utils.error('VALIDATION_ERROR', 'Tên tài khoản không hợp lệ.');
    var username = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) TTHC.Utils.error('VALIDATION_ERROR', 'Tên tài khoản cần 3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.');
    return username;
  }
  function usernameHash(value) { return TTHC.Crypto.hashLookupKey('username:' + normalizeUsername(value)); }
  function mustChange(row) { return row.must_change_password === true || row.must_change_password === 'true'; }
  function scope(row) {
    var value;
    try { value = typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope; } catch (ignored) { TTHC.Utils.error('ACCESS_DENIED', 'Quyền tài khoản chưa được cấu hình hợp lệ.'); }
    try { return TTHC.Permissions.validateScope(value, row.role); } catch (ignored) { TTHC.Utils.error('ACCESS_DENIED', 'Quyền tài khoản chưa được cấu hình hợp lệ.'); }
  }
  function validateRow(row) {
    if (!row || row.status !== 'ACTIVE' || !TTHC.Permissions.roleValid(row.role)) TTHC.Utils.error('ACCESS_DENIED', 'Tài khoản của bạn chưa được cấp quyền sử dụng hệ thống. Vui lòng liên hệ Quản trị viên.');
    return { id: row.user_id, role: row.role, scope: scope(row), status: row.status, credentialVersion: row.credential_version || '' };
  }
  function metadata(row, username, displayName) { return { id: row.user_id, username: username, displayName: displayName, role: row.role, scope: scope(row), status: row.status, mustChangePassword: mustChange(row), createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, lastLoginAt: row.last_login_at || null }; }
  function view(row) { return metadata(row, row.username_encrypted ? TTHC.Crypto.decrypt(row.username_encrypted) : null, TTHC.Crypto.decrypt(row.display_name_encrypted)); }
  function byId(id, rows) { return (rows || TTHC.Repo.read('USERS')).find(function (row) { return row.user_id === id; }) || null; }
  function uniqueHash(field, hash, rows) {
    var matches = (rows || TTHC.Repo.read('USERS')).filter(function (row) { return row[field] === hash; });
    if (matches.length > 1) TTHC.Utils.error('CONFIGURATION_ERROR', 'Bảng người dùng chứa tài khoản trùng lặp.');
    return matches[0] || null;
  }
  function byEmail(email, rows) { return uniqueHash('email_hash', emailHash(email), rows); }
  function byUsername(username, rows) { return uniqueHash('username_hash', usernameHash(username), rows); }
  function authorize(id, rows) { return validateRow(byId(id, rows)); }
  function currentActor(actor, rows) {
    var row = byId(actor.id, rows), current = validateRow(row);
    if (actor.credentialVersion !== undefined && actor.credentialVersion !== current.credentialVersion) TTHC.Utils.error('AUTH_REQUIRED', 'Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.');
    if (mustChange(row)) TTHC.Utils.error('PASSWORD_CHANGE_REQUIRED', 'Vui lòng đổi mật khẩu mặc định trước khi quản lý tài khoản.');
    return current;
  }
  function list(actor) {
    TTHC.Permissions.requireCapability(actor, 'manageUsers');
    var rows = TTHC.Repo.read('USERS').filter(function (row) {
      if (actor.role === 'SUPER_ADMIN' || row.user_id === actor.id) return true;
      if (['SUPER_ADMIN', 'ADMIN'].indexOf(row.role) >= 0) return false;
      try { return TTHC.Permissions.contains(actor.scope, scope(row)); } catch (ignored) { return false; }
    });
    var encrypted = [], positions = [];
    rows.forEach(function (row) { var position = { name: encrypted.length, username: null }; encrypted.push(row.display_name_encrypted); if (row.username_encrypted) { position.username = encrypted.length; encrypted.push(row.username_encrypted); } positions.push(position); });
    var decoded = encrypted.length ? TTHC.Crypto.decryptMany(encrypted) : [];
    return { items: rows.map(function (row, i) { return metadata(row, positions[i].username === null ? null : decoded[positions[i].username], decoded[positions[i].name]); }) };
  }
  function input(payload, creating) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(function (key) { return ['id', 'username', 'displayName', 'role', 'scope', 'status'].indexOf(key) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Thông tin tài khoản chứa trường không hợp lệ.');
    if (!creating && (typeof payload.id !== 'string' || !payload.id || payload.id.length > 200)) TTHC.Utils.error('VALIDATION_ERROR', 'Mã tài khoản không hợp lệ.');
    if (!TTHC.Permissions.roleValid(payload.role) || ['ACTIVE', 'DISABLED'].indexOf(payload.status || 'ACTIVE') < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Vai trò hoặc trạng thái không hợp lệ.');
    if (typeof payload.displayName !== 'string' || !payload.displayName.trim() || payload.displayName.length > 200 || /[\u0000-\u001f]/.test(payload.displayName)) TTHC.Utils.error('VALIDATION_ERROR', 'Tên hiển thị phải có 1–200 ký tự.');
    var result = { displayName: payload.displayName.trim(), role: payload.role, scope: TTHC.Permissions.validateScope(payload.scope, payload.role), status: payload.status || 'ACTIVE' };
    if (creating || payload.username !== undefined) result.username = normalizeUsername(payload.username);
    return result;
  }
  function credentials(username, password, at) { return { username_hash: usernameHash(username), username_encrypted: TTHC.Crypto.encrypt(username), password_hash: TTHC.Passwords.hash(password), must_change_password: true, credential_version: TTHC.Utils.id(), password_changed_at: at }; }
  function create(actor, payload) {
    var target = input(payload, true); TTHC.Permissions.requireGrant(actor, target);
    var snapshot = TTHC.Repo.readSnapshot(['USERS']);
    if (byUsername(target.username, snapshot.tables.USERS)) TTHC.Utils.error('CONFLICT', 'Tên tài khoản đã được sử dụng.');
    TTHC.Permissions.requireGrant(currentActor(actor, snapshot.tables.USERS), target);
    var password = TTHC.Passwords.defaultPassword(), now = TTHC.Utils.now();
    var row = Object.assign({ user_id: TTHC.Utils.id(), email_hash: '', email_encrypted: '', display_name_encrypted: TTHC.Crypto.encrypt(target.displayName), role: target.role, scope: JSON.stringify(target.scope), status: target.status, created_at: now, updated_at: now, created_by: actor.id, last_login_at: '' }, credentials(target.username, password, now));
    TTHC.Repo.commit([{ table: 'USERS', keyField: 'user_id', rows: [row] }], snapshot.revision);
    TTHC.Audit.record(actor.id, 'ADD_USER', row.user_id, { result: 'SUCCESS' });
    return { user: view(row), defaultPassword: password };
  }
  function update(actor, payload) {
    var target = input(payload, false), snapshot = TTHC.Repo.readSnapshot(['USERS', 'COLLECTOR_TOKENS']), previous = byId(payload.id, snapshot.tables.USERS);
    if (!previous) TTHC.Utils.error('NOT_FOUND', 'Không tìm thấy tài khoản.');
    var old = { id: previous.user_id, role: previous.role, scope: scope(previous), status: previous.status };
    TTHC.Permissions.requireGrant(currentActor(actor, snapshot.tables.USERS), target, old);
    if (target.username && previous.username_hash && usernameHash(target.username) !== previous.username_hash) TTHC.Utils.error('VALIDATION_ERROR', 'Tên tài khoản không thể đổi. Hãy tạo tài khoản mới.');
    if (previous.user_id === actor.id && (target.role !== old.role || JSON.stringify(target.scope) !== JSON.stringify(old.scope) || target.status !== 'ACTIVE')) TTHC.Utils.error('ACCESS_DENIED', 'Không thể tự thay đổi quyền hoặc vô hiệu hóa tài khoản đang sử dụng.');
    if (old.role === 'SUPER_ADMIN' && old.status === 'ACTIVE' && (target.role !== 'SUPER_ADMIN' || target.status !== 'ACTIVE') && snapshot.tables.USERS.filter(function (row) { return row.role === 'SUPER_ADMIN' && row.status === 'ACTIVE'; }).length <= 1) TTHC.Utils.error('ACCESS_DENIED', 'Phải giữ ít nhất một Quản trị hệ thống hoạt động.');
    var now = TTHC.Utils.now(), row = Object.assign({}, previous, { display_name_encrypted: TTHC.Crypto.encrypt(target.displayName), role: target.role, scope: JSON.stringify(target.scope), status: target.status, updated_at: now }), password;
    if (!previous.username_hash && target.username) { if (byUsername(target.username, snapshot.tables.USERS)) TTHC.Utils.error('CONFLICT', 'Tên tài khoản đã được sử dụng.'); password = TTHC.Passwords.defaultPassword(); Object.assign(row, credentials(target.username, password, now)); }
    if (old.status !== target.status) { row.credential_version = TTHC.Utils.id(); passwordCommit(snapshot, row); }
    else TTHC.Repo.commit([{ table: 'USERS', keyField: 'user_id', rows: [row] }], snapshot.revision);
    TTHC.Audit.record(actor.id, target.status === 'DISABLED' ? 'DISABLE_USER' : target.role !== old.role ? 'CHANGE_ROLE' : 'UPDATE_USER', row.user_id, { result: 'SUCCESS' });
    var result = { user: view(row) }; if (password) result.defaultPassword = password; return result;
  }
  function passwordCommit(snapshot, row) {
    var revoked = snapshot.tables.COLLECTOR_TOKENS.filter(function (token) { return token.user_id === row.user_id && token.status === 'ACTIVE'; }).map(function (token) { return Object.assign({}, token, { status: 'REVOKED', revoked_at: TTHC.Utils.now() }); });
    var changes = [{ table: 'USERS', keyField: 'user_id', rows: [row] }]; if (revoked.length) changes.push({ table: 'COLLECTOR_TOKENS', keyField: 'token_hash', rows: revoked });
    TTHC.Repo.commit(changes, snapshot.revision);
  }
  function resetPassword(actor, payload) {
    TTHC.Permissions.requireCapability(actor, 'manageUsers');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(function (field) { return field !== 'id'; }) || typeof payload.id !== 'string' || !payload.id || payload.id.length > 200) TTHC.Utils.error('VALIDATION_ERROR', 'Yêu cầu đặt lại mật khẩu không hợp lệ.');
    var snapshot = TTHC.Repo.readSnapshot(['USERS', 'COLLECTOR_TOKENS']), previous = byId(payload.id, snapshot.tables.USERS);
    if (!previous) TTHC.Utils.error('NOT_FOUND', 'Không tìm thấy tài khoản.');
    if (previous.user_id === actor.id) TTHC.Utils.error('ACCESS_DENIED', 'Dùng chức năng đổi mật khẩu để thay mật khẩu của bạn.');
    var target = { role: previous.role, scope: scope(previous), status: previous.status }; TTHC.Permissions.requireGrant(currentActor(actor, snapshot.tables.USERS), target, target);
    if (!previous.username_hash || !previous.username_encrypted) TTHC.Utils.error('VALIDATION_ERROR', 'Cần cấp tên tài khoản trước khi đặt lại mật khẩu.');
    var password = TTHC.Passwords.defaultPassword(), at = TTHC.Utils.now(), row = Object.assign({}, previous, { password_hash: TTHC.Passwords.hash(password), must_change_password: true, credential_version: TTHC.Utils.id(), password_changed_at: at, updated_at: at });
    passwordCommit(snapshot, row);
    if (TTHC.Auth && TTHC.Auth.clearLoginAttempts) TTHC.Auth.clearLoginAttempts(TTHC.Crypto.decrypt(row.username_encrypted), row.user_id);
    TTHC.Audit.record(actor.id, 'RESET_PASSWORD', row.user_id, { result: 'SUCCESS' }); return { user: view(row), defaultPassword: password };
  }
  function changePassword(actor, payload) {
    if (typeof payload.currentPassword !== 'string' || !payload.currentPassword || payload.currentPassword.length > 128 || /[\u0000-\u001f\u007f]/.test(payload.currentPassword)) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu hiện tại không hợp lệ.');
    TTHC.Passwords.validate(payload.newPassword);
    var snapshot = TTHC.Repo.readSnapshot(['USERS', 'COLLECTOR_TOKENS']), previous = byId(actor.id, snapshot.tables.USERS); validateRow(previous);
    if (actor.credentialVersion !== undefined && actor.credentialVersion !== (previous.credential_version || '')) TTHC.Utils.error('AUTH_REQUIRED', 'Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.');
    if (!TTHC.Passwords.verify(payload.currentPassword, previous.password_hash)) TTHC.Utils.error('AUTH_INVALID', 'Mật khẩu hiện tại không đúng.');
    if (payload.newPassword === payload.currentPassword) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    var defaultValue; try { defaultValue = TTHC.Passwords.defaultPassword(); } catch (error) { if (error.code !== 'CONFIGURATION_ERROR') throw error; }
    if (payload.newPassword === defaultValue) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu mới phải khác mật khẩu mặc định.');
    var at = TTHC.Utils.now(), row = Object.assign({}, previous, { password_hash: TTHC.Passwords.hash(payload.newPassword), must_change_password: false, credential_version: TTHC.Utils.id(), password_changed_at: at, updated_at: at });
    passwordCommit(snapshot, row); TTHC.Audit.record(actor.id, 'CHANGE_PASSWORD', row.user_id, { result: 'SUCCESS' }); return row;
  }
  function recordLogin(row) {
    var snapshot = TTHC.Repo.readSnapshot(['USERS']), current = byId(row.user_id, snapshot.tables.USERS); validateRow(current);
    if (current.password_hash !== row.password_hash || current.credential_version !== row.credential_version) TTHC.Utils.error('AUTH_INVALID', 'Thông tin đăng nhập đã thay đổi. Vui lòng thử lại.');
    var now = TTHC.Utils.now(), updated = Object.assign({}, current, { last_login_at: now }); TTHC.Repo.commit([{ table: 'USERS', keyField: 'user_id', rows: [updated] }], snapshot.revision);
    TTHC.Audit.record(row.user_id, 'LOGIN_SUCCESS', row.user_id, { result: 'SUCCESS' }); return updated;
  }
  return { emailHash: emailHash, normalizeUsername: normalizeUsername, usernameHash: usernameHash, credentials: credentials, view: view, scope: scope, byId: byId, byEmail: byEmail, byUsername: byUsername, authorize: authorize, validateRow: validateRow, list: list, create: create, update: update, resetPassword: resetPassword, changePassword: changePassword, recordLogin: recordLogin };
})();
