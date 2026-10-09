// Editor-only functions end in '_' so google.script.run cannot invoke them.
function requireSetupOwner_() {
  var email = TTHC.Utils.normalizeEmail(PropertiesService.getScriptProperties().getProperty('BOOTSTRAP_EMAIL') || '');
  var active = Session.getActiveUser().getEmail(), effective = Session.getEffectiveUser().getEmail();
  if (!active || TTHC.Utils.normalizeEmail(active) !== email || TTHC.Utils.normalizeEmail(effective) !== email) TTHC.Utils.error('SETUP_DENIED', 'Chỉ chủ dự án đã khai báo BOOTSTRAP_EMAIL được chạy setup trong Editor.');
  return email;
}

function setupSpreadsheet_() {
  requireSetupOwner_();
  var workbook = TTHC.Repo.workbook(), schemas = TTHC.Repo.schemas, migrations = [];
  return TTHC.Repo.withLock(function () {
    // Preflight every existing tab before creating anything. Never overwrite conflicting data.
    Object.keys(schemas).forEach(function (table) {
      var item = workbook.getSheetByName(table);
      if (item && item.getLastRow() > 0) {
        var header = item.getRange(1, 1, 1, Math.max(item.getLastColumn(), schemas[table].length)).getValues()[0];
        if (JSON.stringify(header) !== JSON.stringify(schemas[table])) {
          var legacy = TTHC.Repo.legacySchemas[table];
          if (!legacy || item.getLastColumn() !== legacy.length || JSON.stringify(header.slice(0, legacy.length)) !== JSON.stringify(legacy) || header.slice(legacy.length).some(function (value) { return value !== ''; })) TTHC.Utils.error('SHEET_SCHEMA_CONFLICT', 'Giữ nguyên sheet ' + table + ': tiêu đề khác schema.');
          migrations.push(table);
        }
      }
    });
    Object.keys(schemas).forEach(function (table) {
      var item = workbook.getSheetByName(table) || workbook.insertSheet(table);
      if (!item.getLastRow()) {
        if (item.getMaxColumns() < schemas[table].length) item.insertColumnsAfter(item.getMaxColumns(), schemas[table].length - item.getMaxColumns());
        item.getRange(1, 1, 1, schemas[table].length).setValues([schemas[table]]);
        item.setFrozenRows(1);
      } else if (migrations.indexOf(table) >= 0) {
        var oldLength = TTHC.Repo.legacySchemas[table].length;
        if (item.getMaxColumns() < schemas[table].length) item.insertColumnsAfter(item.getMaxColumns(), schemas[table].length - item.getMaxColumns());
        item.getRange(1, oldLength + 1, 1, schemas[table].length - oldLength).setValues([schemas[table].slice(oldLength)]);
      }
    });
    SpreadsheetApp.flush();
    if (migrations.length) PropertiesService.getScriptProperties().setProperty('DATA_REVISION', String(TTHC.Repo.revision() + 1));
    return { tables: Object.keys(schemas), existingDataPreserved: true, migratedTables: migrations };
  });
}

function initializeSettingsAndSources_() {
  requireSetupOwner_();
  var existingSettings = TTHC.Repo.read('SETTINGS'), existingSources = TTHC.Repo.read('SOURCES'), at = TTHC.Utils.now();
  var settings = Object.keys(TTHC.Settings.defaults).filter(function (key) { return !existingSettings.some(function (r) { return r.key === key; }); }).map(function (key) { return { key: key, value: JSON.stringify(TTHC.Settings.defaults[key]), updated_at: at }; });
  var definitions = [
    ['TPHCM','TP.HCM','motcua.tphcm.gov.vn'], ['MOF','Bộ Tài chính','motcua.mst.gov.vn'],
    ['MOHA','Bộ Nội vụ','motcua.moha.gov.vn'], ['MOC','Bộ Xây dựng','motcuabxd.moc.gov.vn'],
    ['MOIT','Bộ Công Thương','tthc.moit.gov.vn'], ['MAE','Bộ Nông nghiệp và Môi trường','dvcnnmt.mae.gov.vn'],
    ['MOH','Bộ Y tế','dvc.moh.gov.vn'], ['MOET','Bộ Giáo dục và Đào tạo','baocaodvc.moet.gov.vn'],
    ['MOJ','Bộ Tư pháp','motcua.moj.gov.vn'], ['BVHTTDL','Bộ Văn hóa, Thể thao và Du lịch','dichvucong.bvhttdl.gov.vn'],
    ['BDTTG','Bộ Dân tộc và Tôn giáo','gqtthc.bdttg.gov.vn']
  ];
  var sources = definitions.filter(function (s) { return !existingSources.some(function (r) { return r.source_id === s[0]; }); }).map(function (s) {
    return { source_id: s[0], name: s[1], hostname: s[2], adapter_version: '1.0.0', adapter_status: 'WAITING_FOR_SAMPLE', enabled: true, last_observed_at: '', last_synced_at: '', synced_count: 0, error_count: 0, last_error: '' };
  });
  var changes = [];
  if (settings.length) changes.push({ table: 'SETTINGS', rows: settings, keyField: 'key' });
  if (sources.length) changes.push({ table: 'SOURCES', rows: sources, keyField: 'source_id' });
  if (changes.length) TTHC.Repo.commit(changes);
  return { addedSettings: settings.length, addedSources: sources.length };
}

function bootstrapAdmin_() {
  var email = requireSetupOwner_(), props = PropertiesService.getScriptProperties();
  var username = TTHC.Users.normalizeUsername(props.getProperty('BOOTSTRAP_USERNAME') || 'admin'), snapshot = TTHC.Repo.readSnapshot(['USERS']);
  var admins = snapshot.tables.USERS.filter(function (row) { return row.role === 'SUPER_ADMIN'; });
  if (admins.some(function (row) { return row.username_hash || row.password_hash || row.credential_version; })) TTHC.Utils.error('BOOTSTRAP_CLOSED', 'Đã có tài khoản quản trị được cấp; không thay mật khẩu khi chạy lại bootstrap.');
  if (TTHC.Users.byUsername(username, snapshot.tables.USERS)) TTHC.Utils.error('BOOTSTRAP_CONFLICT', 'Tên tài khoản bootstrap đã được sử dụng.');
  var existing = admins.find(function (row) { return row.email_encrypted && TTHC.Crypto.decrypt(row.email_encrypted) === email; });
  if (admins.length && (!existing || existing.status !== 'ACTIVE')) TTHC.Utils.error('BOOTSTRAP_CONFLICT', 'Giữ nguyên quản trị hiện có; BOOTSTRAP_EMAIL cần khớp quản trị SUPER_ADMIN đang hoạt động.');
  var password = props.getProperty('BOOTSTRAP_PASSWORD') || TTHC.Passwords.defaultPassword(), at = TTHC.Utils.now();
  TTHC.Passwords.validate(password);
  var row = Object.assign({}, existing || { user_id: TTHC.Utils.id(), email_hash: '', email_encrypted: '', display_name_encrypted: TTHC.Crypto.encrypt('Quản trị hệ thống'), role: 'SUPER_ADMIN', scope: JSON.stringify({ sources: ['*'], agencies: ['*'], departments: ['*'], officers: ['*'] }), status: 'ACTIVE', created_at: at, created_by: 'EDITOR_BOOTSTRAP', last_login_at: '' }, TTHC.Users.credentials(username, password, at), { updated_at: at });
  TTHC.Repo.writeBatch('USERS', [row], 'user_id', { expectedRevision: snapshot.revision });
  TTHC.Audit.record(row.user_id, existing ? 'PROVISION_LOGIN' : 'ADD_USER', row.user_id, { role: 'SUPER_ADMIN', result: 'EDITOR_BOOTSTRAP' });
  return { userId: row.user_id, username: username, status: row.status, role: row.role, mustChangePassword: true, existingAdminPreserved: !!existing };
}

function setupTthcMonitor_() {
  setupSpreadsheet_();
  return initializeSettingsAndSources_();
}

function backupSpreadsheet_() {
  requireSetupOwner_();
  var backup = TTHC.Repo.workbook().copy('TTHC-backup-' + TTHC.Utils.now());
  return { spreadsheetId: backup.getId(), url: backup.getUrl(), encryptedPayloadsPreserved: true };
}

function verifyCrypto_() {
  requireSetupOwner_();
  var probe = { marker: 'TTHC_MONITOR_CONFIGURATION_CHECK', checkedAt: TTHC.Utils.now() };
  var restored = TTHC.Crypto.decrypt(TTHC.Crypto.encrypt(probe));
  if (!restored || restored.marker !== probe.marker || restored.checkedAt !== probe.checkedAt) TTHC.Utils.error('CRYPTO_VERIFICATION_FAILED', 'Chưa vượt qua kiểm tra mã hóa/giải mã.');
  TTHC.Utils.log('INFO', 'CRYPTO_VERIFIED');
  return { ok: true, cryptoVersion: TTHC.Crypto.cryptoVersion, checkedAt: probe.checkedAt, sheetDataWritten: false };
}

// Compatibility for earlier setup instructions; this checks the local free provider.
function verifyKms_() { return verifyCrypto_(); }

// Read-only Editor check; never resets credentials or attempts an external login.
function verifyAdminLogin_() {
  try {
    requireSetupOwner_();
    var username = TTHC.Users.normalizeUsername(PropertiesService.getScriptProperties().getProperty('BOOTSTRAP_USERNAME') || 'admin'), configuration = TTHC.Auth.config();
    if (!configuration.configured) TTHC.Utils.error('CONFIGURATION_ERROR', 'Chưa hoàn tất cấu hình đăng nhập: ' + configuration.setupIssues.map(function (issue) { return issue.property; }).join(', ') + '. Kiểm tra Script Properties; giữ nguyên khóa và pepper của dữ liệu hiện có.');
    var cryptoCheck = verifyCrypto_(), workbook = TTHC.Repo.workbook(), schemas = TTHC.Repo.schemas;
    Object.keys(schemas).forEach(function (table) {
      var item = workbook.getSheetByName(table);
      if (!item) TTHC.Utils.error('SHEET_MISSING', 'Thiếu sheet ' + table + '; kiểm tra workbook và chạy setupTthcMonitor_ trong Editor.');
      var header = item.getRange(1, 1, 1, Math.max(item.getLastColumn(), schemas[table].length)).getValues()[0];
      if (JSON.stringify(header) !== JSON.stringify(schemas[table])) TTHC.Utils.error('SHEET_SCHEMA_CONFLICT', 'Sheet ' + table + ' khác schema; giữ nguyên dữ liệu và kiểm tra workbook.');
    });
    var snapshot = TTHC.Repo.readSnapshot(['USERS']), row = TTHC.Users.byUsername(username, snapshot.tables.USERS);
    if (!row) TTHC.Utils.error('ADMIN_NOT_READY', 'Chưa cấp tài khoản quản trị. Chạy bootstrapAdmin_ trong Apps Script Editor sau khi cấu hình mật khẩu.');
    if (row.role !== 'SUPER_ADMIN' || row.status !== 'ACTIVE' || !row.credential_version || !TTHC.Passwords.configuredHash(row.password_hash)) TTHC.Utils.error('ADMIN_NOT_READY', 'Tài khoản quản trị cần có mật khẩu, vai trò SUPER_ADMIN và trạng thái ACTIVE.');
    TTHC.Users.validateRow(row);
    var identity = TTHC.Crypto.decryptMany([row.username_encrypted, row.display_name_encrypted]);
    if (identity[0] !== username || typeof identity[1] !== 'string' || !identity[1].trim()) TTHC.Utils.error('ADMIN_IDENTITY_MISMATCH', 'Tên tài khoản và danh tính admin đã mã hóa không khớp. Kiểm tra đúng khóa, pepper và dữ liệu hiện có.');
    var summary = { ok: true, configured: true, cryptoVersion: cryptoCheck.cryptoVersion, username: username, adminRole: row.role, adminStatus: row.status, existingAdminVerified: true, passwordLoginReady: true, tablesValidated: Object.keys(schemas).length, sheetDataWritten: false, checkedAt: TTHC.Utils.now() };
    TTHC.Utils.log('INFO', 'ADMIN_LOGIN_SETUP_VERIFIED');
    return summary;
  } catch (error) {
    var safeCode = typeof error.code === 'string' && /^[A-Z_]{2,60}$/.test(error.code) ? error.code : 'SETUP_VERIFICATION_FAILED';
    TTHC.Utils.log('ERROR', 'ADMIN_LOGIN_SETUP_FAILED', { code: safeCode });
    if (safeCode === 'SETUP_VERIFICATION_FAILED') TTHC.Utils.error(safeCode, 'Không thể kiểm tra cấu hình đăng nhập. Kiểm tra quyền truy cập workbook và quyền chạy Apps Script trong Editor.');
    throw error;
  }
}

function configureStatusMapping_() {
  requireSetupOwner_();
  var text = PropertiesService.getScriptProperties().getProperty('VERIFIED_STATUS_MAPPING_JSON'), configuration;
  try { configuration = JSON.parse(text || 'null'); } catch (_) { TTHC.Utils.error('INVALID_MAPPING', 'VERIFIED_STATUS_MAPPING_JSON không phải JSON hợp lệ.'); }
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) || Object.keys(configuration).some(function (key) { return ['sourceSystem','evidence','statusMappings'].indexOf(key) < 0; }) || typeof configuration.evidence !== 'string' || !configuration.evidence.trim() || configuration.evidence.length > 1000 || !configuration.statusMappings || typeof configuration.statusMappings !== 'object' || Array.isArray(configuration.statusMappings)) TTHC.Utils.error('INVALID_MAPPING', 'Mapping phải có sourceSystem, evidence và statusMappings đã kiểm chứng.');
  var source = TTHC.Sources.find(configuration.sourceSystem), keys = Object.keys(configuration.statusMappings), at = TTHC.Utils.now();
  if (!keys.length || keys.length > 100) TTHC.Utils.error('INVALID_MAPPING', 'Mapping cần 1–100 trạng thái nguồn.');
  var rows = keys.map(function (sourceStatus) {
    var normalized = configuration.statusMappings[sourceStatus];
    if (!sourceStatus.trim() || sourceStatus !== sourceStatus.trim() || sourceStatus.length > 200 || /[\u0000-\u001f]/.test(sourceStatus) || ['__proto__', 'constructor', 'prototype'].indexOf(sourceStatus) >= 0 || TTHC.Cases.statuses.indexOf(normalized) < 0) TTHC.Utils.error('INVALID_MAPPING', 'Trạng thái nguồn hoặc trạng thái chuẩn không hợp lệ.');
    return { mapping_id: TTHC.Crypto.hashLookupKey('status:' + source.id + ':' + sourceStatus), source_id: source.id, source_status: sourceStatus, normalized_status: normalized, confirmed: true, updated_at: at };
  });
  TTHC.Repo.writeBatch('STATUS_MAPPING', rows, 'mapping_id');
  TTHC.Audit.record('EDITOR_OWNER', 'CHANGE_SETTING', 'status-mapping', { count: rows.length, result: 'CONFIRMED_BY_OWNER' }, source.id);
  return { sourceSystem: source.id, confirmedMappings: rows.length };
}
