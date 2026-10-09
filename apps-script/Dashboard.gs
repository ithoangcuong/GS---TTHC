var TTHC = TTHC || {};
TTHC.Dashboard = (function () {
  'use strict';
  function emptyKpis() { return { total: 0, totalProcessing: 0, warning: 0, overdue: 0, completed: 0, onTime: 0, completedLate: 0, onTimeRate: null, observed24h: 0, stale: 0, observed24hRate: null, unknown: 0, waitingAdditional: 0, safe: 0, needsReview: 0 }; }
  function add(kpis, row, settings, now) {
    var terminal = TTHC.Deadline.terminal.indexOf(row.status_index) >= 0, evaluation = TTHC.Cases.evaluationFromIndex(row, settings, now);
    kpis.total++;
    if (!terminal) {
      kpis.totalProcessing++;
      if (evaluation.alertLevel === 'WARNING') kpis.warning++;
      if (evaluation.alertLevel === 'OVERDUE') kpis.overdue++;
      if (evaluation.alertLevel === 'SAFE') kpis.safe++;
      if (evaluation.alertLevel === 'NEEDS_REVIEW') kpis.needsReview++;
      if (row.last_observed_at && now - Date.parse(row.last_observed_at) <= 86400000) kpis.observed24h++;
      if (!row.last_observed_at || now - Date.parse(row.last_observed_at) > settings.staleSeconds * 1000) kpis.stale++;
    }
    if (row.status_index === 'COMPLETED') kpis.completed++;
    if (row.completion_index === 'ON_TIME') kpis.onTime++;
    if (row.completion_index === 'LATE') kpis.completedLate++;
    if (row.status_index === 'UNKNOWN') kpis.unknown++;
    if (row.status_index === 'WAITING_ADDITIONAL_DOCUMENTS') kpis.waitingAdditional++;
  }
  function finish(kpis) {
    var classified = kpis.onTime + kpis.completedLate;
    kpis.onTimeRate = classified ? Math.round(10000 * kpis.onTime / classified) / 100 : null;
    kpis.observed24hRate = kpis.totalProcessing ? Math.round(10000 * kpis.observed24h / kpis.totalProcessing) / 100 : null;
    return kpis;
  }
  function build(actor, query, rows, sources, settings, now) {
    var filtered = TTHC.Cases.filterRows(rows, actor, query, settings, now), kpis = emptyKpis(), groups = { source: {}, agency: {}, department: {}, officer: {}, procedure: {} }, statuses = {}, expiresAt = now + 60000;
    filtered.forEach(function (row) {
      add(kpis, row, settings, now);
      var evaluation = TTHC.Cases.evaluationFromIndex(row, settings, now), status = evaluation.normalizedStatus;
      statuses[status] = (statuses[status] || 0) + 1;
      var ix = TTHC.Cases.parseIndex(row), keys = Object.assign({ source: row.source_id }, ix.groups);
      Object.keys(groups).forEach(function (dimension) {
        var key = keys[dimension] || 'UNASSIGNED', bucket = groups[dimension][key];
        if (!bucket) { bucket = { key: key, kpis: emptyKpis(), representative: row }; groups[dimension][key] = bucket; }
        add(bucket.kpis, row, settings, now);
      });
      expiresAt = Math.min(expiresAt, TTHC.Deadline.nextBoundary({ normalizedStatus: row.status_index, originalDueAt: row.due_at, lastObservedAt: row.last_observed_at }, settings, now));
      if (row.last_observed_at) { var freshness = Date.parse(row.last_observed_at) + 86400000 + 1; if (freshness > now) expiresAt = Math.min(expiresAt, freshness); }
    });
    var representatives = [], refs = {}, selected = {};
    Object.keys(groups).forEach(function (dimension) {
      selected[dimension] = Object.keys(groups[dimension]).map(function (key) { return groups[dimension][key]; }).sort(function (a, b) { return b.kpis.total - a.kpis.total; }).slice(0, dimension === 'source' ? 11 : 10);
      if (dimension !== 'source') selected[dimension].forEach(function (bucket) { if (bucket.key !== 'UNASSIGNED' && !Object.prototype.hasOwnProperty.call(refs, bucket.representative.record_id)) { refs[bucket.representative.record_id] = representatives.length; representatives.push(bucket.representative.payload_encrypted); } });
    });
    var payloads = representatives.length ? TTHC.Crypto.decryptMany(representatives) : [], registry = TTHC.Sources.definitions();
    function viewGroups(dimension) {
      return selected[dimension].map(function (bucket) {
        var label = 'Chưa xác định';
        if (dimension === 'source') { var source = registry.find(function (item) { return item.id === bucket.key; }); label = source ? source.name : bucket.key; }
        else if (bucket.key !== 'UNASSIGNED') { var data = payloads[refs[bucket.representative.record_id]]; label = data[dimension + 'Name'] || data[dimension + (dimension === 'procedure' ? 'Code' : 'Id')] || 'Chưa xác định'; }
        label = String(label).slice(0, 200);
        return Object.assign({ key: bucket.key, label: label, name: label }, finish(bucket.kpis));
      });
    }
    var result = { kpis: finish(kpis), bySource: viewGroups('source'), byAgency: viewGroups('agency'), byDepartment: viewGroups('department'), byOfficer: viewGroups('officer'), byProcedure: viewGroups('procedure'), statusDistribution: Object.keys(statuses).map(function (status) { return { status: status, count: statuses[status] }; }), sourceHealth: TTHC.Sources.all(sources).filter(function (source) { return TTHC.Permissions.sourceAllowed(actor, source.id) && (!query.sourceSystem || source.id === query.sourceSystem); }), generatedAt: new Date(now).toISOString(), cacheUntil: new Date(expiresAt).toISOString(), groupLimit: 10 };
    // The full KPI remains exact. Limit displayed groups to fit an encrypted payload and a Sheets cell,
    // including labels whose UTF-8 byte count is greater than their character count.
    var displays = ['byAgency', 'byDepartment', 'byOfficer', 'byProcedure'];
    while (Utilities.newBlob(JSON.stringify(result)).getBytes().length > 28000) {
      var largest = displays.slice().sort(function (a, b) { return result[b].length - result[a].length; })[0];
      if (!result[largest].length) break;
      result[largest].pop(); result.groupsTruncated = true;
    }
    return result;
  }
  function cacheKey(actor, query) {
    var canonical = {}; Object.keys(query).sort().forEach(function (key) { canonical[key] = query[key]; });
    return TTHC.Crypto.hashLookupKey('dashboard:' + JSON.stringify([actor.role, actor.scope, canonical]));
  }
  function summary(actor, query) {
    query = query || {};
    var allowed = ['q', 'sourceSystem', 'agencyName', 'departmentName', 'officerName', 'procedureName', 'agencyKey', 'departmentKey', 'officerKey', 'procedureKey', 'receivedFrom', 'receivedTo', 'dueFrom', 'dueTo'];
    if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(function (field) { return allowed.indexOf(field) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Bộ lọc dashboard không hợp lệ.');
    var authorization = TTHC.Repo.readSnapshot(['USERS']);
    actor = TTHC.Users.authorize(actor.id, authorization.tables.USERS);
    var key = cacheKey(actor, query), revision = authorization.revision, now = Date.now(), memory = CacheService.getScriptCache(), item = null;
    try { item = JSON.parse(memory.get('dashboard:' + key) || 'null'); } catch (ignored) {}
    if (!item || Number(item.revision) !== Number(revision) || Date.parse(item.expires_at) <= now) item = TTHC.Repo.read('DASHBOARD_CACHE').find(function (row) { return row.cache_key === key && Number(row.revision) === Number(revision) && Date.parse(row.expires_at) > now; });
    if (item && Number(item.revision) === Number(revision) && Date.parse(item.expires_at) > now) return TTHC.Crypto.decrypt(item.payload_encrypted);
    var snapshot = TTHC.Repo.readSnapshot(['CASES', 'SOURCES', 'USERS']), current = TTHC.Users.authorize(actor.id, snapshot.tables.USERS), settings = TTHC.Settings.get();
    // Read metadata indexes once. Only representatives for the largest groups need decryption.
    var result = build(current, query, snapshot.tables.CASES, snapshot.tables.SOURCES, settings, now);
    var row = { cache_key: cacheKey(current, query), payload_encrypted: TTHC.Crypto.encrypt(result), crypto_version: TTHC.Crypto.cryptoVersion, expires_at: result.cacheUntil, updated_at: result.generatedAt, revision: snapshot.revision };
    TTHC.Repo.commit([{ table: 'DASHBOARD_CACHE', keyField: 'cache_key', rows: [row] }], snapshot.revision);
    var ttl = Math.max(1, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000));
    memory.put('dashboard:' + row.cache_key, JSON.stringify(row), Math.min(60, ttl));
    return result;
  }
  function officers(actor, query) {
    query = query || {}; var page = TTHC.Cases.pageOptions(query), settings = TTHC.Settings.get(), now = Date.now(), rows = TTHC.Cases.filterRows(TTHC.Repo.read('CASES'), actor, query, settings, now), groups = {};
    rows.forEach(function (row) { var key = TTHC.Cases.parseIndex(row).groups.officer; if (!key) return; if (!groups[key]) groups[key] = { key: key, row: row, kpis: emptyKpis() }; add(groups[key].kpis, row, settings, now); });
    var items = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) { return b.kpis.overdue - a.kpis.overdue || b.kpis.totalProcessing - a.kpis.totalProcessing; }), selected = items.slice(page.offset, page.offset + page.pageSize), data = selected.length ? TTHC.Crypto.decryptMany(selected.map(function (item) { return item.row.payload_encrypted; })) : [];
    return { items: selected.map(function (item, i) { var label = data[i].officerName || data[i].officerId; return Object.assign({ key: item.key, label: label, name: label, sourceSystem: item.row.source_id, agencyName: data[i].agencyName || '', departmentName: data[i].departmentName || '' }, finish(item.kpis)); }), total: items.length, page: page.page, pageSize: page.pageSize };
  }
  return { summary: summary, build: build, emptyKpis: emptyKpis, add: add, finish: finish, officers: officers };
})();
