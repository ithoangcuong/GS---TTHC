import { createHash, randomUUID } from 'node:crypto';
import { normalizeCase, validateCase } from '../shared/normalize.mjs';
import { transaction, audit, sourceMappings, ruleFor } from './database.mjs';
import { hasAccess, scopeWhere } from './auth.mjs';
import { evaluateCase } from './engine.ts';
import { InAppNotificationAdapter } from './notifications.mjs';

const TERMINAL_SQL = "('COMPLETED','CANCELLED','RETURNED')";
const NOTIFY_LEVELS = new Set(['WARNING', 'HIGH_RISK', 'OVERDUE', 'CRITICAL_OVERDUE', 'NEEDS_REVIEW']);
function identityId(source, kind, value) { return `${source}:${kind}:${createHash('sha256').update(value).digest('hex').slice(0, 20)}`; }
function assignCatalogs(db, record) {
  for (const [kind, table] of [['agency', 'agencies'], ['department', 'departments'], ['officer', 'officers']]) {
    const name = record[`${kind}Name`];
    if (!name) continue;
    const id = record[`${kind}Id`] || identityId(record.sourceSystem, kind, name);
    record[`${kind}Id`] = id;
    const existing = db.prepare(`SELECT sourceSystem FROM ${table} WHERE id=?`).get(id);
    if (existing && existing.sourceSystem !== record.sourceSystem) throw new Error('ID đơn vị/cán bộ thuộc nguồn khác; cần dùng ID có phạm vi nguồn.');
    if (kind === 'agency') db.prepare('INSERT INTO agencies VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id, record.sourceSystem, name);
    if (kind === 'department') db.prepare('INSERT INTO departments VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,agencyId=excluded.agencyId').run(id, record.sourceSystem, name, record.agencyId || null);
    if (kind === 'officer') db.prepare('INSERT INTO officers VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,agencyId=excluded.agencyId,departmentId=excluded.departmentId').run(id, record.sourceSystem, name, record.agencyId || null, record.departmentId || null);
  }
  if (record.procedureCode) db.prepare('INSERT INTO procedures VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(`${record.sourceSystem}:${record.procedureCode}`, record.sourceSystem, record.procedureCode, record.procedureName || record.procedureCode);
}
function nextRecalculation(record, rule, now) {
  if (['COMPLETED', 'CANCELLED', 'RETURNED'].includes(record.normalizedStatus)) return 8640000000000000;
  const due = Date.parse(record.extensionDueAt || record.dueAt || record.originalDueAt || '');
  const times = [rule.watchSeconds, rule.warningSeconds, rule.highRiskSeconds, 0, -rule.criticalOverdueSeconds].map(seconds => due - seconds * 1000 + 1);
  const average = record.metadata?.averageStepSeconds;
  if (average > 0 && record.currentStepStartedAt) times.push(Date.parse(record.currentStepStartedAt) + average * 1000 + 1);
  return Math.min(...times.filter(time => Number.isFinite(time) && time > now), 8640000000000000);
}
function updateAlert(db, caseId, record, evaluation, now) {
  const previous = db.prepare('SELECT * FROM alerts WHERE caseId=?').get(caseId);
  const active = NOTIFY_LEVELS.has(evaluation.alertLevel);
  const message = `${record.caseCode}: ${evaluation.alertLevel}`;
  const reason = JSON.stringify({ rule: evaluation.triggeredRule, reasons: evaluation.riskReasons });
  if (!previous && !active) return;
  const id = previous?.id || randomUUID();
  const status = active ? (previous?.level === evaluation.alertLevel && previous.status === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'OPEN') : 'RESOLVED';
  if (!previous) db.prepare('INSERT INTO alerts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, caseId, evaluation.triggeredRule, evaluation.alertLevel, message, reason, status, now, now, null, null, now);
  else db.prepare('UPDATE alerts SET type=?,level=?,message=?,reason=?,status=?,lastDetectedAt=?,acknowledgedAt=?,acknowledgedBy=? WHERE id=?').run(evaluation.triggeredRule || 'RESOLVED', evaluation.alertLevel, message, reason, status, now, status === 'ACKNOWLEDGED' ? previous.acknowledgedAt : null, status === 'ACKNOWLEDGED' ? previous.acknowledgedBy : null, id);
  if (!previous || previous.level !== evaluation.alertLevel || previous.status !== status) {
    db.prepare('INSERT INTO alert_history VALUES (?,?,?,?,?,?)').run(randomUUID(), id, previous?.level || null, evaluation.alertLevel, status, now);
    if (active && (!previous || previous.level !== evaluation.alertLevel || previous.status === 'RESOLVED')) new InAppNotificationAdapter(db).send({ alertId: id, caseId, message, createdAt: now });
  }
}
export function caseView(row, user = null) {
  if (!row) return null;
  const data = JSON.parse(row.data); const evaluation = JSON.parse(row.evaluation);
  const item = { ...data, ...evaluation, id: row.id, sourceSystem: row.sourceSystem, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(), lastSyncedAt: new Date(row.lastSyncedAt).toISOString() };
  if (user?.role === 'VIEWER') {
    if (item.applicantName) item.applicantName = item.applicantName.split(/\s+/).map(part => `${part[0] || ''}***`).join(' ');
    delete item.metadata;
  }
  return item;
}
export function upsertCase(db, raw, sourceId, user, jobId, now = Date.now()) {
  const input = normalizeCase(raw, sourceId, sourceMappings(db, sourceId));
  const keys = [['RECORD', input.sourceRecordId], ['CASE', input.sourceCaseId], ['CODE', input.caseCode]].filter(([, value]) => value);
  const candidates = new Set();
  for (const [kind, value] of keys) {
    const alias = db.prepare('SELECT caseId FROM case_aliases WHERE sourceSystem=? AND kind=? AND value=?').get(sourceId, kind, value);
    if (alias) candidates.add(alias.caseId);
  }
  if (candidates.size > 1) throw new Error('Các mã định danh xung đột; cần kiểm tra hồ sơ nguồn.');
  const previous = candidates.size ? db.prepare('SELECT * FROM cases WHERE id=?').get([...candidates][0]) : null;
  const old = previous ? JSON.parse(previous.data) : {};
  if (previous && !hasAccess(user, old)) throw new Error('Hồ sơ hiện tại nằm ngoài phạm vi dữ liệu được cấp.');
  for (const field of ['sourceRecordId', 'sourceCaseId']) if (old[field] && input[field] && old[field] !== input[field]) throw new Error('Mã định danh nguồn thay đổi/xung đột với mã hồ sơ hiện tại.');
  if (previous && old.lastSourceUpdateAt && input.lastSourceUpdateAt && Date.parse(input.lastSourceUpdateAt) < Date.parse(old.lastSourceUpdateAt)) return 'skipped';
  const record = { ...old, ...input, sourceSystem: sourceId };
  record.normalizedStatus ||= 'UNKNOWN';
  record.originalDueAt = old.originalDueAt || input.originalDueAt || old.dueAt || input.dueAt || null;
  const errors = validateCase(record);
  if (errors.length) throw new Error(errors.join('; '));
  assignCatalogs(db, record);
  if (!hasAccess(user, record)) throw new Error('Hồ sơ nằm ngoài phạm vi đơn vị/cán bộ/nguồn được cấp.');
  const rule = ruleFor(db, record); const evaluation = evaluateCase(record, rule, now);
  const id = previous?.id || randomUUID();
  const changed = JSON.stringify(old) !== JSON.stringify(record);
  const columns = ['id', 'sourceSystem', 'caseCode', 'sourceRecordId', 'sourceCaseId', 'agencyId', 'departmentId', 'officerId', 'procedureCode', 'normalizedStatus', 'receivedAt', 'dueAt', 'alertLevel', 'riskScore', 'completionResult', 'needsReview', 'data', 'evaluation', 'createdAt', 'updatedAt', 'lastSyncedAt', 'nextRecalculationAt'];
  const values = [id, sourceId, record.caseCode, record.sourceRecordId || null, record.sourceCaseId || null, record.agencyId || null, record.departmentId || null, record.officerId || null, record.procedureCode || null, record.normalizedStatus, record.receivedAt || null, evaluation.effectiveDueAt, evaluation.alertLevel, evaluation.riskScore, evaluation.completionResult, Number(evaluation.needsReview), JSON.stringify(record), JSON.stringify(evaluation), previous?.createdAt || now, changed ? now : (previous?.updatedAt || now), now, nextRecalculation(record, rule, now)];
  db.prepare(`INSERT INTO cases(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).filter(name => name !== 'createdAt').map(name => `${name}=excluded.${name}`).join(',')}`).run(...values);
  for (const [kind, value] of keys) db.prepare('INSERT OR IGNORE INTO case_aliases VALUES (?,?,?,?)').run(sourceId, kind, value, id);
  if (changed) {
    const changes = {};
    for (const key of new Set([...Object.keys(old), ...Object.keys(record)])) if (JSON.stringify(old[key]) !== JSON.stringify(record[key])) changes[key] = { from: old[key] ?? null, to: record[key] ?? null };
    const kind = !previous ? 'CREATED' : (changes.dueAt || changes.extensionDueAt) ? 'DUE_DATE_CHANGED' : (changes.officerId || changes.departmentId) ? 'ASSIGNMENT_CHANGED' : changes.normalizedStatus ? 'STATUS_CHANGED' : 'SOURCE_UPDATED';
    db.prepare('INSERT INTO case_history VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, kind, JSON.stringify(changes), user.id, jobId, now);
  }
  updateAlert(db, id, record, evaluation, now);
  return previous ? (changed ? 'updated' : 'skipped') : 'created';
}
export function syncBatch(db, { sourceSystem, records, batchId, kind = 'COLLECTOR' }, user) {
  if (typeof sourceSystem !== 'string' || sourceSystem.length > 50) throw Object.assign(new Error('sourceSystem không hợp lệ.'), { status: 400 });
  const source = db.prepare('SELECT * FROM source_systems WHERE id=?').get(sourceSystem);
  if (!source) throw Object.assign(new Error('Nguồn không tồn tại.'), { status: 400 });
  if (!source.enabled) throw Object.assign(new Error('Nguồn đang tắt; liên hệ quản trị viên.'), { status: 409 });
  if (user.role === 'VIEWER' || (user.role !== 'SYSTEM_ADMIN' && !user.scope?.sourceSystems?.includes(sourceSystem))) throw Object.assign(new Error('Không được phép đồng bộ nguồn này.'), { status: 403 });
  if (!Array.isArray(records) || records.length < 1 || records.length > (kind === 'IMPORT' || kind === 'DEMO' ? 10000 : 500)) throw Object.assign(new Error('Batch cần 1–500 hồ sơ (import tối đa 10.000).'), { status: 400 });
  if (batchId && (typeof batchId !== 'string' || batchId.length > 160 || !/^[\w:.-]+$/.test(batchId))) throw Object.assign(new Error('batchId không hợp lệ.'), { status: 400 });
  if (batchId) {
    const prior = db.prepare('SELECT * FROM sync_jobs WHERE initiatedBy=? AND sourceId=? AND batchId=?').get(user.id, sourceSystem, batchId);
    if (prior) return jobView(prior);
  }
  const id = randomUUID(); const started = Date.now(); const count = { created: 0, updated: 0, skipped: 0, failed: 0 }; const errors = [];
  db.prepare('INSERT INTO sync_jobs(id,sourceId,initiatedBy,kind,batchId,startedAt,status,recordsFetched) VALUES (?,?,?,?,?,?,?,?)').run(id, sourceSystem, user.id, kind, batchId || null, started, 'SYNCING', records.length);
  for (let index = 0; index < records.length; index++) {
    try { const result = transaction(db, () => upsertCase(db, records[index], sourceSystem, user, id)); count[result]++; }
    catch (error) { count.failed++; errors.push({ row: index + 2, error: error.message || 'Dữ liệu hồ sơ không hợp lệ.' }); }
  }
  const status = count.failed === records.length ? 'SYNC_ERROR' : count.failed ? 'PARTIAL_SUCCESS' : 'SYNC_SUCCESS';
  db.prepare('UPDATE sync_jobs SET completedAt=?,status=?,recordsCreated=?,recordsUpdated=?,recordsSkipped=?,recordsFailed=?,error=?,errors=? WHERE id=?').run(Date.now(), status, count.created, count.updated, count.skipped, count.failed, count.failed ? `${count.failed} dòng lỗi` : null, JSON.stringify(errors), id);
  db.prepare('UPDATE source_systems SET lastSyncedAt=?,lastSuccessAt=CASE WHEN ? THEN ? ELSE lastSuccessAt END,lastError=? WHERE id=?').run(Date.now(), Number(status !== 'SYNC_ERROR'), Date.now(), count.failed ? `${count.failed} dòng không hợp lệ` : null, sourceSystem);
  audit(db, user.id, kind === 'IMPORT' ? 'IMPORT_COMPLETED' : 'SYNC_COMPLETED', id, { sourceSystem, total: records.length, ...count });
  return { id, total: records.length, ...count, errors, status, durationMs: Date.now() - started };
}
export function jobView(row) { return { ...row, total: row.recordsFetched, created: row.recordsCreated, updated: row.recordsUpdated, skipped: row.recordsSkipped, failed: row.recordsFailed, errors: JSON.parse(row.errors), durationMs: row.completedAt ? row.completedAt - row.startedAt : null }; }
export function recalculateDue(db, now = Date.now(), limit = 500) {
  const rows = db.prepare('SELECT * FROM cases WHERE nextRecalculationAt<=? ORDER BY nextRecalculationAt LIMIT ?').all(now, limit);
  transaction(db, () => {
    for (const row of rows) {
      const record = JSON.parse(row.data); const rule = ruleFor(db, record); const evaluation = evaluateCase(record, rule, now);
      db.prepare('UPDATE cases SET dueAt=?,alertLevel=?,riskScore=?,completionResult=?,needsReview=?,evaluation=?,nextRecalculationAt=? WHERE id=?').run(evaluation.effectiveDueAt, evaluation.alertLevel, evaluation.riskScore, evaluation.completionResult, Number(evaluation.needsReview), JSON.stringify(evaluation), nextRecalculation(record, rule, now), row.id);
      updateAlert(db, row.id, record, evaluation, now);
    }
  });
  return rows.length;
}
export function caseFilter(user, query = {}) {
  const { clauses, params } = scopeWhere(user);
  for (const field of ['sourceSystem', 'agencyId', 'departmentId', 'officerId', 'procedureCode', 'normalizedStatus', 'alertLevel']) if (query[field]) { clauses.push(`c.${field}=?`); params.push(String(query[field]).slice(0, 200)); }
  for (const [flag, field] of [['agencyMissing', 'agencyId'], ['departmentMissing', 'departmentId'], ['officerMissing', 'officerId'], ['procedureMissing', 'procedureCode']]) if (query[flag] === 'true' && !query[field]) clauses.push(`c.${field} IS NULL`);
  if (query.risk === 'high') { clauses.push("c.alertLevel='HIGH_RISK'"); }
  if (query.overdue === 'true') clauses.push("c.alertLevel IN ('OVERDUE','CRITICAL_OVERDUE')");
  if (query.completionTiming === 'onTime') clauses.push("c.completionResult='ON_TIME'");
  if (query.completionTiming === 'late') clauses.push("c.completionResult='LATE'");
  if (query.needsReview === 'true') clauses.push('c.needsReview=1');
  if (query.bucket === 'active') clauses.push(`c.normalizedStatus NOT IN ${TERMINAL_SQL}`);
  if (query.bucket === 'overdue') clauses.push("c.alertLevel IN ('OVERDUE','CRITICAL_OVERDUE')");
  if (query.bucket === 'warning') clauses.push("c.alertLevel='WARNING'");
  if (query.bucket === 'completed') clauses.push("c.normalizedStatus='COMPLETED'");
  if (query.q) {
    clauses.push("(c.caseCode LIKE ? ESCAPE '\\' OR json_extract(c.data,'$.procedureName') LIKE ? ESCAPE '\\' OR json_extract(c.data,'$.applicantName') LIKE ? ESCAPE '\\' OR json_extract(c.data,'$.officerName') LIKE ? ESCAPE '\\')");
    const value = `%${String(query.q).slice(0, 200).replace(/[\\%_]/g, '\\$&')}%`; params.push(value, value, value, value);
  }
  for (const [key, field, operator] of [['receivedFrom', 'receivedAt', '>='], ['receivedTo', 'receivedAt', '<='], ['dueFrom', 'dueAt', '>='], ['dueTo', 'dueAt', '<=']]) if (query[key]) {
    const input = String(query[key]);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T${key.endsWith('To') ? '23:59:59.999' : '00:00:00'}+07:00` : input;
    if (!Number.isFinite(Date.parse(date))) throw new Error('Khoảng ngày không hợp lệ.');
    clauses.push(`c.${field}${operator}?`); params.push(new Date(date).toISOString());
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}
export function pageOptions(query) {
  const page = Number(query.page || 1); const pageSize = Number(query.pageSize || 25);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Phân trang không hợp lệ.');
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function listCases(db, user, query) {
  const { where, params } = caseFilter(user, query); const { page, pageSize, offset } = pageOptions(query);
  const sort = ['dueAt', 'updatedAt', 'riskScore', 'caseCode', 'receivedAt', 'alertLevel', 'priority'].includes(query.sort) ? query.sort : 'priority'; const order = query.order === 'desc' ? 'DESC' : 'ASC';
  const orderBy = sort === 'priority' ? `CASE c.alertLevel WHEN 'CRITICAL_OVERDUE' THEN 0 WHEN 'OVERDUE' THEN 1 WHEN 'HIGH_RISK' THEN 2 WHEN 'WARNING' THEN 3 WHEN 'WATCH' THEN 4 WHEN 'NEEDS_REVIEW' THEN 5 ELSE 6 END ${order},c.dueAt IS NULL,c.dueAt ASC,c.riskScore DESC,c.id` : `c.${sort} IS NULL,c.${sort} ${order},c.id`;
  const total = db.prepare(`SELECT COUNT(*) n FROM cases c ${where}`).get(...params).n;
  const items = db.prepare(`SELECT c.* FROM cases c ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, pageSize, offset).map(row => caseView(row, user));
  return { items, total, page, pageSize };
}
const METRICS = `COUNT(*) total,SUM(normalizedStatus NOT IN ${TERMINAL_SQL}) active,SUM(alertLevel='SAFE' AND normalizedStatus NOT IN ${TERMINAL_SQL}) safe,SUM(alertLevel='WATCH') watch,SUM(alertLevel='WARNING') warning,SUM(alertLevel='HIGH_RISK') highRisk,SUM(alertLevel IN ('OVERDUE','CRITICAL_OVERDUE')) overdue,SUM(alertLevel='CRITICAL_OVERDUE') criticalOverdue,SUM(normalizedStatus='COMPLETED') completed,SUM(completionResult='ON_TIME') onTime,SUM(completionResult='LATE') completedLate,SUM(needsReview) needsReview`;
function metricsView(row) {
  const metrics = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? 0]));
  const classified = metrics.onTime + metrics.completedLate;
  metrics.onTimeRate = classified ? Math.round(10000 * metrics.onTime / classified) / 100 : null;
  metrics.overdueRate = metrics.active ? Math.round(10000 * metrics.overdue / metrics.active) / 100 : null;
  return metrics;
}
export function dashboard(db, user, query) {
  const { where, params } = caseFilter(user, query);
  const metrics = metricsView(db.prepare(`SELECT ${METRICS} FROM cases c ${where}`).get(...params));
  const groups = {};
  for (const [key, column, label] of [['bySource', 'sourceSystem', 'sourceName'], ['byAgency', 'agencyId', 'agencyName'], ['byDepartment', 'departmentId', 'departmentName'], ['byOfficer', 'officerId', 'officerName'], ['byProcedure', 'procedureCode', 'procedureName']]) {
    groups[key] = db.prepare(`SELECT ${column} id,MAX(json_extract(data,'$.${label}')) name,${METRICS} FROM cases c ${where} GROUP BY ${column} ORDER BY overdue DESC,highRisk DESC,total DESC LIMIT 100`).all(...params).map(row => ({ ...metricsView(row), id: row.id, name: row.name || row.id || 'Chưa có thông tin' }));
  }
  const extra = where ? `${where} AND` : 'WHERE';
  const priority = db.prepare(`SELECT c.* FROM cases c ${extra} alertLevel IN ('CRITICAL_OVERDUE','OVERDUE','HIGH_RISK','WARNING') ORDER BY CASE alertLevel WHEN 'CRITICAL_OVERDUE' THEN 0 WHEN 'OVERDUE' THEN 1 WHEN 'HIGH_RISK' THEN 2 ELSE 3 END,dueAt,riskScore DESC LIMIT 20`).all(...params).map(row => caseView(row, user));
  return { metrics, ...groups, priority, generatedAt: new Date().toISOString() };
}
