var TTHC = TTHC || {};
TTHC.Permissions = (function () {
  'use strict';
  var ROLES = ['SUPER_ADMIN', 'ADMIN', 'LEADER', 'MANAGER', 'OFFICER', 'VIEWER'];
  var DIMS = ['sources', 'agencies', 'departments', 'officers'];
  function fail(message) { TTHC.Utils.error('ACCESS_DENIED', message || 'Bạn không có quyền thực hiện thao tác này.'); }
  function validateScope(value, role) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) TTHC.Utils.error('VALIDATION_ERROR', 'Phạm vi phải là một object.');
    if (Object.keys(value).some(function (key) { return DIMS.indexOf(key) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Phạm vi chứa trường không được phép.');
    var result = {};
    DIMS.forEach(function (dim) {
      var entries = value[dim];
      if (!Array.isArray(entries) || entries.length > 100 || entries.some(function (entry) { return typeof entry !== 'string' || !entry.trim() || entry.length > 200; })) TTHC.Utils.error('VALIDATION_ERROR', 'Phạm vi ' + dim + ' không hợp lệ.');
      result[dim] = Array.from(new Set(entries.map(function (entry) { return entry.trim(); })));
      if (result[dim].indexOf('*') >= 0 && result[dim].length !== 1) TTHC.Utils.error('VALIDATION_ERROR', '* phải là giá trị duy nhất trong một phạm vi.');
    });
    // USERS.scope is a single Sheets cell. Check the normalized JSON before any write.
    if (JSON.stringify(result).length > 45000) TTHC.Utils.error('VALIDATION_ERROR', 'Phạm vi vượt giới hạn 45.000 ký tự JSON; hãy giảm số lượng hoặc độ dài mã phạm vi.');
    if (role !== 'SUPER_ADMIN' && DIMS.some(function (dim) { return !result[dim].length; })) TTHC.Utils.error('VALIDATION_ERROR', 'Mỗi chiều phạm vi cần giá trị cụ thể hoặc * rõ ràng.');
    if (role === 'OFFICER' && result.officers.indexOf('*') >= 0) TTHC.Utils.error('VALIDATION_ERROR', 'Cán bộ chỉ được cấp hồ sơ của cán bộ cụ thể.');
    if (role === 'MANAGER' && result.agencies.indexOf('*') >= 0 && result.departments.indexOf('*') >= 0) TTHC.Utils.error('VALIDATION_ERROR', 'Quản lý cần phạm vi đơn vị hoặc phòng cụ thể.');
    return result;
  }
  function roleValid(role) { return ROLES.indexOf(role) >= 0; }
  function capability(user, name) {
    if (!user || user.status !== 'ACTIVE' || !roleValid(user.role)) return false;
    if (user.role === 'SUPER_ADMIN') return true;
    var roles = {
      manageUsers: ['ADMIN'], manageSettings: [], manageSources: ['ADMIN'],
      sync: ['ADMIN', 'MANAGER', 'OFFICER'], acknowledge: ['ADMIN', 'LEADER', 'MANAGER', 'OFFICER'],
      export: ['ADMIN', 'LEADER', 'MANAGER'], viewAudit: ['ADMIN', 'LEADER']
    };
    return (roles[name] || []).indexOf(user.role) >= 0;
  }
  function requireCapability(user, name) { if (!capability(user, name)) fail(); }
  function sourceAllowed(user, sourceId) {
    return user.role === 'SUPER_ADMIN' || !!user.scope && (user.scope.sources || []).some(function (item) { return item === '*' || item === sourceId; });
  }
  function hasAccess(user, record) {
    if (!user || user.status !== 'ACTIVE') return false;
    if (user.role === 'SUPER_ADMIN') return true;
    if (!sourceAllowed(user, record.sourceSystem)) return false;
    return [['agencies', 'agency'], ['departments', 'department'], ['officers', 'officer']].every(function (pair) {
      var allowed = user.scope[pair[0]] || [];
      return allowed.indexOf('*') >= 0 || allowed.some(function (item) { return item === record[pair[1] + 'Id'] || item === record[pair[1] + 'Name']; });
    });
  }
  function index(record) {
    var result = { source: record.sourceSystem };
    [['agencies', 'agency'], ['departments', 'department'], ['officers', 'officer']].forEach(function (pair) {
      result[pair[0]] = Array.from(new Set([record[pair[1] + 'Id'], record[pair[1] + 'Name']].filter(Boolean).map(function (value) { return TTHC.Crypto.hashLookupKey(pair[0] + ':' + value); })));
    });
    return result;
  }
  function compile(user) {
    var result = { role: user.role, status: user.status, sources: user.scope.sources || [] };
    ['agencies', 'departments', 'officers'].forEach(function (dim) { result[dim] = (user.scope[dim] || []).map(function (value) { return value === '*' ? '*' : TTHC.Crypto.hashLookupKey(dim + ':' + value); }); });
    return result;
  }
  function indexedAccess(compiled, scopeIndex) {
    if (compiled.status !== 'ACTIVE') return false;
    if (compiled.role === 'SUPER_ADMIN') return true;
    var item;
    try { item = typeof scopeIndex === 'string' ? JSON.parse(scopeIndex) : scopeIndex; } catch (ignored) { return false; }
    if (!item || !compiled.sources.some(function (value) { return value === '*' || value === item.source; })) return false;
    return ['agencies', 'departments', 'officers'].every(function (dim) { return compiled[dim].indexOf('*') >= 0 || compiled[dim].some(function (value) { return (item[dim] || []).indexOf(value) >= 0; }); });
  }
  function contains(grant, target) {
    return DIMS.every(function (dim) {
      var ours = grant[dim] || [], theirs = target[dim] || [];
      return ours.indexOf('*') >= 0 || theirs.length > 0 && theirs.every(function (item) { return item !== '*' && ours.indexOf(item) >= 0; });
    });
  }
  function requireGrant(actor, target, previous) {
    requireCapability(actor, 'manageUsers');
    if (actor.role === 'SUPER_ADMIN') return;
    if (['SUPER_ADMIN', 'ADMIN'].indexOf(target.role) >= 0 || previous && ['SUPER_ADMIN', 'ADMIN'].indexOf(previous.role) >= 0) fail('Chỉ Quản trị hệ thống được quản lý tài khoản quản trị.');
    if (!contains(actor.scope, target.scope) || previous && !contains(actor.scope, previous.scope)) fail('Không được cấp hoặc sửa quyền ngoài phạm vi của bạn.');
  }
  function view(user) { return { canManageUsers: capability(user, 'manageUsers'), canManageSettings: capability(user, 'manageSettings'), canManageSources: capability(user, 'manageSources'), canSync: capability(user, 'sync'), canAcknowledge: capability(user, 'acknowledge'), canExport: capability(user, 'export'), canViewAudit: capability(user, 'viewAudit') }; }
  return { roles: ROLES, roleValid: roleValid, validateScope: validateScope, capability: capability, requireCapability: requireCapability, hasAccess: hasAccess, sourceAllowed: sourceAllowed, scopeIndex: index, compile: compile, indexedAccess: indexedAccess, contains: contains, requireGrant: requireGrant, view: view };
})();
