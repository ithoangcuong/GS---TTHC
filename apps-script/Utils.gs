var TTHC = TTHC || {};
TTHC.Utils = (function () {
  function error(code, message) { var err = new Error(message); err.code = code; throw err; }
  function now() { return new Date().toISOString(); }
  function id() { return Utilities.getUuid(); }
  function normalizeEmail(value) {
    if (typeof value !== 'string') error('INVALID_EMAIL', 'Email không hợp lệ.');
    var email = value.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error('INVALID_EMAIL', 'Email không hợp lệ.');
    return email;
  }
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') error('INVALID_DATE', 'Ngày giờ phải là chuỗi có múi giờ hoặc DD/MM/YYYY HH:mm:ss.');
    var match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    var date;
    if (match) {
      var parts = [Number(match[3]), Number(match[2]), Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6] || 0)];
      date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3] - 7, parts[4], parts[5]));
      var local = new Date(date.getTime() + 7 * 3600000);
      if (local.getUTCFullYear() !== parts[0] || local.getUTCMonth() + 1 !== parts[1] || local.getUTCDate() !== parts[2] || local.getUTCHours() !== parts[3] || local.getUTCMinutes() !== parts[4] || local.getUTCSeconds() !== parts[5]) error('INVALID_DATE', 'Ngày giờ không tồn tại.');
    } else {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) error('INVALID_DATE', 'Ngày ISO phải có giờ và múi giờ.');
      date = new Date(value);
      var isoParts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
      var year = Number(isoParts[1]), month = Number(isoParts[2]), day = Number(isoParts[3]);
      if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(isoParts[4]) > 23 || Number(isoParts[5]) > 59 || Number(isoParts[6]) > 59 || (isoParts[7] !== 'Z' && (Number(isoParts[7].slice(1, 3)) > 23 || Number(isoParts[7].slice(4)) > 59))) error('INVALID_DATE', 'Ngày giờ không tồn tại.');
    }
    if (!Number.isFinite(date.getTime())) error('INVALID_DATE', 'Ngày giờ không hợp lệ.');
    return date.toISOString();
  }
  function googleErrorCode(value) {
    return typeof value === 'string' && ['invalid_client', 'deleted_client', 'invalid_grant', 'redirect_uri_mismatch', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'invalid_scope', 'access_denied', 'invalid_token', 'insufficient_scope', 'temporarily_unavailable', 'server_error'].indexOf(value) >= 0;
  }
  function log(level, event, details) {
    var safe = { level: level, event: event };
    ['code', 'requestId'].forEach(function (key) { if (details && typeof details[key] === 'string') safe[key] = details[key].slice(0, 100); });
    if (details && ['TOKEN_EXCHANGE', 'USERINFO', 'CREDENTIAL_PROBE'].indexOf(details.stage) >= 0) safe.stage = details.stage;
    if (details && Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) safe.httpStatus = details.httpStatus;
    if (details && googleErrorCode(details.providerError)) safe.providerError = details.providerError;
    console.log(JSON.stringify(safe));
  }
  return { error: error, now: now, id: id, normalizeEmail: normalizeEmail, parseDate: parseDate, googleErrorCode: googleErrorCode, log: log };
})();
