var TTHC = TTHC || {};
TTHC.Router = (function () {
  'use strict';
  function controlled(callback) {
    var requestId = TTHC.Utils.id();
    try { return { ok: true, data: callback() }; }
    catch (error) {
      var code = typeof error.code === 'string' && /^[A-Z_]{2,60}$/.test(error.code) ? error.code : 'INTERNAL_ERROR';
      TTHC.Utils.log('ERROR', 'REQUEST_FAILED', { code: code, requestId: requestId });
      return { ok: false, error: { code: code, message: code === 'INTERNAL_ERROR' ? 'Không thể xử lý yêu cầu. Vui lòng thử lại hoặc liên hệ quản trị viên.' : String(error.message || 'Yêu cầu không hợp lệ.').slice(0, 500), requestId: requestId } };
    }
  }
  function auditList(actor, query) {
    TTHC.Permissions.requireCapability(actor, 'viewAudit');
    query = query || {};
    if (Object.keys(query).some(function (field) { return ['sourceSystem', 'action', 'page', 'pageSize', 'q'].indexOf(field) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Bộ lọc nhật ký không hợp lệ.');
    var page = TTHC.Cases.pageOptions(query), snapshot = TTHC.Repo.readSnapshot(['AUDIT_LOGS', 'CASES', 'USERS']), accessible = {}, compiled = TTHC.Permissions.compile(actor);
    if (actor.role !== 'SUPER_ADMIN') {
      snapshot.tables.CASES.forEach(function (row) { if (TTHC.Permissions.indexedAccess(compiled, row.scope_index)) accessible[row.record_id] = true; });
      if (actor.role === 'ADMIN') snapshot.tables.USERS.forEach(function (row) { if (['ADMIN', 'SUPER_ADMIN'].indexOf(row.role) < 0) { try { if (TTHC.Permissions.contains(actor.scope, TTHC.Users.scope(row))) accessible[row.user_id] = true; } catch (ignored) {} } });
    }
    var rows = snapshot.tables.AUDIT_LOGS.filter(function (row) {
      if (query.sourceSystem && row.source_id !== query.sourceSystem || query.action && row.action !== query.action) return false;
      if (actor.role !== 'SUPER_ADMIN' && row.source_id && !TTHC.Permissions.sourceAllowed(actor, row.source_id)) return false;
      if (query.q && String(row.action).toLowerCase().indexOf(String(query.q).toLowerCase()) < 0) return false;
      return actor.role === 'SUPER_ADMIN' || row.actor_id === actor.id || !!accessible[row.target_id];
    });
    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    var selected = rows.slice(page.offset, page.offset + page.pageSize), details = selected.length ? TTHC.Crypto.decryptMany(selected.map(function (row) { return row.details_encrypted; })) : [];
    return { items: selected.map(function (row, i) { return { id: row.audit_id, actorId: row.actor_id, action: row.action, targetId: row.target_id, sourceSystem: row.source_id || null, details: details[i], createdAt: row.created_at }; }), total: rows.length, page: page.page, pageSize: page.pageSize };
  }
  function rpc(action, payload, sessionToken) {
    return controlled(function () {
      if (typeof action !== 'string' || action.length > 80 || !payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 100000) TTHC.Utils.error('VALIDATION_ERROR', 'Yêu cầu RPC không hợp lệ.');
      if (action === 'auth.config') return TTHC.Auth.config();
      if (action === 'auth.login') return TTHC.Auth.login(payload);
      if (action === 'auth.changePassword') return TTHC.Auth.changePassword(payload, sessionToken);
      if (action === 'auth.logout') return TTHC.Auth.logout(sessionToken);
      if (action === 'auth.session') return TTHC.Auth.session(sessionToken);
      var actor = TTHC.Auth.authenticate(sessionToken);
      switch (action) {
        case 'sources.list': return TTHC.Sources.list(actor);
        case 'sources.update': return TTHC.Sources.update(actor, payload);
        case 'sync.list': return TTHC.Sources.syncList(actor, payload);
        case 'dashboard.summary': return TTHC.Dashboard.summary(actor, payload);
        case 'statistics.summary': return TTHC.Reports.summary(actor, payload);
        case 'cases.list': return TTHC.Cases.list(actor, payload);
        case 'cases.detail': return TTHC.Cases.detail(actor, payload);
        case 'alerts.list': return TTHC.Alerts.list(actor, payload);
        case 'alerts.acknowledge': return TTHC.Alerts.acknowledge(actor, payload);
        case 'reports.summary': return TTHC.Reports.summary(actor, payload);
        case 'reports.export': return TTHC.Reports.export(actor, payload);
        case 'officers.list': return TTHC.Dashboard.officers(actor, payload);
        case 'users.list': return TTHC.Users.list(actor);
        case 'users.create': return TTHC.Users.create(actor, payload);
        case 'users.update': return TTHC.Users.update(actor, payload);
        case 'users.resetPassword': return TTHC.Users.resetPassword(actor, payload);
        case 'audit.list': return auditList(actor, payload);
        case 'settings.get': return TTHC.Settings.get();
        case 'settings.update': TTHC.Permissions.requireCapability(actor, 'manageSettings'); return TTHC.Settings.update(payload, actor);
        case 'extension.tokens.create': return TTHC.Auth.createCollector(actor, payload);
        case 'extension.tokens.revoke': return TTHC.Auth.revokeCollector(actor, payload);
        default: TTHC.Utils.error('ACTION_NOT_FOUND', 'Chức năng chưa được hỗ trợ.');
      }
    });
  }
  function post(event) {
    return controlled(function () {
      if (!event || !event.postData || typeof event.postData.contents !== 'string' || event.postData.contents.length > 4500000) TTHC.Utils.error('VALIDATION_ERROR', 'Nội dung Collector không hợp lệ hoặc vượt giới hạn.');
      var payload;
      try { payload = JSON.parse(event.postData.contents); } catch (ignored) { TTHC.Utils.error('VALIDATION_ERROR', 'Nội dung Collector phải là JSON.'); }
      if (!payload || payload.action !== 'collector.sync') TTHC.Utils.error('ACTION_NOT_FOUND', 'Collector chỉ hỗ trợ đồng bộ batch hồ sơ.');
      return TTHC.Cases.sync(payload);
    });
  }
  return { rpc: rpc, post: post, controlled: controlled };
})();
