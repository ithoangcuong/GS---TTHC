var TTHC = TTHC || {};
TTHC.Repo = (function () {
  var schemas = {
    USERS: ['user_id','email_hash','email_encrypted','display_name_encrypted','role','scope','status','created_at','updated_at','created_by','last_login_at','username_hash','username_encrypted','password_hash','must_change_password','credential_version','password_changed_at'],
    CASES: ['record_id','case_key_hash','case_alias_hashes','source_id','payload_encrypted','crypto_version','alert_index','scope_index','updated_at','last_synced_at','last_observed_at','due_at','received_at','status_index','completion_index'],
    ALERTS: ['alert_id','record_id','source_id','alert_type','status','scope_index','payload_encrypted','crypto_version','created_at','updated_at','acknowledged_by'],
    SOURCES: ['source_id','name','hostname','adapter_version','adapter_status','enabled','last_observed_at','last_synced_at','synced_count','error_count','last_error'],
    SOURCE_MAPPING: ['mapping_id','source_id','payload_encrypted','crypto_version','updated_at'],
    STATUS_MAPPING: ['mapping_id','source_id','source_status','normalized_status','confirmed','updated_at'],
    SETTINGS: ['key','value','updated_at'],
    SYNC_LOGS: ['sync_id','batch_id','source_id','actor_id','status','accepted','rejected','observed_at','created_at','error_code'],
    AUDIT_LOGS: ['audit_id','actor_id','action','target_id','source_id','details_encrypted','crypto_version','created_at'],
    DASHBOARD_CACHE: ['cache_key','payload_encrypted','crypto_version','expires_at','updated_at','revision'],
    COLLECTOR_TOKENS: ['token_id','token_hash','user_id','source_id','hostname','status','expires_at','created_at','revoked_at']
  };
  var legacySchemas = { USERS: schemas.USERS.slice(0, 11) };
  var nonBusiness = ['AUDIT_LOGS','SYNC_LOGS','DASHBOARD_CACHE'];
  function workbook() {
    var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!spreadsheetId || !/^[a-zA-Z0-9_-]{10,200}$/.test(spreadsheetId)) TTHC.Utils.error('SHEET_NOT_CONFIGURED', 'Chưa cấu hình SPREADSHEET_ID.');
    return SpreadsheetApp.openById(spreadsheetId);
  }
  function sheet(table) {
    if (!Object.prototype.hasOwnProperty.call(schemas, table)) TTHC.Utils.error('INVALID_TABLE', 'Bảng dữ liệu không hợp lệ.');
    var item = workbook().getSheetByName(table);
    if (!item) TTHC.Utils.error('SHEET_MISSING', 'Thiếu sheet ' + table + '; chạy setupSpreadsheet_ trong Apps Script Editor.');
    var header = item.getRange(1, 1, 1, Math.max(item.getLastColumn(), schemas[table].length)).getValues()[0];
    if (JSON.stringify(header) !== JSON.stringify(schemas[table])) TTHC.Utils.error('SHEET_SCHEMA_CONFLICT', 'Sheet ' + table + ' khác schema; hệ thống dừng để giữ dữ liệu.');
    return item;
  }
  function revision() { return Number(PropertiesService.getScriptProperties().getProperty('DATA_REVISION') || 0); }
  function assertReadable() {
    var properties = PropertiesService.getScriptProperties();
    if (properties.getProperty('REPOSITORY_PENDING') || properties.getProperty('REPOSITORY_BLOCKED')) TTHC.Utils.error('REPOSITORY_BLOCKED', 'Kho dữ liệu đang ghi hoặc cần kiểm tra phục hồi. Vui lòng thử lại.');
  }
  function read(table) {
    assertReadable();
    var item = sheet(table), count = item.getLastRow() - 1;
    if (count <= 0) return [];
    var result = item.getRange(2, 1, count, schemas[table].length).getValues().map(function (row) {
      var object = {};
      schemas[table].forEach(function (name, i) { object[name] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
      return object;
    }).filter(function (row) { return row[schemas[table][0]] !== ''; });
    assertReadable();
    return result;
  }
  function readSnapshot(tables) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var before = revision(), data = {};
      tables.forEach(function (table) { data[table] = read(table); });
      assertReadable();
      if (before === revision()) return { revision: before, tables: data };
    }
    TTHC.Utils.error('CONFLICT', 'Dữ liệu đang được cập nhật. Vui lòng thử lại.');
  }
  function withLock(callback) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) TTHC.Utils.error('BUSY', 'Hệ thống đang ghi dữ liệu. Vui lòng thử lại.');
    try { return callback(); } finally { lock.releaseLock(); }
  }
  function values(table, row) {
    if (!row || typeof row !== 'object' || Object.keys(row).some(function (name) { return schemas[table].indexOf(name) === -1; })) TTHC.Utils.error('INVALID_ROW', 'Dòng dữ liệu không khớp schema ' + table + '.');
    return schemas[table].map(function (name) {
      var value = row[name] === undefined || row[name] === null ? '' : row[name];
      if (!['string','number','boolean'].includes(typeof value) || (typeof value === 'string' && value.length > 48000) || (typeof value === 'number' && !Number.isFinite(value))) TTHC.Utils.error('INVALID_ROW', 'Ô dữ liệu không hợp lệ.');
      // setValues interprets strings beginning '=' as formulas. No repository payload may run one.
      if (typeof value === 'string' && value.charAt(0) === '=') TTHC.Utils.error('INVALID_ROW', 'Không cho phép công thức trong dữ liệu hệ thống.');
      return value;
    });
  }
  function commit(changes, expectedRevision) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 11) TTHC.Utils.error('INVALID_COMMIT', 'Batch ghi không hợp lệ.');
    var seen = {};
    changes.forEach(function (change) {
      if (!Object.prototype.hasOwnProperty.call(schemas, change.table) || seen[change.table] || schemas[change.table].indexOf(change.keyField) === -1 || !Array.isArray(change.rows) || change.rows.length > 20000) TTHC.Utils.error('INVALID_COMMIT', 'Batch ghi không hợp lệ.');
      seen[change.table] = true;
      change.rows.forEach(function (row) { values(change.table, row); if (!row[change.keyField]) TTHC.Utils.error('INVALID_ROW', 'Dòng dữ liệu thiếu khóa.'); });
    });
    return withLock(function () {
      var properties = PropertiesService.getScriptProperties();
      assertReadable();
      var currentRevision = revision();
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) TTHC.Utils.error('CONFLICT', 'Dữ liệu đã thay đổi. Vui lòng thử lại batch.');
      var plans = changes.map(function (change) {
        var item = sheet(change.table), old = read(change.table), index = {};
        old.forEach(function (row, i) {
          var key = String(row[change.keyField]);
          if (Object.prototype.hasOwnProperty.call(index, key)) TTHC.Utils.error('SHEET_DUPLICATE_KEY', 'Sheet có khóa trùng; cần kiểm tra trước khi ghi.');
          index[key] = i;
        });
        var next = old.slice(), changed = {};
        change.rows.forEach(function (row) {
          var key = String(row[change.keyField]);
          if (Object.prototype.hasOwnProperty.call(index, key)) next[index[key]] = row;
          else { index[key] = next.length; next.push(row); }
          changed[index[key]] = true;
        });
        var nextValues = next.map(function (row) { return values(change.table, row); });
        var indices = Object.keys(changed).map(Number).sort(function (a, b) { return a - b; }), operations = [];
        indices.forEach(function (index) {
          var previous = operations[operations.length - 1];
          if (previous && previous.start + previous.rows.length === index) previous.rows.push(nextValues[index]);
          else operations.push({ start: index, rows: [nextValues[index]] });
        });
        return { table: change.table, item: item, old: old.map(function (row) { return values(change.table, row); }), next: nextValues, operations: operations };
      });
      var applied = [];
      // A killed invocation leaves this marker. Readers fail closed until the owner verifies recovery.
      properties.setProperty('REPOSITORY_PENDING', JSON.stringify({ id: TTHC.Utils.id(), tables: changes.map(function (change) { return change.table; }), startedAt: TTHC.Utils.now() }));
      try {
        plans.forEach(function (plan) {
          applied.push(plan);
          var required = plan.next.length + 1;
          if (plan.item.getMaxRows() < required) plan.item.insertRowsAfter(plan.item.getMaxRows(), required - plan.item.getMaxRows());
          plan.operations.forEach(function (operation) { plan.item.getRange(2 + operation.start, 1, operation.rows.length, schemas[plan.table].length).setValues(operation.rows); });
        });
        SpreadsheetApp.flush();
        if (changes.some(function (change) { return nonBusiness.indexOf(change.table) === -1 && change.rows.length; })) {
          currentRevision++;
          properties.setProperty('DATA_REVISION', String(currentRevision));
        }
        properties.deleteProperty('REPOSITORY_PENDING');
        return { revision: currentRevision };
      } catch (_) {
        try {
          applied.reverse().forEach(function (plan) {
            if (plan.old.length) plan.item.getRange(2, 1, plan.old.length, schemas[plan.table].length).setValues(plan.old);
            if (plan.next.length > plan.old.length) plan.item.getRange(2 + plan.old.length, 1, plan.next.length - plan.old.length, schemas[plan.table].length).clearContent();
          });
          SpreadsheetApp.flush();
          properties.deleteProperty('REPOSITORY_PENDING');
        } catch (rollbackError) {
          properties.setProperty('REPOSITORY_BLOCKED', TTHC.Utils.now());
          TTHC.Utils.log('ERROR', 'REPOSITORY_ROLLBACK_FAILED', { code: 'REPOSITORY_BLOCKED' });
        }
        TTHC.Utils.error('SHEET_WRITE_FAILED', 'Chưa xác nhận ghi Google Sheet; kiểm tra kho dữ liệu rồi thử lại cùng batch.');
      }
    });
  }
  function writeBatch(table, rows, keyField, options) { return commit([{ table: table, rows: rows, keyField: keyField }], options && options.expectedRevision); }
  return { schemas: schemas, legacySchemas: legacySchemas, workbook: workbook, read: read, readSnapshot: readSnapshot, revision: revision, withLock: withLock, commit: commit, writeBatch: writeBatch };
})();
