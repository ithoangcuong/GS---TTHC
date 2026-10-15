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
    return { appName: 'TTHC Monitor', timeZone: 'Asia/Ho_Chi_Minh', timezone: 'Asia/Ho_Chi_Minh', authMode: 'password', configured: issues.length === 0, setupIssues: issues, recoveryEmailEnabled: props.getProperty('RECOVERY_EMAIL_ENABLED') === 'true', webAppUrl: webAppPattern.test(url) ? url : null };
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
  return { config: config, login: login, authenticate: authenticate, session: session, logout: logout, changePassword: changePassword, clearLoginAttempts: clearLoginAttempts, createCollector: createCollector, collector: collector, revokeCollector: revokeCollector, recoveryThrottle: function (value) { attempts('recovery:' + value); } };
})();

TTHC.Recovery = (function () {
  var PREFIX = 'recovery:', TTL = 15 * 60 * 1000;
  var GENERIC = 'Nếu tài khoản có email đã xác minh, liên kết đặt lại mật khẩu sẽ được gửi đến email đó. Hãy kiểm tra cả thư rác. Nếu chưa xác minh email, hãy liên hệ quản trị viên.';
  function invalid() { TTHC.Utils.error('RECOVERY_INVALID', 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu liên kết mới.'); }
  function ready() {
    var config = TTHC.Auth.config();
    if (!config.recoveryEmailEnabled || !config.webAppUrl) TTHC.Utils.error('RECOVERY_UNAVAILABLE', 'Chức năng email chưa được quản trị viên kích hoạt. Vui lòng liên hệ quản trị viên để đặt lại mật khẩu.');
    return config.webAppUrl;
  }
  function key(kind, id) { return PREFIX + kind + ':' + id; }
  function value(rows, name) { var row = rows.find(function (item) { return item.key === name; }); return row && row.value ? TTHC.Crypto.decrypt(row.value) : null; }
  function setting(name, data) { return { key: name, value: TTHC.Crypto.encrypt(data), updated_at: TTHC.Utils.now() }; }
  function findTicket(rows, token, kind) {
    if (typeof token !== 'string' || !/^tthc\.r\.[a-f0-9]{64}$/.test(token)) invalid();
    var hash = TTHC.Crypto.hashLookupKey('recovery-token:' + token), found;
    rows.filter(function (row) { return row.key.indexOf(key(kind, '')) === 0; }).some(function (row) {
      var item = TTHC.Crypto.decrypt(row.value);
      if (item.tokenHash === hash) { found = { row: row, item: item }; return true; }
      return false;
    });
    if (!found || found.item.used || !Number.isFinite(found.item.expiresAt) || found.item.expiresAt <= Date.now()) invalid();
    return found;
  }
  function issue(kind, row, email, snapshot) {
    var url = ready(), token = 'tthc.r.' + TTHC.Crypto.hashLookupKey('recovery-secret:' + TTHC.Utils.id() + ':' + TTHC.Utils.id());
    var ticket = { userId: row.user_id, credentialVersion: row.credential_version, tokenHash: TTHC.Crypto.hashLookupKey('recovery-token:' + token), email: email, expiresAt: Date.now() + TTL, used: false };
    TTHC.Repo.commit([{ table: 'SETTINGS', keyField: 'key', rows: [setting(key(kind, row.user_id), ticket)] }], snapshot.revision);
    try {
      MailApp.sendEmail({ to: email, subject: kind === 'verify' ? 'TTHC Monitor – Xác minh email khôi phục' : 'TTHC Monitor – Đặt lại mật khẩu', name: 'TTHC Monitor', body: 'Bạn đã yêu cầu ' + (kind === 'verify' ? 'xác minh email khôi phục.' : 'đặt lại mật khẩu.') + '\n\nMở liên kết sau để tiếp tục (có hiệu lực 15 phút, dùng một lần):\n' + url + '?recovery=' + kind + '&token=' + token + '\n\nNếu bạn không yêu cầu, hãy bỏ qua thư này. Không chia sẻ liên kết cho người khác.' });
    } catch (_) { TTHC.Utils.error('RECOVERY_MAIL_FAILED', 'Chưa gửi được email. Vui lòng thử lại sau hoặc liên hệ quản trị viên.'); }
  }
  function request(payload) {
    ready();
    var username = TTHC.Users.normalizeUsername(payload.username);
    TTHC.Auth.recoveryThrottle('reset:' + username);
    var snapshot = TTHC.Repo.readSnapshot(['USERS','SETTINGS']), row = TTHC.Users.byUsername(username, snapshot.tables.USERS);
    if (row && row.status === 'ACTIVE' && TTHC.Permissions.roleValid(row.role)) {
      var verified = value(snapshot.tables.SETTINGS, key('email', row.user_id));
      if (verified && verified.verifiedAt && verified.email) {
        try { issue('reset', row, verified.email, snapshot); }
        catch (error) { TTHC.Utils.log('ERROR', 'RECOVERY_DELIVERY_FAILED', { code: error.code || 'RECOVERY_MAIL_FAILED' }); }
      }
    }
    return { message: GENERIC };
  }
  function status(actor) {
    var verified = value(TTHC.Repo.read('SETTINGS'), key('email', actor.id));
    return { email: verified && verified.email || '', verified: !!(verified && verified.verifiedAt), enabled: TTHC.Auth.config().recoveryEmailEnabled };
  }
  function enroll(actor, payload) {
    ready(); TTHC.Auth.recoveryThrottle('verify:' + actor.id);
    var email = TTHC.Utils.normalizeEmail(payload.email);
    if (typeof payload.currentPassword !== 'string' || payload.currentPassword.length > 128) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu hiện tại không hợp lệ.');
    var snapshot = TTHC.Repo.readSnapshot(['USERS','SETTINGS']), row = TTHC.Users.byId(actor.id, snapshot.tables.USERS);
    TTHC.Users.validateRow(row);
    if (row.credential_version !== actor.credentialVersion || !TTHC.Passwords.verify(payload.currentPassword, row.password_hash)) TTHC.Utils.error('AUTH_INVALID', 'Mật khẩu hiện tại không đúng hoặc phiên đã thay đổi.');
    issue('verify', row, email, snapshot);
    return { message: 'Đã gửi liên kết xác minh. Hãy mở email và xác nhận trong 15 phút.' };
  }
  function verify(payload) {
    var snapshot = TTHC.Repo.readSnapshot(['USERS','SETTINGS']), ticket = findTicket(snapshot.tables.SETTINGS, payload.token, 'verify'), item = ticket.item;
    var row = TTHC.Users.byId(item.userId, snapshot.tables.USERS); TTHC.Users.validateRow(row);
    if (row.credential_version !== item.credentialVersion) invalid();
    var now = TTHC.Utils.now(), changes = [setting(ticket.row.key, { used: true }), setting(key('email', row.user_id), { email: item.email, verifiedAt: now }), setting(key('reset', row.user_id), { used: true })];
    TTHC.Repo.commit([{ table: 'SETTINGS', keyField: 'key', rows: changes }], snapshot.revision);
    return { message: 'Email đã được xác minh. Bạn có thể dùng Quên mật khẩu khi cần.' };
  }
  function reset(payload) {
    TTHC.Passwords.validate(payload.newPassword);
    var snapshot = TTHC.Repo.readSnapshot(['USERS','SETTINGS','COLLECTOR_TOKENS']), ticket = findTicket(snapshot.tables.SETTINGS, payload.token, 'reset'), item = ticket.item;
    var row = TTHC.Users.byId(item.userId, snapshot.tables.USERS), verified = value(snapshot.tables.SETTINGS, key('email', item.userId));
    TTHC.Users.validateRow(row);
    if (row.credential_version !== item.credentialVersion || !verified || verified.email !== item.email) invalid();
    if (TTHC.Passwords.verify(payload.newPassword, row.password_hash)) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
    var defaultPassword; try { defaultPassword = TTHC.Passwords.defaultPassword(); } catch (error) { if (error.code !== 'CONFIGURATION_ERROR') throw error; }
    if (payload.newPassword === defaultPassword) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu mới phải khác mật khẩu mặc định.');
    var now = TTHC.Utils.now(), updated = Object.assign({}, row, { password_hash: TTHC.Passwords.hash(payload.newPassword), must_change_password: false, credential_version: TTHC.Utils.id(), password_changed_at: now, updated_at: now });
    var revoked = snapshot.tables.COLLECTOR_TOKENS.filter(function (token) { return token.user_id === row.user_id && token.status === 'ACTIVE'; }).map(function (token) { return Object.assign({}, token, { status: 'REVOKED', revoked_at: now }); });
    var changes = [{ table: 'USERS', keyField: 'user_id', rows: [updated] }, { table: 'SETTINGS', keyField: 'key', rows: [setting(ticket.row.key, { used: true })] }];
    if (revoked.length) changes.push({ table: 'COLLECTOR_TOKENS', keyField: 'token_hash', rows: revoked });
    TTHC.Repo.commit(changes, snapshot.revision);
    TTHC.Auth.clearLoginAttempts(TTHC.Crypto.decrypt(row.username_encrypted), row.user_id);
    return { message: 'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.' };
  }
  return { request: request, status: status, enroll: enroll, verify: verify, reset: reset };
})();
