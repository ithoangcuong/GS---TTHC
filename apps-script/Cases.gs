var TTHC = TTHC || {};
TTHC.Cases = (function () {
  'use strict';
  var STATUSES = ['NEW', 'RECEIVED', 'PROCESSING', 'WAITING_ADDITIONAL_DOCUMENTS', 'PAUSED', 'TRANSFERRED', 'COMPLETED', 'RETURNED', 'CANCELLED', 'OVERDUE', 'UNKNOWN'];
  var FIELDS = ['sourceSystem', 'sourceName', 'sourceRecordId', 'sourceCaseId', 'caseCode', 'procedureCode', 'procedureName', 'submittedAt', 'receivedAt', 'originalDueAt', 'dueAt', 'effectiveDueAt', 'extensionDueAt', 'extensionConfirmed', 'completedAt', 'agencyId', 'agencyName', 'departmentId', 'departmentName', 'officerId', 'officerName', 'sourceStatus', 'normalizedStatus', 'currentStep', 'totalSteps', 'lastObservedAt'];
  var DATES = ['submittedAt', 'receivedAt', 'originalDueAt', 'dueAt', 'effectiveDueAt', 'extensionDueAt', 'completedAt', 'lastObservedAt'];
  var FILTERS = ['q', 'sourceSystem', 'normalizedStatus', 'alertLevel', 'agencyName', 'departmentName', 'officerName', 'procedureName', 'agencyKey', 'departmentKey', 'officerKey', 'procedureKey', 'submittedFrom', 'submittedTo', 'receivedFrom', 'receivedTo', 'dueFrom', 'dueTo', 'observedBefore', 'page', 'pageSize', 'sortBy', 'sortDirection', 'bucket'];
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
  function normalize(raw, sourceId, configuration, now) {
    now = now === undefined ? Date.now() : now; configuration = configuration || {};
    if (!plain(raw)) TTHC.Utils.error('VALIDATION_ERROR', 'Hồ sơ phải là một object JSON.');
    if (JSON.stringify(raw).length > 20000) TTHC.Utils.error('VALIDATION_ERROR', 'Hồ sơ vượt giới hạn 20KB.');
    var mapping = configuration.fieldMappings || {}, accepted = FIELDS.concat(Object.keys(mapping));
    if (Object.keys(raw).some(function (field) { return accepted.indexOf(field) < 0 || ['__proto__', 'constructor', 'prototype'].indexOf(field) >= 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Hồ sơ chứa trường ngoài whitelist giám sát.');
    var record = {};
    FIELDS.forEach(function (field) { if (own(raw, field)) record[field] = raw[field]; });
    Object.keys(mapping).forEach(function (sourceField) {
      var canonical = mapping[sourceField];
      if (FIELDS.indexOf(canonical) < 0 || ['sourceSystem', 'sourceName', 'normalizedStatus', 'extensionConfirmed'].indexOf(canonical) >= 0) TTHC.Utils.error('CONFIGURATION_ERROR', 'Ánh xạ trường nguồn không hợp lệ.');
      if (!own(record, canonical) && own(raw, sourceField)) record[canonical] = raw[sourceField];
    });
    if (own(record, 'sourceSystem') && record.sourceSystem !== sourceId) TTHC.Utils.error('VALIDATION_ERROR', 'Nguồn hồ sơ không khớp nguồn batch.');
    var source = TTHC.Sources.definitions().find(function (item) { return item.id === sourceId; });
    if (!source) TTHC.Utils.error('VALIDATION_ERROR', 'Nguồn không được đăng ký.');
    record.sourceSystem = sourceId; record.sourceName = source.name;
    Object.keys(record).forEach(function (field) {
      if (DATES.indexOf(field) >= 0) { record[field] = TTHC.Utils.parseDate(record[field]); return; }
      if (['currentStep', 'totalSteps'].indexOf(field) >= 0) {
        if (record[field] === null) return;
        if (typeof record[field] === 'string' && /^\d+$/.test(record[field])) record[field] = Number(record[field]);
        if (!Number.isSafeInteger(record[field]) || record[field] < 0 || record[field] > 10000) TTHC.Utils.error('VALIDATION_ERROR', 'Số bước xử lý không hợp lệ.');
        return;
      }
      if (field === 'extensionConfirmed') { if (typeof record[field] !== 'boolean') TTHC.Utils.error('VALIDATION_ERROR', 'Xác nhận gia hạn phải là boolean.'); return; }
      if (record[field] === null) return;
      var limit = /(?:Id|Code)$/.test(field) ? 200 : 1000;
      if (typeof record[field] !== 'string' || record[field].length > limit || /[\u0000-\u001f]/.test(record[field])) TTHC.Utils.error('VALIDATION_ERROR', 'Chuỗi hồ sơ không hợp lệ hoặc vượt giới hạn.');
      record[field] = record[field].trim();
    });
    if (!record.caseCode) TTHC.Utils.error('VALIDATION_ERROR', 'Mã hồ sơ là bắt buộc.');
    if (!record.lastObservedAt || Date.parse(record.lastObservedAt) > now + 300000) TTHC.Utils.error('VALIDATION_ERROR', 'Quan sát lần cuối bắt buộc và không được nằm trong tương lai.');
    if (record.currentStep != null && record.totalSteps != null && record.currentStep > record.totalSteps) TTHC.Utils.error('VALIDATION_ERROR', 'Bước hiện tại vượt tổng số bước.');
    [['submittedAt', 'receivedAt'], ['submittedAt', 'completedAt'], ['receivedAt', 'completedAt']].forEach(function (pair) { if (record[pair[0]] && record[pair[1]] && Date.parse(record[pair[0]]) > Date.parse(record[pair[1]])) TTHC.Utils.error('VALIDATION_ERROR', 'Thứ tự thời gian hồ sơ không hợp lệ.'); });
    if (record.normalizedStatus !== undefined && STATUSES.indexOf(record.normalizedStatus) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Trạng thái chuẩn không hợp lệ.');
    // The collector's normalizedStatus is never authoritative. Only confirmed server mappings apply.
    delete record.normalizedStatus;
    var statuses = configuration.statusMappings || {};
    if (own(record, 'sourceStatus')) record.normalizedStatus = record.sourceStatus && own(statuses, record.sourceStatus) ? statuses[record.sourceStatus] : 'UNKNOWN';
    if (!record.normalizedStatus) record.normalizedStatus = 'UNKNOWN';
    if (record.normalizedStatus !== undefined && STATUSES.indexOf(record.normalizedStatus) < 0) TTHC.Utils.error('CONFIGURATION_ERROR', 'Ánh xạ trạng thái không hợp lệ.');
    if (record.extensionConfirmed && configuration.extensionPolicyConfirmed !== true) TTHC.Utils.error('VALIDATION_ERROR', 'Nguồn chưa được xác nhận quy tắc gia hạn.');
    if (own(record, 'extensionConfirmed') || own(record, 'extensionDueAt')) record.extensionConfirmed = !!(record.extensionConfirmed && record.extensionDueAt && configuration.extensionPolicyConfirmed === true);
    var official = own(record, 'dueAt') ? record.dueAt : record.originalDueAt || null;
    if (record.effectiveDueAt && record.effectiveDueAt !== (record.extensionConfirmed ? record.extensionDueAt : official)) TTHC.Utils.error('VALIDATION_ERROR', 'Ngày hạn hiệu lực không khớp ngày hẹn trả chính thức.');
    delete record.effectiveDueAt;
    return record;
  }
  function configurations(tables, sourceId) {
    var result = { fieldMappings: {}, statusMappings: {}, extensionPolicyConfirmed: false };
    (tables.STATUS_MAPPING || []).filter(function (row) { return row.source_id === sourceId && (row.confirmed === true || row.confirmed === 'true'); }).forEach(function (row) { result.statusMappings[row.source_status] = row.normalized_status; });
    (tables.SOURCE_MAPPING || []).filter(function (row) { return row.source_id === sourceId; }).forEach(function (row) {
      var stored = TTHC.Crypto.decrypt(row.payload_encrypted);
      if (!plain(stored)) TTHC.Utils.error('CONFIGURATION_ERROR', 'Cấu hình ánh xạ nguồn không hợp lệ.');
      Object.assign(result.fieldMappings, stored.fieldMappings || {});
      result.extensionPolicyConfirmed = result.extensionPolicyConfirmed || stored.extensionPolicyConfirmed === true;
    });
    return result;
  }
  function aliases(record) {
    return [['CODE', record.caseCode], ['RECORD', record.sourceRecordId], ['CASE', record.sourceCaseId]].filter(function (pair) { return !!pair[1]; }).map(function (pair) { return TTHC.Crypto.hashLookupKey('case:' + record.sourceSystem + ':' + pair[0] + ':' + pair[1]); });
  }
  function parseIndex(row) { try { return JSON.parse(row.scope_index); } catch (ignored) { TTHC.Utils.error('DATA_ERROR', 'Chỉ mục hồ sơ không hợp lệ.'); } }
  function rowAliases(row) { try { return JSON.parse(row.case_alias_hashes || '[]'); } catch (ignored) { TTHC.Utils.error('DATA_ERROR', 'Chỉ mục định danh hồ sơ không hợp lệ.'); } }
  function terms(value) { return String(value || '').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean); }
  function index(record) {
    var result = TTHC.Permissions.scopeIndex(record); result.groups = {};
    [['agency', 'agencyName', 'agencyId'], ['department', 'departmentName', 'departmentId'], ['officer', 'officerName', 'officerId'], ['procedure', 'procedureName', 'procedureCode']].forEach(function (entry) { var label = record[entry[1]] || record[entry[2]]; result.groups[entry[0]] = label ? TTHC.Crypto.hashLookupKey('group:' + entry[0] + ':' + label) : ''; });
    var search = [];
    [record.caseCode, record.procedureName, record.procedureCode, record.officerName].forEach(function (text) { terms(text).slice(0, 10).forEach(function (term) { search.push(TTHC.Crypto.hashLookupKey('search:' + term)); for (var n = 2; n <= Math.min(8, term.length - 1); n++) search.push(TTHC.Crypto.hashLookupKey('search:' + term.slice(0, n))); }); });
    result.search = Array.from(new Set(search)); return result;
  }
  function rowFor(record, previous, ciphertext, settings, now) {
    var evaluation = TTHC.Deadline.evaluate(record, settings, now);
    return { record_id: record.id, case_key_hash: aliases(record)[0], case_alias_hashes: JSON.stringify(Array.from(new Set((previous ? rowAliases(previous) : []).concat(aliases(record))))), source_id: record.sourceSystem, payload_encrypted: ciphertext, crypto_version: TTHC.Crypto.cryptoVersion, alert_index: evaluation.alertLevel, scope_index: JSON.stringify(index(record)), updated_at: record.updatedAt, last_synced_at: record.lastSyncedAt, last_observed_at: record.lastObservedAt, due_at: evaluation.effectiveDueAt || '', received_at: record.receivedAt || '', status_index: record.normalizedStatus, completion_index: evaluation.completionResult || '' };
  }
  function view(row, data, settings, now) {
    data = data || TTHC.Crypto.decrypt(row.payload_encrypted);
    var result = Object.assign({}, data, TTHC.Deadline.evaluate(data, settings, now));
    result.id = row.record_id; result.lastSyncedAt = row.last_synced_at; result.lastObservedAt = row.last_observed_at; result.updatedAt = row.updated_at;
    result.stale = !result.lastObservedAt || (now === undefined ? Date.now() : now) - Date.parse(result.lastObservedAt) > (settings || TTHC.Settings.get()).staleSeconds * 1000;
    return result;
  }
  function pageOptions(query) {
    var page = Number(query.page || 1), pageSize = Number(query.pageSize || 25);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) TTHC.Utils.error('VALIDATION_ERROR', 'Phân trang không hợp lệ.');
    return { page: page, pageSize: pageSize, offset: (page - 1) * pageSize };
  }
  function dateFilter(value, end) {
    if (!value) return null;
    if (typeof value !== 'string') TTHC.Utils.error('VALIDATION_ERROR', 'Khoảng ngày không hợp lệ.');
    return Date.parse(TTHC.Utils.parseDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + (end ? 'T23:59:59.999+07:00' : 'T00:00:00+07:00') : value));
  }
  function evaluationFromIndex(row, settings, now) {
    return TTHC.Deadline.evaluate({ normalizedStatus: row.status_index, originalDueAt: row.due_at || null, completedAt: null }, settings, now);
  }
  function latestMocSnapshot(audits) {
    var entries = (audits || TTHC.Repo.read('AUDIT_LOGS')).filter(function (row) { return row.action === 'MOC_SNAPSHOT' && row.source_id === 'MOC'; });
    return entries.length ? TTHC.Crypto.decrypt(entries[entries.length - 1].details_encrypted) : null;
  }
  function submittedDates(rows) {
    if (!rows.length) return [];
    // For small collections a cache service call costs more than local decoding.
    if (rows.length <= 20) return TTHC.Crypto.decryptMany(rows.map(function (row) { return row.payload_encrypted; })).map(function (record) {
      var time = Date.parse(record.submittedAt); return Number.isFinite(time) ? time : null;
    });
    var dates = [], cache = CacheService.getScriptCache();
    // Cache only compact encrypted dates, never plaintext business records.
    // Content fingerprints invalidate immediately even when dates change within
    // the same timestamp. Permission filtering happens before calling this.
    for (var offset = 0; offset < rows.length; offset += 100) {
      var chunk = rows.slice(offset, offset + 100);
      var key = 'submitted-v1:' + TTHC.Crypto.hashLookupKey(JSON.stringify(chunk.map(function (row) {
        return [row.record_id, TTHC.Crypto.hashLookupKey(row.payload_encrypted)];
      })));
      var times = null;
      try {
        var stored = cache.get(key);
        if (stored) times = TTHC.Crypto.decrypt(stored);
        if (!Array.isArray(times) || times.length !== chunk.length || times.some(function (time) { return time !== null && (typeof time !== 'number' || !Number.isFinite(time)); })) times = null;
      } catch (ignored) { times = null; }
      if (!times) {
        times = TTHC.Crypto.decryptMany(chunk.map(function (row) { return row.payload_encrypted; })).map(function (record) {
          var time = Date.parse(record.submittedAt); return Number.isFinite(time) ? time : null;
        });
        try { cache.put(key, TTHC.Crypto.encrypt(times), 300); } catch (ignored) {}
      }
      dates = dates.concat(times);
    }
    return dates;
  }
  function filterRows(rows, actor, query, settings, now) {
    query = query || {}; settings = settings || TTHC.Settings.get(); now = now === undefined ? Date.now() : now;
    if (!plain(query) || Object.keys(query).some(function (field) { return FILTERS.indexOf(field) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Bộ lọc chứa trường không hợp lệ.');
    Object.keys(query).forEach(function (field) { if (['page', 'pageSize'].indexOf(field) < 0 && (typeof query[field] !== 'string' || query[field].length > 200)) TTHC.Utils.error('VALIDATION_ERROR', 'Giá trị bộ lọc không hợp lệ.'); });
    var compiled = TTHC.Permissions.compile(actor), dateRanges = [['receivedFrom', 'received_at', false, true], ['receivedTo', 'received_at', true, false], ['dueFrom', 'due_at', false, true], ['dueTo', 'due_at', true, false], ['observedBefore', 'last_observed_at', true, false]].filter(function (entry) { return !!query[entry[0]]; }).map(function (entry) { return { field: entry[1], value: dateFilter(query[entry[0]], entry[2]), after: entry[3] }; });
    if (query.bucket && ['active', 'completed', 'overdue', 'warning', 'onTime', 'completedLate', 'waitingAdditional', 'observed24h', 'stale'].indexOf(query.bucket) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Nhóm hồ sơ không hợp lệ.');
    var textFilters = [['agencyName', 'agencies'], ['departmentName', 'departments'], ['officerName', 'officers']].filter(function (entry) { return !!query[entry[0]]; }).map(function (entry) { return { dim: entry[1], hash: TTHC.Crypto.hashLookupKey(entry[1] + ':' + query[entry[0]]) }; });
    var procedure = query.procedureName && TTHC.Crypto.hashLookupKey('group:procedure:' + query.procedureName), search = terms(query.q).map(function (term) { return TTHC.Crypto.hashLookupKey('search:' + term); });
    var groupFilters = ['agency', 'department', 'officer', 'procedure'].filter(function (dimension) { return !!query[dimension + 'Key']; }).map(function (dimension) {
      var value = query[dimension + 'Key'];
      if (!/^[a-f0-9]{64}$/.test(value) && value !== 'UNASSIGNED') TTHC.Utils.error('VALIDATION_ERROR', 'Chỉ mục nhóm không hợp lệ.');
      return { dimension: dimension, value: value === 'UNASSIGNED' ? '' : value };
    });
    var submittedFrom = dateFilter(query.submittedFrom, false), submittedTo = dateFilter(query.submittedTo, true);
    ['submittedFrom', 'submittedTo'].forEach(function (key) { if (query[key] && !/^\d{4}-\d{2}-\d{2}$/.test(query[key])) TTHC.Utils.error('VALIDATION_ERROR', 'Ngày nộp phải có định dạng YYYY-MM-DD.'); });
    if (submittedFrom !== null && submittedTo !== null && submittedFrom > submittedTo) TTHC.Utils.error('VALIDATION_ERROR', 'Ngày nộp từ ngày phải trước hoặc bằng đến ngày.');
    var currentMoc = rows.some(function (row) { return row.source_id === 'MOC'; }) ? latestMocSnapshot() : null;
    var filtered = rows.filter(function (row) {
      if (row.source_id === 'MOC' && currentMoc && currentMoc.recordIds.indexOf(row.record_id) < 0) return false;
      if (!TTHC.Permissions.indexedAccess(compiled, row.scope_index)) return false;
      if (query.sourceSystem && row.source_id !== query.sourceSystem) return false;
      var ix = parseIndex(row), evaluation = evaluationFromIndex(row, settings, now);
      if (query.normalizedStatus && evaluation.normalizedStatus !== query.normalizedStatus) return false;
      if (query.alertLevel && evaluation.alertLevel !== query.alertLevel) return false;
      if (query.bucket === 'active' && TTHC.Deadline.terminal.indexOf(row.status_index) >= 0) return false;
      if (query.bucket === 'completed' && row.status_index !== 'COMPLETED') return false;
      if (query.bucket === 'overdue' && evaluation.alertLevel !== 'OVERDUE') return false;
      if (query.bucket === 'warning' && evaluation.alertLevel !== 'WARNING') return false;
      if (query.bucket === 'onTime' && row.completion_index !== 'ON_TIME') return false;
      if (query.bucket === 'completedLate' && row.completion_index !== 'LATE') return false;
      if (query.bucket === 'waitingAdditional' && row.status_index !== 'WAITING_ADDITIONAL_DOCUMENTS') return false;
      if (query.bucket === 'observed24h' && (TTHC.Deadline.terminal.indexOf(row.status_index) >= 0 || !row.last_observed_at || now - Date.parse(row.last_observed_at) > 86400000)) return false;
      if (query.bucket === 'stale' && (TTHC.Deadline.terminal.indexOf(row.status_index) >= 0 || row.last_observed_at && now - Date.parse(row.last_observed_at) <= settings.staleSeconds * 1000)) return false;
      if (dateRanges.some(function (range) { var time = Date.parse(row[range.field]); return !Number.isFinite(time) || (range.after ? time < range.value : time > range.value); })) return false;
      if (textFilters.some(function (entry) { return (ix[entry.dim] || []).indexOf(entry.hash) < 0; })) return false;
      if (procedure && ix.groups.procedure !== procedure) return false;
      if (groupFilters.some(function (entry) { return (ix.groups[entry.dimension] || '') !== entry.value; })) return false;
      return search.every(function (term) { return (ix.search || []).indexOf(term) >= 0; });
    });
    // Existing sheets store submittedAt in the encrypted payload. Scope and indexed
    // filters run first so unrelated records are never decrypted for this filter.
    if (submittedFrom === null && submittedTo === null) return filtered;
    var dates = submittedDates(filtered);
    return filtered.filter(function (row, i) {
      var time = dates[i];
      return time !== null && (submittedFrom === null || time >= submittedFrom) && (submittedTo === null || time <= submittedTo);
    });
  }
  function list(actor, query) {
    query = query || {}; var page = pageOptions(query), settings = TTHC.Settings.get(), now = Date.now();
    var rows = filterRows(TTHC.Repo.read('CASES'), actor, query, settings, now);
    var sort = query.sortBy || 'priority', allowed = ['priority', 'dueAt', 'updatedAt', 'receivedAt', 'lastObservedAt', 'alertLevel'];
    if (allowed.indexOf(sort) < 0 || query.sortDirection && ['asc', 'desc'].indexOf(query.sortDirection) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Sắp xếp không hợp lệ.');
    var direction = query.sortDirection === 'desc' ? -1 : 1;
    rows.sort(function (a, b) {
      var order;
      if (sort === 'priority' || sort === 'alertLevel') {
        var priority = { OVERDUE: 0, WARNING: 1, STALE_DATA: 2, NEEDS_REVIEW: 3, SAFE: 4 };
        function priorityLevel(row) { var level = evaluationFromIndex(row, settings, now).alertLevel; return level === 'SAFE' && TTHC.Deadline.terminal.indexOf(row.status_index) < 0 && (!row.last_observed_at || now - Date.parse(row.last_observed_at) > settings.staleSeconds * 1000) ? 'STALE_DATA' : level; }
        var aLevel = priorityLevel(a), bLevel = priorityLevel(b);
        order = priority[aLevel] - priority[bLevel];
        if (!order) order = aLevel === 'STALE_DATA' ? String(a.last_observed_at).localeCompare(String(b.last_observed_at)) : String(a.due_at || '\uffff').localeCompare(String(b.due_at || '\uffff'));
      }
      else { var field = { dueAt: 'due_at', updatedAt: 'updated_at', receivedAt: 'received_at', lastObservedAt: 'last_observed_at', caseCode: 'case_key_hash' }[sort]; order = String(a[field] || '\uffff').localeCompare(String(b[field] || '\uffff')); }
      return order * direction || String(a.record_id).localeCompare(String(b.record_id));
    });
    var selected = rows.slice(page.offset, page.offset + page.pageSize), payloads = selected.length ? TTHC.Crypto.decryptMany(selected.map(function (row) { return row.payload_encrypted; })) : [];
    return { items: selected.map(function (row, i) { return view(row, payloads[i], settings, now); }), total: rows.length, page: page.page, pageSize: page.pageSize };
  }
  function detail(actor, payload) {
    if (!payload || typeof payload.id !== 'string' || payload.id.length > 100 || Object.keys(payload).some(function (field) { return field !== 'id'; })) TTHC.Utils.error('VALIDATION_ERROR', 'Mã định danh không hợp lệ.');
    var row = TTHC.Repo.read('CASES').find(function (item) { return item.record_id === payload.id; });
    if (!row || !TTHC.Permissions.indexedAccess(TTHC.Permissions.compile(actor), row.scope_index)) TTHC.Utils.error('NOT_FOUND', 'Không tìm thấy hồ sơ trong phạm vi được cấp.');
    if (row.source_id === 'MOC') { var current = latestMocSnapshot(); if (current && current.recordIds.indexOf(row.record_id) < 0) TTHC.Utils.error('NOT_FOUND', 'Hồ sơ không thuộc lần đọc MOC hiện tại.'); }
    return view(row);
  }
  function collectionContext(value) {
    if (value === undefined) return null;
    if (!plain(value) || Object.keys(value).some(function (key) { return ['submittedFrom','submittedTo','capturedAt','scope','basis'].indexOf(key) < 0; }) || value.scope !== 'CURRENT_PAGE_ONLY' || value.basis !== 'VISIBLE_FILTERS') TTHC.Utils.error('VALIDATION_ERROR', 'Phạm vi thu thập không hợp lệ.');
    ['submittedFrom','submittedTo'].forEach(function (key) {
      var date = value[key];
      if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) TTHC.Utils.error('VALIDATION_ERROR', 'Ngày nộp trong bộ lọc không hợp lệ.');
    });
    if (value.submittedFrom && value.submittedTo && value.submittedFrom > value.submittedTo) TTHC.Utils.error('VALIDATION_ERROR', 'Khoảng ngày nộp bị đảo ngược.');
    if (typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) || Date.parse(value.capturedAt) > Date.now() + 300000) TTHC.Utils.error('VALIDATION_ERROR', 'Thời điểm đọc bộ lọc không hợp lệ.');
    return { submittedFrom: value.submittedFrom, submittedTo: value.submittedTo, capturedAt: new Date(value.capturedAt).toISOString(), scope: value.scope, basis: value.basis };
  }
  function sync(payload) {
    if (!plain(payload) || Object.keys(payload).some(function (field) { return ['action', 'token', 'sourceSystem', 'hostname', 'cases', 'batchId', 'collectionContext', 'replaceSource'].indexOf(field) < 0; }) || payload.action !== 'collector.sync') TTHC.Utils.error('VALIDATION_ERROR', 'Yêu cầu Collector không hợp lệ.');
    if (payload.replaceSource !== undefined && (payload.replaceSource !== true || payload.sourceSystem !== 'MOC')) TTHC.Utils.error('VALIDATION_ERROR', 'Chế độ thay thế chỉ áp dụng nguồn MOC.');
    if (payload.sourceSystem === 'MOC' && payload.replaceSource !== true) TTHC.Utils.error('COLLECTOR_UPDATE_REQUIRED', 'Cần Collector 0.7.0 để thay thế dữ liệu MOC theo lần đọc mới nhất.');
    var context = collectionContext(payload.collectionContext);
    if (!Array.isArray(payload.cases) || payload.cases.length < 1 || payload.cases.length > 200 || typeof payload.batchId !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(payload.batchId)) TTHC.Utils.error('VALIDATION_ERROR', 'Batch cần 1–200 hồ sơ và mã batch hợp lệ.');
    var names = ['USERS', 'COLLECTOR_TOKENS', 'SOURCES', 'CASES', 'ALERTS', 'SYNC_LOGS', 'SOURCE_MAPPING', 'STATUS_MAPPING', 'AUDIT_LOGS'], snapshot = TTHC.Repo.readSnapshot(names), tables = snapshot.tables;
    var actor = TTHC.Auth.collector(payload.token, payload.sourceSystem, payload.hostname, tables), source = TTHC.Sources.find(payload.sourceSystem, tables.SOURCES);
    TTHC.Sources.validateHost(source, payload.hostname);
    if (!source.enabled) TTHC.Utils.error('SOURCE_DISABLED', 'Nguồn đang bị tắt.');
    var prior = tables.SYNC_LOGS.find(function (row) { return row.batch_id === payload.batchId && row.source_id === source.id && row.actor_id === actor.id; });
    if (prior) return { id: prior.sync_id, total: Number(prior.accepted) + Number(prior.rejected), created: 0, updated: 0, skipped: Number(prior.accepted), failed: Number(prior.rejected), errors: [], status: prior.status, duplicateBatch: true };
    if (payload.replaceSource) {
      if (actor.role !== 'SUPER_ADMIN' && ['agencies','departments','officers'].some(function (dim) { return actor.scope[dim].indexOf('*') < 0; })) TTHC.Utils.error('ACCESS_DENIED', 'Thay thế toàn nguồn cần quyền toàn bộ đơn vị và cán bộ của nguồn MOC.');
      if (!context) TTHC.Utils.error('VALIDATION_ERROR', 'Lần đọc MOC cần khoảng ngày và thời điểm quan sát.');
      var previousSnapshot = latestMocSnapshot(tables.AUDIT_LOGS);
      if (previousSnapshot && Date.parse(context.capturedAt) <= Date.parse(previousSnapshot.capturedAt)) TTHC.Utils.error('CONFLICT', 'Lần đọc này cũ hơn hoặc trùng lần đọc MOC hiện tại.');
    }
    var now = Date.now(), iso = new Date(now).toISOString(), settings = TTHC.Settings.get(), configuration = configurations(tables, source.id), lookup = {}, byId = {}, normalized = [], errors = [], counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
    tables.CASES.forEach(function (row) { byId[row.record_id] = row; rowAliases(row).forEach(function (alias) { if (lookup[alias] && lookup[alias] !== row.record_id) TTHC.Utils.error('DATA_ERROR', 'Chỉ mục định danh hồ sơ bị trùng.'); lookup[alias] = row.record_id; }); });
    var prepared = [];
    payload.cases.forEach(function (raw, i) {
      try {
        var input = normalize(raw, source.id, configuration, now), ids = Array.from(new Set(aliases(input).map(function (alias) { return lookup[alias]; }).filter(Boolean)));
        if (ids.length > 1) TTHC.Utils.error('VALIDATION_ERROR', 'Các mã định danh nguồn xung đột.');
        var previous = ids.length ? byId[ids[0]] : null;
        if (previous && !TTHC.Permissions.indexedAccess(TTHC.Permissions.compile(actor), previous.scope_index)) TTHC.Utils.error('ACCESS_DENIED', 'Hồ sơ hiện tại ngoài phạm vi.');
        prepared.push({ input: input, previous: previous, index: i });
      } catch (error) { counts.failed++; errors.push({ index: i, row: i + 1, code: error.code || 'VALIDATION_ERROR', message: error.code ? error.message : 'Hồ sơ không hợp lệ.' }); }
    });
    var previousRows = prepared.filter(function (entry) { return entry.previous; }), decoded = previousRows.length ? TTHC.Crypto.decryptMany(previousRows.map(function (entry) { return entry.previous.payload_encrypted; })) : [];
    previousRows.forEach(function (entry, i) { entry.old = decoded[i]; });
    var staged = {}, claimed = {};
    prepared.forEach(function (entry) {
      try {
        var previous = entry.previous, old = previous ? staged[previous.record_id] || entry.old : {}, input = entry.input;
        var stagedIds = Array.from(new Set(aliases(input).map(function (alias) { return claimed[alias]; }).filter(Boolean).concat(previous ? [previous.record_id] : [])));
        if (stagedIds.length > 1) TTHC.Utils.error('VALIDATION_ERROR', 'Các mã định danh xung đột trong batch.');
        var stagedId = stagedIds[0];
        if (stagedId && !previous) { old = staged[stagedId]; previous = { record_id: stagedId }; }
        if (previous && old.lastObservedAt && Date.parse(input.lastObservedAt) < Date.parse(old.lastObservedAt)) { counts.skipped++; return; }
        ['sourceRecordId', 'sourceCaseId'].forEach(function (field) { if (old[field] && input[field] && old[field] !== input[field]) TTHC.Utils.error('VALIDATION_ERROR', 'Mã định danh nguồn không thể đổi hoặc xung đột.'); });
        var record = Object.assign({}, old, input, { id: previous ? previous.record_id : TTHC.Utils.id(), sourceSystem: source.id, createdAt: old.createdAt || iso, updatedAt: iso, lastSyncedAt: iso });
        record.lastCollectionContext = context;
        record.originalDueAt = old.originalDueAt || input.originalDueAt || input.dueAt || null;
        var mergedFields = {}; FIELDS.forEach(function (field) { if (own(record, field)) mergedFields[field] = record[field]; });
        Object.assign(record, normalize(mergedFields, source.id, configuration, now));
        record.normalizedStatus = record.sourceStatus && own(configuration.statusMappings, record.sourceStatus) ? configuration.statusMappings[record.sourceStatus] : 'UNKNOWN';
        if (!TTHC.Permissions.hasAccess(actor, record)) TTHC.Utils.error('ACCESS_DENIED', 'Hồ sơ ngoài phạm vi đơn vị, phòng hoặc cán bộ.');
        aliases(record).forEach(function (alias) { if (claimed[alias] && claimed[alias] !== record.id) TTHC.Utils.error('VALIDATION_ERROR', 'Mã hồ sơ xung đột trong batch.'); });
        staged[record.id] = record;
        aliases(record).forEach(function (alias) { claimed[alias] = record.id; });
        counts[previous ? 'updated' : 'created']++;
      } catch (error) { counts.failed++; errors.push({ index: entry.index, row: entry.index + 1, code: error.code || 'VALIDATION_ERROR', message: error.code ? error.message : 'Hồ sơ không hợp lệ.' }); }
    });
    normalized = Object.keys(staged).map(function (id) { return staged[id]; });
    if (payload.replaceSource && (counts.failed || counts.skipped || normalized.length !== payload.cases.length)) TTHC.Utils.error('SNAPSHOT_INCOMPLETE', 'Chưa thay thế MOC vì có hồ sơ lỗi, trùng mã hoặc quan sát cũ.');
    var encrypted = normalized.length ? TTHC.Crypto.encryptMany(normalized) : [], caseRows = normalized.map(function (record, i) { return rowFor(record, byId[record.id], encrypted[i], settings, now); });
    var alertRows = TTHC.Alerts.prepare(normalized, tables.ALERTS, settings, now);
    var syncId = TTHC.Utils.id(), status = counts.failed === payload.cases.length ? 'SYNC_ERROR' : counts.failed ? 'PARTIAL_SUCCESS' : 'SYNC_SUCCESS';
    var syncRow = { sync_id: syncId, batch_id: payload.batchId, source_id: source.id, actor_id: actor.id, status: status, accepted: payload.cases.length - counts.failed, rejected: counts.failed, observed_at: iso, created_at: iso, error_code: counts.failed ? 'VALIDATION_ERROR' : '' };
    var sourceRow = Object.assign({}, tables.SOURCES.find(function (row) { return row.source_id === source.id; }));
    sourceRow.last_synced_at = iso; sourceRow.last_observed_at = normalized.length ? normalized.reduce(function (latest, record) { return record.lastObservedAt > latest ? record.lastObservedAt : latest; }, sourceRow.last_observed_at || '') : sourceRow.last_observed_at || '';
    sourceRow.synced_count = Number(sourceRow.synced_count || 0) + normalized.length; sourceRow.error_count = Number(sourceRow.error_count || 0) + counts.failed; sourceRow.last_error = counts.failed ? 'VALIDATION_ERROR' : '';
    var auditRow = { audit_id: TTHC.Utils.id(), actor_id: actor.id, action: 'SYNC_SOURCE', target_id: syncId, source_id: source.id, details_encrypted: TTHC.Crypto.encrypt({ accepted: syncRow.accepted, rejected: syncRow.rejected, result: status, collectionContext: context }), crypto_version: TTHC.Crypto.cryptoVersion, created_at: iso };
    var auditRows = [auditRow];
    if (payload.replaceSource) auditRows.push({ audit_id: TTHC.Utils.id(), actor_id: actor.id, action: 'MOC_SNAPSHOT', target_id: syncId, source_id: source.id, details_encrypted: TTHC.Crypto.encrypt({ capturedAt: context.capturedAt, recordIds: normalized.map(function (record) { return record.id; }) }), crypto_version: TTHC.Crypto.cryptoVersion, created_at: iso });
    TTHC.Repo.commit([{ table: 'CASES', keyField: 'record_id', rows: caseRows }, { table: 'ALERTS', keyField: 'alert_id', rows: alertRows }, { table: 'SOURCES', keyField: 'source_id', rows: [sourceRow] }, { table: 'SYNC_LOGS', keyField: 'sync_id', rows: [syncRow] }, { table: 'AUDIT_LOGS', keyField: 'audit_id', rows: auditRows }], snapshot.revision);
    // Compute the initiating user's common view now; subsequent dashboard opens use the encrypted cache.
    try { TTHC.Dashboard.summary(actor, {}); } catch (error) { TTHC.Utils.log('WARN', 'DASHBOARD_CACHE_REFRESH_FAILED', { code: error.code || 'CACHE_ERROR' }); }
    return Object.assign({ id: syncId, total: payload.cases.length, errors: errors, status: status }, counts);
  }
  return { statuses: STATUSES, fields: FIELDS, normalize: normalize, configurations: configurations, aliases: aliases, parseIndex: parseIndex, rowAliases: rowAliases, index: index, rowFor: rowFor, view: view, pageOptions: pageOptions, dateFilter: dateFilter, evaluationFromIndex: evaluationFromIndex, filterRows: filterRows, list: list, detail: detail, sync: sync };
})();
