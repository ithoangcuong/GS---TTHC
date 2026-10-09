var TTHC = TTHC || {};
TTHC.Audit = (function () {
  function record(actor, action, target, details, sourceId) {
    var safe = {};
    ['accepted','rejected','count','code','result','previousRole','role'].forEach(function (key) {
      if (details && (typeof details[key] === 'number' || typeof details[key] === 'boolean' || typeof details[key] === 'string')) safe[key] = typeof details[key] === 'string' ? details[key].slice(0, 100) : details[key];
    });
    var row = { audit_id: TTHC.Utils.id(), actor_id: typeof actor === 'string' ? actor : actor && (actor.user_id || actor.id) || '', action: action, target_id: target || '', source_id: sourceId || '', details_encrypted: TTHC.Crypto.encrypt(safe), crypto_version: TTHC.Crypto.cryptoVersion, created_at: TTHC.Utils.now() };
    TTHC.Repo.writeBatch('AUDIT_LOGS', [row], 'audit_id');
    return row.audit_id;
  }
  return { record: record };
})();
