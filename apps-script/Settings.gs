var TTHC = TTHC || {};
TTHC.Settings = (function () {
  var defaults = { warningSeconds: 172800, staleSeconds: 86400, timeZone: 'Asia/Ho_Chi_Minh' };
  function get() {
    var key = 'settings:' + TTHC.Repo.revision(), cache = CacheService.getScriptCache(), stored = cache.get(key);
    if (stored) return JSON.parse(stored);
    var result = Object.assign({}, defaults);
    TTHC.Repo.read('SETTINGS').forEach(function (row) { if (Object.prototype.hasOwnProperty.call(defaults, row.key)) result[row.key] = JSON.parse(row.value); });
    validate(result);
    cache.put(key, JSON.stringify(result), 60);
    return result;
  }
  function validate(value) {
    if (!value || Object.keys(value).some(function (key) { return !Object.prototype.hasOwnProperty.call(defaults, key); }) || !Number.isInteger(value.warningSeconds) || value.warningSeconds < 1 || value.warningSeconds > 30 * 86400 || !Number.isInteger(value.staleSeconds) || value.staleSeconds < 3600 || value.staleSeconds > 30 * 86400 || value.timeZone !== defaults.timeZone) TTHC.Utils.error('INVALID_SETTINGS', 'Cấu hình ngưỡng cảnh báo không hợp lệ.');
  }
  function update(value, actor) {
    var snapshot = TTHC.Repo.readSnapshot(['USERS', 'SETTINGS']);
    var current = TTHC.Users.authorize(actor && actor.id, snapshot.tables.USERS);
    if (current.role !== 'SUPER_ADMIN') TTHC.Utils.error('ACCESS_DENIED', 'Chỉ SUPER_ADMIN được thay đổi cấu hình toàn hệ thống.');
    var next = Object.assign({}, get(), value);
    validate(next);
    var at = TTHC.Utils.now();
    TTHC.Repo.writeBatch('SETTINGS', Object.keys(next).map(function (key) { return { key: key, value: JSON.stringify(next[key]), updated_at: at }; }), 'key', { expectedRevision: snapshot.revision });
    TTHC.Audit.record(current.id, 'CHANGE_SETTING', 'deadline', { result: 'SUCCESS' });
    return next;
  }
  return { defaults: defaults, get: get, update: update };
})();
