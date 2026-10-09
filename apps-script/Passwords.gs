var TTHC = TTHC || {};
TTHC.Passwords = (function () {
  'use strict';
  // OWASP's 16 MiB scrypt profile keeps Apps Script memory bounded.
  var N = 16384, R = 8, P = 5, LENGTH = 32, VERSION = 'scrypt-v1';
  function validate(value) {
    if (typeof value !== 'string' || value.length < 10 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) TTHC.Utils.error('VALIDATION_ERROR', 'Mật khẩu cần có 10–128 ký tự và không chứa ký tự điều khiển.');
    return value;
  }
  function defaultPassword() {
    var value = PropertiesService.getScriptProperties().getProperty('DEFAULT_USER_PASSWORD');
    if (!value) {
      var setting = TTHC.Repo.read('SETTINGS').find(function (row) { return row.key === 'defaultUserPasswordEncrypted'; });
      if (setting) value = TTHC.Crypto.decrypt(setting.value);
    }
    if (!value) TTHC.Utils.error('CONFIGURATION_ERROR', 'Chưa cấu hình DEFAULT_USER_PASSWORD trong Script Properties.');
    return validate(value);
  }
  function hex(bytes) { return Array.from(bytes, function (value) { return ('0' + value.toString(16)).slice(-2); }).join(''); }
  function bytes(value) { return Uint8Array.from(value.match(/../g), function (part) { return parseInt(part, 16); }); }
  function derive(value, salt) {
    if (typeof TthcCipher === 'undefined' || typeof TthcCipher.scrypt !== 'function') TTHC.Utils.error('CRYPTO_UNAVAILABLE', 'Thư viện bảo vệ mật khẩu chưa được đồng bộ đầy đủ.');
    // A secret prehash makes an offline sheet leak insufficient to test passwords.
    var secret = bytes(TTHC.Crypto.hashLookupKey('password:' + value)), result;
    try { result = TthcCipher.scrypt(secret, bytes(salt), { N: N, r: R, p: P, dkLen: LENGTH, maxmem: 33554432 }); return hex(result); }
    finally { secret.fill(0); if (result) result.fill(0); }
  }
  function parse(encoded) {
    var value;
    try { value = JSON.parse(encoded); } catch (ignored) { return null; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'hash,n,p,r,salt,version' || value.version !== VERSION || value.n !== N || value.r !== R || value.p !== P || typeof value.salt !== 'string' || !/^[a-f0-9]{64}$/.test(value.salt) || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) return null;
    return value;
  }
  function hash(value) {
    validate(value);
    // UUID uniqueness supplies context; unpredictability comes from the secret pepper.
    var salt = TTHC.Crypto.hashLookupKey('password-salt:' + TTHC.Utils.id() + ':' + TTHC.Utils.id());
    return JSON.stringify({ version: VERSION, n: N, r: R, p: P, salt: salt, hash: derive(value, salt) });
  }
  function equal(left, right) {
    var mismatch = left.length ^ right.length;
    for (var i = 0; i < Math.max(left.length, right.length); i++) mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
    return mismatch === 0;
  }
  function verify(value, encoded) {
    var entry = parse(encoded);
    // Perform the same expensive derivation for missing/invalid accounts.
    var candidate = derive(typeof value === 'string' ? value : '', entry ? entry.salt : TTHC.Crypto.hashLookupKey('password-dummy-salt'));
    return !!entry && equal(candidate, entry.hash);
  }
  return { validate: validate, defaultPassword: defaultPassword, hash: hash, verify: verify, configuredHash: function (encoded) { return !!parse(encoded); } };
})();
