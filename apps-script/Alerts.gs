var TTHC = TTHC || {};
TTHC.Alerts = (function () {
  'use strict';
  var TYPES = ['WARNING', 'OVERDUE', 'STALE_DATA', 'NEEDS_REVIEW'];
  function id(recordId, kind) { return TTHC.Crypto.hashLookupKey('alert:' + recordId + ':' + kind); }
  function activeKinds(record, settings, now) {
    var evaluated = TTHC.Deadline.evaluate(record, settings, now), kinds = [];
    if (['WARNING', 'OVERDUE', 'NEEDS_REVIEW'].indexOf(evaluated.alertLevel) >= 0) kinds.push(evaluated.alertLevel);
    if (TTHC.Deadline.terminal.indexOf(record.normalizedStatus) < 0 && (!record.lastObservedAt || now - Date.parse(record.lastObservedAt) > settings.staleSeconds * 1000)) kinds.push('STALE_DATA');
    return kinds;
  }
  function contents(record, kind, settings, now) {
    var evaluation = TTHC.Deadline.evaluate(record, settings, now);
    var messages = { WARNING: 'Sắp đến ngày hẹn trả.', OVERDUE: 'Đã đến hoặc vượt ngày hẹn trả.', STALE_DATA: 'Dữ liệu quan sát đã cũ; cần đồng bộ lại.', NEEDS_REVIEW: 'Cần xác nhận ngày hẹn hoặc trạng thái nguồn.' };
    return { caseCode: record.caseCode, message: messages[kind], effectiveDueAt: evaluation.effectiveDueAt, lastObservedAt: record.lastObservedAt, remainingSeconds: evaluation.remainingSeconds, riskReasons: evaluation.riskReasons };
  }
  function prepare(records, previous, settings, now) {
    var rows = [], payloads = [];
    records.forEach(function (record) {
      var active = activeKinds(record, settings, now);
      TYPES.forEach(function (kind) {
        var alertId = id(record.id, kind), old = previous.find(function (row) { return row.alert_id === alertId; }), on = active.indexOf(kind) >= 0;
        if (!on && (!old || old.status === 'RESOLVED')) return;
        var status = on ? old && old.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'OPEN' : 'RESOLVED';
        var row = { alert_id: alertId, record_id: record.id, source_id: record.sourceSystem, alert_type: kind, status: status, scope_index: JSON.stringify(TTHC.Permissions.scopeIndex(record)), payload_encrypted: '', crypto_version: TTHC.Crypto.cryptoVersion, created_at: old && old.status !== 'RESOLVED' ? old.created_at : new Date(now).toISOString(), updated_at: new Date(now).toISOString(), acknowledged_by: status === 'ACKNOWLEDGED' ? old.acknowledged_by : '' };
        if (old && status === 'ACKNOWLEDGED') { row.payload_encrypted = old.payload_encrypted; rows.push(row); return; }
        rows.push(row); payloads.push({ row: row, data: contents(record, kind, settings, now) });
      });
    });
    var encrypted = payloads.length ? TTHC.Crypto.encryptMany(payloads.map(function (entry) { return entry.data; })) : [];
    payloads.forEach(function (entry, i) { entry.row.payload_encrypted = encrypted[i]; });
    return rows;
  }
  function candidates(actor, query, tables, settings, now) {
    var caseQuery = {};
    ['sourceSystem', 'agencyName', 'departmentName', 'officerName', 'agencyKey', 'departmentKey', 'officerKey', 'procedureKey', 'q'].forEach(function (field) { if (query[field]) caseQuery[field] = query[field]; });
    var rows = TTHC.Cases.filterRows(tables.CASES, actor, caseQuery, settings, now), existing = {};
    tables.ALERTS.forEach(function (row) { existing[row.alert_id] = row; });
    var result = [];
    rows.forEach(function (row) {
      var record = { id: row.record_id, sourceSystem: row.source_id, normalizedStatus: row.status_index, originalDueAt: row.due_at, lastObservedAt: row.last_observed_at };
      activeKinds(record, settings, now).forEach(function (kind) {
        var alertId = id(row.record_id, kind), previous = existing[alertId], status = previous && previous.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'OPEN';
        if (query.kind && query.kind !== kind || query.status && query.status !== status) return;
        result.push({ id: alertId, kind: kind, status: status, row: row, previous: previous });
      });
    });
    if ((!query.kind || query.kind === 'SOURCE_ERROR') && (!query.status || query.status === 'OPEN')) {
      TTHC.Sources.all(tables.SOURCES).filter(function (source) { return source.lastError && (!query.sourceSystem || query.sourceSystem === source.id) && TTHC.Permissions.sourceAllowed(actor, source.id); }).forEach(function (source) {
        result.push({ id: id(source.id, 'SOURCE_ERROR'), kind: 'SOURCE_ERROR', status: 'OPEN', source: source });
      });
    }
    var priority = { OVERDUE: 0, SOURCE_ERROR: 1, WARNING: 2, STALE_DATA: 3, NEEDS_REVIEW: 4 };
    result.sort(function (a, b) { return priority[a.kind] - priority[b.kind] || String(a.row && a.row.due_at || '').localeCompare(String(b.row && b.row.due_at || '')); });
    return result;
  }
  function list(actor, query) {
    query = query || {};
    if (Object.keys(query).some(function (field) { return ['sourceSystem', 'agencyName', 'departmentName', 'officerName', 'agencyKey', 'departmentKey', 'officerKey', 'procedureKey', 'q', 'kind', 'status', 'page', 'pageSize'].indexOf(field) < 0; }) || query.kind && TYPES.concat('SOURCE_ERROR').indexOf(query.kind) < 0 || query.status && ['OPEN', 'ACKNOWLEDGED'].indexOf(query.status) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Bộ lọc cảnh báo không hợp lệ.');
    var page = TTHC.Cases.pageOptions(query), settings = TTHC.Settings.get(), now = Date.now(), snapshot = TTHC.Repo.readSnapshot(['CASES', 'ALERTS', 'SOURCES']), items = candidates(actor, query, snapshot.tables, settings, now), selected = items.slice(page.offset, page.offset + page.pageSize), encrypted = [], caseRefs = {}, decoded;
    selected.forEach(function (item) { if (item.row && !Object.prototype.hasOwnProperty.call(caseRefs, item.row.record_id)) { caseRefs[item.row.record_id] = encrypted.length; encrypted.push(item.row.payload_encrypted); } });
    decoded = encrypted.length ? TTHC.Crypto.decryptMany(encrypted) : [];
    return { items: selected.map(function (item) {
      if (item.source) return { id: item.id, kind: item.kind, status: item.status, sourceSystem: item.source.id, caseId: null, caseCode: '', message: 'Nguồn đồng bộ gặp lỗi: ' + item.source.lastError, createdAt: item.source.lastSyncedAt };
      var record = decoded[caseRefs[item.row.record_id]];
      return Object.assign(contents(record, item.kind, settings, now), { id: item.id, kind: item.kind, alertLevel: item.kind, status: item.status, caseId: item.row.record_id, sourceSystem: item.row.source_id, agencyName: record.agencyName || '', departmentName: record.departmentName || '', officerName: record.officerName || '', createdAt: item.previous ? item.previous.created_at : item.row.updated_at, acknowledgedBy: item.previous && item.previous.acknowledged_by || null });
    }), total: items.length, page: page.page, pageSize: page.pageSize };
  }
  function acknowledge(actor, payload) {
    TTHC.Permissions.requireCapability(actor, 'acknowledge');
    if (!payload || typeof payload.id !== 'string' || payload.id.length > 100 || Object.keys(payload).some(function (field) { return field !== 'id'; })) TTHC.Utils.error('VALIDATION_ERROR', 'Mã cảnh báo không hợp lệ.');
    var snapshot = TTHC.Repo.readSnapshot(['USERS', 'CASES', 'ALERTS', 'SOURCES']), current = TTHC.Users.authorize(actor.id, snapshot.tables.USERS), settings = TTHC.Settings.get(), now = Date.now();
    TTHC.Permissions.requireCapability(current, 'acknowledge');
    var item = candidates(current, {}, snapshot.tables, settings, now).find(function (entry) { return entry.id === payload.id; });
    if (!item) TTHC.Utils.error('NOT_FOUND', 'Cảnh báo không còn hoạt động hoặc ngoài phạm vi.');
    if (!item.row) TTHC.Utils.error('VALIDATION_ERROR', 'Lỗi nguồn được xử lý bằng đồng bộ lại; không thể xác nhận như cảnh báo hồ sơ.');
    var record = TTHC.Crypto.decrypt(item.row.payload_encrypted), details = Object.assign(contents(record, item.kind, settings, now), { acknowledgedAt: new Date(now).toISOString() });
    var row = { alert_id: item.id, record_id: record.id, source_id: record.sourceSystem, alert_type: item.kind, status: 'ACKNOWLEDGED', scope_index: JSON.stringify(TTHC.Permissions.scopeIndex(record)), payload_encrypted: TTHC.Crypto.encrypt(details), crypto_version: TTHC.Crypto.cryptoVersion, created_at: item.previous ? item.previous.created_at : new Date(now).toISOString(), updated_at: new Date(now).toISOString(), acknowledged_by: current.id };
    TTHC.Repo.commit([{ table: 'ALERTS', keyField: 'alert_id', rows: [row] }], snapshot.revision);
    TTHC.Audit.record(current.id, 'ACK_ALERT', item.id, { result: 'SUCCESS' }, record.sourceSystem);
    return { acknowledged: true, id: item.id };
  }
  return { prepare: prepare, list: list, acknowledge: acknowledge, activeKinds: activeKinds, id: id };
})();
