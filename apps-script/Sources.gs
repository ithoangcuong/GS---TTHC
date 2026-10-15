var TTHC = TTHC || {};
TTHC.Sources = (function () {
  'use strict';
  var DEFINITIONS = [
    ['TPHCM', 'TP. Hồ Chí Minh', 'motcua.tphcm.gov.vn'], ['MOF', 'Bộ Tài chính', 'motcua.mst.gov.vn'], ['MOHA', 'Bộ Nội vụ', 'motcua.moha.gov.vn'],
    ['MOC', 'Bộ Xây dựng', 'motcuabxd.moc.gov.vn'], ['MOIT', 'Bộ Công Thương', 'tthc.moit.gov.vn'], ['MAE', 'Bộ Nông nghiệp và Môi trường', 'dvcnnmt.mae.gov.vn'],
    ['MOH', 'Bộ Y tế', 'dvc.moh.gov.vn'], ['MOET', 'Bộ Giáo dục và Đào tạo', 'baocaodvc.moet.gov.vn'], ['MOJ', 'Bộ Tư pháp', 'motcua.moj.gov.vn'],
    ['BVHTTDL', 'Bộ Văn hóa, Thể thao và Du lịch', 'dichvucong.bvhttdl.gov.vn'], ['BDTTG', 'Bộ Dân tộc và Tôn giáo', 'gqtthc.bdttg.gov.vn']
  ];
  function definitions() { return DEFINITIONS.map(function (item) { return {
    id: item[0], name: item[1], hostname: item[2],
    url: 'https://' + item[2] + (item[0] === 'MOC' ? '/vi/dossier/search' : '/'),
    supportedHosts: item[0] === 'MOC' ? [item[2], 'motcua.moc.gov.vn'] : [item[2]], adapterStatus: 'WAITING_FOR_SAMPLE'
  }; }); }
  function all(rows) {
    rows = rows || TTHC.Repo.read('SOURCES');
    return definitions().map(function (source) {
      var row = rows.find(function (item) { return item.source_id === source.id; });
      source.enabled = !!row && (row.enabled === true || row.enabled === 'true' || row.enabled === 1 || row.enabled === '1');
      source.adapterVersion = row ? row.adapter_version : '0.1.0';
      source.lastObservedAt = row && row.last_observed_at || null; source.lastSyncedAt = row && row.last_synced_at || null;
      source.syncedCount = Number(row && row.synced_count || 0); source.errorCount = Number(row && row.error_count || 0);
      source.lastError = row && row.last_error || null;
      source.status = !source.enabled ? 'DISABLED' : source.lastError ? 'SYNC_ERROR' : source.lastSyncedAt ? 'SYNC_SUCCESS' : 'NOT_SYNCED';
      return source;
    });
  }
  function find(id, rows) { var source = all(rows).find(function (item) { return item.id === id; }); if (!source) TTHC.Utils.error('VALIDATION_ERROR', 'Nguồn chưa được đăng ký.'); return source; }
  function validateHost(source, hostname) {
    if (typeof hostname !== 'string' || source.supportedHosts.indexOf(hostname) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Hostname không khớp nguồn được phép.');
  }
  function list(user) { return { items: all().filter(function (source) { return TTHC.Permissions.sourceAllowed(user, source.id); }) }; }
  function update(user, payload) {
    TTHC.Permissions.requireCapability(user, 'manageSources');
    if (!payload || Object.keys(payload).some(function (key) { return ['id', 'enabled'].indexOf(key) < 0; }) || typeof payload.enabled !== 'boolean') TTHC.Utils.error('VALIDATION_ERROR', 'Cấu hình nguồn không hợp lệ.');
    var snapshot = TTHC.Repo.readSnapshot(['SOURCES', 'USERS']), source = find(payload.id, snapshot.tables.SOURCES), current = TTHC.Users.authorize(user.id, snapshot.tables.USERS);
    TTHC.Permissions.requireCapability(current, 'manageSources');
    if (!TTHC.Permissions.sourceAllowed(current, source.id)) TTHC.Utils.error('ACCESS_DENIED', 'Nguồn ngoài phạm vi.');
    if (current.role !== 'SUPER_ADMIN' && ['agencies', 'departments', 'officers'].some(function (dim) { return current.scope[dim].indexOf('*') < 0; })) TTHC.Utils.error('ACCESS_DENIED', 'Bật hoặc tắt một nguồn cần quyền toàn bộ đơn vị và cán bộ của nguồn đó.');
    var existing = snapshot.tables.SOURCES.find(function (row) { return row.source_id === source.id; });
    if (!existing) TTHC.Utils.error('CONFIGURATION_ERROR', 'Nguồn chưa được khởi tạo.');
    var row = Object.assign({}, existing, { enabled: payload.enabled });
    TTHC.Repo.commit([{ table: 'SOURCES', keyField: 'source_id', rows: [row] }], snapshot.revision);
    TTHC.Audit.record(user.id, 'UPDATE_SOURCE', source.id, { result: payload.enabled ? 'ENABLED' : 'DISABLED' }, source.id);
    return { source: find(source.id) };
  }
  function syncList(user, query) {
    query = query || {};
    if (Object.keys(query).some(function (key) { return ['sourceSystem', 'q', 'page', 'pageSize'].indexOf(key) < 0; })) TTHC.Utils.error('VALIDATION_ERROR', 'Bộ lọc đồng bộ không hợp lệ.');
    var page = TTHC.Cases.pageOptions(query || {});
    var rows = TTHC.Repo.read('SYNC_LOGS').filter(function (row) { return (!query.sourceSystem || row.source_id === query.sourceSystem) && (!query.q || [row.source_id, row.status, row.batch_id].join(' ').toLowerCase().indexOf(String(query.q).toLowerCase()) >= 0) && TTHC.Permissions.sourceAllowed(user, row.source_id) && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || user.role === 'LEADER' || row.actor_id === user.id); });
    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    var selected = rows.slice(page.offset, page.offset + page.pageSize), contexts = {}, ids = selected.map(function (row) { return row.sync_id; });
    var audits = ids.length ? TTHC.Repo.read('AUDIT_LOGS').filter(function (row) { return row.action === 'SYNC_SOURCE' && ids.indexOf(row.target_id) >= 0; }) : [];
    var details = audits.length ? TTHC.Crypto.decryptMany(audits.map(function (row) { return row.details_encrypted; })) : [];
    audits.forEach(function (row, i) { contexts[row.target_id] = details[i].collectionContext || null; });
    return { items: selected.map(function (row) { return { id: row.sync_id, batchId: row.batch_id, sourceSystem: row.source_id, status: row.status, accepted: Number(row.accepted), rejected: Number(row.rejected), observedAt: row.observed_at, createdAt: row.created_at, errorCode: row.error_code || null, collectionContext: contexts[row.sync_id] || null }; }), total: rows.length, page: page.page, pageSize: page.pageSize };
  }
  return { definitions: definitions, all: all, find: find, validateHost: validateHost, list: list, update: update, syncList: syncList };
})();
