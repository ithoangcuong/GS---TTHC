var TTHC = TTHC || {};
TTHC.Auth = (function () {
  'use strict';
  var SESSION_SECONDS = 3600, ATTEMPT_SECONDS = 900;
  function cache() { return CacheService.getScriptCache(); }
  function opaque(prefix) { return prefix + TTHC.Crypto.hashLookupKey('opaque:' + TTHC.Utils.id() + ':' + TTHC.Utils.id()); }
  function key(kind, value) { return 'auth:' + kind + ':' + TTHC.Crypto.hashLookupKey(kind + ':' + value); }
  function parse(value) { if (!value) return null; try { return JSON.parse(value); } catch (ignored) { return null; } }
  function config() {
    var props = PropertiesService.getScriptProperties(), issues = [];
    var webAppPattern = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
    [
      ['SPREADSHEET_ID', function (value) { return /^[A-Za-z0-9_-]{10,200}$/.test(value); }],
      ['DATA_ENCRYPTION_KEY', function (value) { return /^[a-fA-F0-9]{128}$/.test(value); }],
      ['DATA_ENCRYPTION_KEY_ID', function (value) { return /^[A-Za-z0-9_-]{1,64}$/.test(value); }],
      ['LOOKUP_PEPPER', function (value) { return value.length >= 32; }]
    ].forEach(function (check) {
      var value = props.getProperty(check[0]);
      if (value === null || value === undefined || value === '') issues.push({ property: check[0], reason: 'missing' });
      else if (typeof value !== 'string' || !check[1](value)) issues.push({ property: check[0], reason: 'invalid' });
    });
    var url = props.getProperty('WEB_APP_URL') || '';
    return { appName: 'TTHC Monitor', timeZone: 'Asia/Ho_Chi_Minh', timezone: 'Asia/Ho_Chi_Minh', authMode: 'password', configured: issues.length === 0, setupIssues: issues, webAppUrl: webAppPattern.test(url) ? url : null };
  }
  function requireConfigured() {
    var readiness = config();
    if (!readiness.configured) TTHC.Utils.error('CONFIGURATION_ERROR', 'Chưa hoàn tất cấu hình đăng nhập: ' + readiness.setupIssues.map(function (issue) { return issue.property; }).join(', ') + '. Kiểm tra Script Properties rồi chạy verifyAdminLogin_ trong Apps Script Editor.');
  }
  function attempts(username) {
    var accountKey = key('attempts', username), globalKey = key('attempts-global', 'all');
    TTHC.Repo.withLock(function () {
      var now = Date.now(), account = parse(cache().get(accountKey)), global = parse(cache().get(globalKey));
      if (!account || account.expiresAt <= now) account = { count: 0, expiresAt: now + ATTEMPT_SECONDS * 1000 };
      if (!global || global.expiresAt <= now) global = { count: 0, expiresAt: now + 60000 };
      if (account.count >= 5 || global.count >= 30) TTHC.Utils.error('RATE_LIMITED', 'Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.');
      account.count++; global.count++;
      cache().put(accountKey, JSON.stringify(account), Math.max(1, Math.ceil((account.expiresAt - now) / 1000)));
      cache().put(globalKey, JSON.stringify(global), Math.max(1, Math.ceil((global.expiresAt - now) / 1000)));
    });
    return accountKey;
  }
  function mustChange(row) { return row.must_change_password === true || row.must_change_password === 'true'; }
  function issue(row) {
    var sessionToken = opaque('tthc.s.'), expiresAt = Date.now() + SESSION_SECONDS * 1000;
    cache().put(key('session', sessionToken), JSON.stringify({ userId: row.user_id, credentialVersion: row.credential_version, passwordHash: row.password_hash, expiresAt: expiresAt }), SESSION_SECONDS);
    return Object.assign(session(sessionToken), { sessionToken: sessionToken, expiresAt: new Date(expiresAt).toISOString() });
  }
  function login(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(function (field) { return ['username', 'password'].indexOf(field) < 0; }) || typeof payload.password !== 'string' || !payload.password || payload.password.length > 128 || /[\u0000-\u001f\u007f]/.test(payload.password)) TTHC.Utils.error('VALIDATION_ERROR', 'Thông tin đăng nhập không hợp lệ.');
    requireConfigured();
    var username = TTHC.Users.normalizeUsername(payload.username), attemptKey = attempts(username), row = TTHC.Users.byUsername(username), valid = TTHC.Passwords.verify(payload.password, row && row.password_hash);
    if (!valid || !row || row.status !== 'ACTIVE' || !TTHC.Permissions.roleValid(row.role)) {
      TTHC.Utils.log('INFO', 'LOGIN_DENIED', { code: 'AUTH_INVALID' });
      TTHC.Utils.error('AUTH_INVALID', 'Tên tài khoản hoặc mật khẩu không đúng, hoặc tài khoản chưa được cấp quyền.');
    }
    TTHC.Users.validateRow(row);
    row = TTHC.Users.recordLogin(row);
    cache().remove(attemptKey);
    return issue(row);
  }
  function authenticate(sessionToken, allowPasswordChange) {
    if (typeof sessionToken !== 'string' || !/^tthc\.s\.[a-f0-9]{64}$/.test(sessionToken)) TTHC.Utils.error('AUTH_REQUIRED', 'Vui lòng đăng nhập bằng tài khoản được cấp.');
    var value = parse(cache().get(key('session', sessionToken)));
    if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || typeof value.userId !== 'string') TTHC.Utils.error('AUTH_REQUIRED', 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    var row = TTHC.Users.byId(value.userId);
    if (!row || !row.password_hash || row.password_hash !== value.passwordHash || row.credential_version !== value.credentialVersion) TTHC.Utils.error('AUTH_REQUIRED', 'Mật khẩu đã thay đổi. Vui lòng đăng nhập lại.');
    var actor = TTHC.Users.validateRow(row);
    if (mustChange(row) && !allowPasswordChange) TTHC.Utils.error('PASSWORD_CHANGE_REQUIRED', 'Vui lòng đổi mật khẩu mặc định trước khi sử dụng hệ thống.');
    return actor;
  }
  function session(sessionToken) {
    var actor = authenticate(sessionToken, true), row = TTHC.Users.byId(actor.id);
    var permissions = TTHC.Permissions.view(actor);
    if (mustChange(row)) Object.keys(permissions).forEach(function (field) { permissions[field] = false; });
    return { user: TTHC.Users.view(row), permissions: permissions, mustChangePassword: mustChange(row), serverTime: TTHC.Utils.now() };
  }
  function logout(sessionToken) { if (typeof sessionToken === 'string' && sessionToken.length < 200) cache().remove(key('session', sessionToken)); return { loggedOut: true }; }
  function changePassword(payload, sessionToken) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(function (field) { return ['currentPassword', 'newPassword'].indexOf(field) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Yêu cầu đổi mật khẩu không hợp lệ.');
    var actor = authenticate(sessionToken, true);
    TTHC.Passwords.validate(payload.newPassword);
    var attemptKey = attempts('change:' + actor.id), changed = TTHC.Users.changePassword(actor, payload);
    cache().remove(attemptKey);
    logout(sessionToken);
    return issue(changed);
  }
  function createCollector(actor, payload) {
    TTHC.Permissions.requireCapability(actor, 'sync');
    if (!payload || Object.keys(payload).some(function (field) { return ['sourceSystem', 'hostname'].indexOf(field) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Yêu cầu cấp token không hợp lệ.');
    var snapshot = TTHC.Repo.readSnapshot(['USERS', 'SOURCES']), current = recheckActor(actor, snapshot.tables.USERS), source = TTHC.Sources.find(payload.sourceSystem, snapshot.tables.SOURCES);
    TTHC.Permissions.requireCapability(current, 'sync');
    if (mustChange(TTHC.Users.byId(current.id, snapshot.tables.USERS))) TTHC.Utils.error('PASSWORD_CHANGE_REQUIRED', 'Vui lòng đổi mật khẩu mặc định trước khi cấp token Collector.');
    TTHC.Sources.validateHost(source, payload.hostname);
    if (!source.enabled) TTHC.Utils.error('SOURCE_DISABLED', 'Nguồn đang bị tắt.');
    if (!TTHC.Permissions.sourceAllowed(current, source.id)) TTHC.Utils.error('ACCESS_DENIED', 'Nguồn ngoài phạm vi được cấp.');
    var token = opaque('tthc.c.'), now = Date.now(), id = TTHC.Utils.id(), expiresAt = new Date(now + SESSION_SECONDS * 1000).toISOString();
    var row = { token_id: id, token_hash: TTHC.Crypto.hashLookupKey('collector:' + token), user_id: current.id, source_id: source.id, hostname: payload.hostname, status: 'ACTIVE', expires_at: expiresAt, created_at: new Date(now).toISOString(), revoked_at: '' };
    var previous = TTHC.Repo.read('COLLECTOR_TOKENS').filter(function (item) { return item.user_id === current.id && item.source_id === source.id && item.hostname === payload.hostname && item.status === 'ACTIVE'; }).map(function (item) { return Object.assign({}, item, { status: 'REVOKED', revoked_at: new Date(now).toISOString() }); });
    TTHC.Repo.commit([{ table: 'COLLECTOR_TOKENS', keyField: 'token_hash', rows: previous.concat(row) }], snapshot.revision);
    TTHC.Audit.record(current.id, 'ISSUE_COLLECTOR_TOKEN', id, { result: 'SUCCESS' }, source.id);
    return { id: id, token: token, expiresAt: expiresAt, sourceSystem: source.id, hostname: payload.hostname };
  }
  function collector(token, sourceSystem, hostname, tables) {
    if (typeof token !== 'string' || !/^tthc\.c\.[a-f0-9]{64}$/.test(token)) TTHC.Utils.error('TOKEN_INVALID', 'Token Collector không hợp lệ.');
    tables = tables || { COLLECTOR_TOKENS: TTHC.Repo.read('COLLECTOR_TOKENS'), USERS: TTHC.Repo.read('USERS') };
    var hash = TTHC.Crypto.hashLookupKey('collector:' + token), row = tables.COLLECTOR_TOKENS.find(function (item) { return item.token_hash === hash; });
    if (!row || row.status !== 'ACTIVE' || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now() || row.source_id !== sourceSystem || row.hostname !== hostname) TTHC.Utils.error('TOKEN_INVALID', 'Token Collector đã hết hạn, bị thu hồi hoặc không đúng nguồn.');
    var account = TTHC.Users.byId(row.user_id, tables.USERS);
    if (mustChange(account || {})) TTHC.Utils.error('PASSWORD_CHANGE_REQUIRED', 'Vui lòng đổi mật khẩu mặc định trước khi đồng bộ.');
    var actor = TTHC.Users.authorize(row.user_id, tables.USERS); TTHC.Permissions.requireCapability(actor, 'sync');
    if (!TTHC.Permissions.sourceAllowed(actor, sourceSystem)) TTHC.Utils.error('ACCESS_DENIED', 'Nguồn không còn thuộc phạm vi được cấp.');
    return actor;
  }
  function revokeCollector(actor, payload) {
    var snapshot = TTHC.Repo.readSnapshot(['COLLECTOR_TOKENS', 'USERS']), current = recheckActor(actor, snapshot.tables.USERS), row = snapshot.tables.COLLECTOR_TOKENS.find(function (item) { return item.token_id === payload.id; });
    if (!row) TTHC.Utils.error('NOT_FOUND', 'Không tìm thấy token.');
    if (row.user_id !== current.id && current.role !== 'SUPER_ADMIN') TTHC.Utils.error('ACCESS_DENIED', 'Token không thuộc tài khoản của bạn.');
    TTHC.Repo.commit([{ table: 'COLLECTOR_TOKENS', keyField: 'token_hash', rows: [Object.assign({}, row, { status: 'REVOKED', revoked_at: TTHC.Utils.now() })] }], snapshot.revision);
    TTHC.Audit.record(current.id, 'REVOKE_COLLECTOR_TOKEN', row.token_id, { result: 'SUCCESS' }, row.source_id);
    return { revoked: true };
  }
  function recheckActor(actor, rows) {
    var row = TTHC.Users.byId(actor.id, rows), current = TTHC.Users.validateRow(row);
    if (actor.credentialVersion !== current.credentialVersion) TTHC.Utils.error('AUTH_REQUIRED', 'Thông tin đăng nhập đã thay đổi. Vui lòng đăng nhập lại.');
    if (mustChange(row)) TTHC.Utils.error('PASSWORD_CHANGE_REQUIRED', 'Vui lòng đổi mật khẩu mặc định trước khi quản lý token Collector.');
    return current;
  }
  function clearLoginAttempts(username, userId) {
    cache().remove(key('attempts', TTHC.Users.normalizeUsername(username)));
    if (userId) cache().remove(key('attempts', 'change:' + userId));
  }
  return { config: config, login: login, authenticate: authenticate, session: session, logout: logout, changePassword: changePassword, clearLoginAttempts: clearLoginAttempts, createCollector: createCollector, collector: collector, revokeCollector: revokeCollector };
})();
