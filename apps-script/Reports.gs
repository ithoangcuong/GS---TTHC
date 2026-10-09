var TTHC = TTHC || {};
TTHC.Reports = (function () {
  'use strict';
  function period(query) {
    query = Object.assign({}, query || {});
    var kind = query.period || 'month';
    if (['day', 'week', 'month', 'custom'].indexOf(kind) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Kỳ báo cáo không hợp lệ.');
    delete query.period; delete query.type;
    if (!query.receivedFrom && !query.receivedTo && kind !== 'custom') {
      var today = new Date(Date.now() + 7 * 3600000), start = new Date(today.getTime());
      if (kind === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      if (kind === 'month') start.setUTCDate(1);
      query.receivedFrom = start.toISOString().slice(0, 10); query.receivedTo = today.toISOString().slice(0, 10);
    }
    return { query: query, period: kind };
  }
  function summary(actor, query) {
    var options = period(query), data = TTHC.Dashboard.summary(actor, options.query);
    TTHC.Audit.record(actor.id, 'VIEW_REPORT', '', { result: 'SUCCESS' }, options.query.sourceSystem || '');
    return Object.assign({}, data, { period: { kind: options.period, receivedFrom: options.query.receivedFrom || null, receivedTo: options.query.receivedTo || null } });
  }
  function csvCell(value) {
    var text = value === null || value === undefined ? '' : String(value);
    // CSV formula injection protection also covers leading control/whitespace characters.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportReport(actor, query) {
    TTHC.Permissions.requireCapability(actor, 'export');
    var type = query && query.type || 'report';
    if (['report', 'cases'].indexOf(type) < 0) TTHC.Utils.error('VALIDATION_ERROR', 'Loại xuất không hợp lệ.');
    var lines = [], exported = 0;
    if (type === 'cases') {
      var options = period(query), rows = TTHC.Cases.filterRows(TTHC.Repo.read('CASES'), actor, options.query), fields = ['sourceSystem', 'caseCode', 'procedureCode', 'procedureName', 'receivedAt', 'effectiveDueAt', 'normalizedStatus', 'alertLevel', 'agencyName', 'departmentName', 'officerName', 'lastObservedAt', 'completionResult'];
      if (rows.length > 2000) TTHC.Utils.error('EXPORT_LIMIT', 'Mỗi lần xuất tối đa 2.000 hồ sơ. Hãy thu hẹp khoảng ngày hoặc nguồn.');
      lines.push(fields.map(csvCell).join(','));
      var values = rows.length ? TTHC.Crypto.decryptMany(rows.map(function (row) { return row.payload_encrypted; })) : [], settings = TTHC.Settings.get(), now = Date.now();
      rows.forEach(function (row, i) { var item = TTHC.Cases.view(row, values[i], settings, now); lines.push(fields.map(function (field) { return csvCell(item[field]); }).join(',')); });
      exported = rows.length;
    } else {
      var data = summary(actor, query), columns = ['Nhóm', 'Tên', 'Tổng hồ sơ', 'Đang xử lý', 'Sắp đến hạn', 'Quá hạn', 'Hoàn thành đúng hạn', 'Hoàn thành trễ', 'Quan sát trong 24h', 'Dữ liệu cũ'];
      lines.push(columns.map(csvCell).join(','));
      [['Toàn phạm vi', [{ label: 'Tổng cộng', kpis: data.kpis }]], ['Nguồn', data.bySource], ['Đơn vị', data.byAgency], ['Phòng', data.byDepartment], ['Cán bộ', data.byOfficer], ['Thủ tục', data.byProcedure]].forEach(function (group) { group[1].forEach(function (entry) { var k = entry.kpis || entry; lines.push([group[0], entry.label, k.total, k.totalProcessing, k.warning, k.overdue, k.onTime, k.completedLate, k.observed24h, k.stale].map(csvCell).join(',')); exported++; }); });
    }
    TTHC.Audit.record(actor.id, 'EXPORT_REPORT', '', { count: exported, result: 'SUCCESS' }, query && query.sourceSystem || '');
    return { filename: 'tthc-' + type + '-' + new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10) + '.csv', mimeType: 'text/csv;charset=utf-8', content: '\ufeff' + lines.join('\r\n'), count: exported };
  }
  return { summary: summary, export: exportReport, csvCell: csvCell, period: period };
})();
