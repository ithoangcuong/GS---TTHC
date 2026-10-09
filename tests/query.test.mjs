import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.mjs';
import { syncBatch, listCases, dashboard } from '../server/cases.mjs';
const user = { id: 'query-test', role: 'SYSTEM_ADMIN', scope: {} };
const date = hours => new Date(Date.now() + hours * 3600000).toISOString();
test('priority and drilldown filters agree with aggregate counts, including missing assignments', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close());
  const records = [
    { caseCode: 'COMPLETED', dueAt: date(-200), completedAt: date(-201), normalizedStatus: 'COMPLETED' },
    { caseCode: 'SAFE', dueAt: date(240), normalizedStatus: 'PROCESSING' },
    { caseCode: 'REVIEW', dueAt: date(-120), normalizedStatus: 'PAUSED' },
    { caseCode: 'WATCH', dueAt: date(100), normalizedStatus: 'PROCESSING' },
    { caseCode: 'WARNING', dueAt: date(48), normalizedStatus: 'PROCESSING' },
    { caseCode: 'HIGH', dueAt: date(12), normalizedStatus: 'PROCESSING' },
    { caseCode: 'OVERDUE', dueAt: date(-12), normalizedStatus: 'PROCESSING' },
    { caseCode: 'CRITICAL', dueAt: date(-96), normalizedStatus: 'PROCESSING', agencyId: 'A', agencyName: 'Agency A' },
  ];
  assert.equal(syncBatch(db, { sourceSystem: 'MOC', records }, user).created, 8);
  const report = dashboard(db, user, { sourceSystem: 'MOC' });
  const priority = listCases(db, user, { sourceSystem: 'MOC', sort: 'priority' });
  assert.deepEqual(priority.items.slice(0, 6).map(item => item.caseCode), ['CRITICAL', 'OVERDUE', 'HIGH', 'WARNING', 'WATCH', 'REVIEW']);
  assert.equal(listCases(db, user, { sourceSystem: 'MOC', overdue: 'true' }).total, report.metrics.overdue);
  assert.equal(listCases(db, user, { sourceSystem: 'MOC', needsReview: 'true' }).total, report.metrics.needsReview);
  const missing = report.byAgency.find(group => group.id === null);
  assert.equal(listCases(db, user, { sourceSystem: 'MOC', agencyMissing: 'true' }).total, missing.total);
  assert.equal(listCases(db, user, { agencyId: 'A', agencyMissing: 'true' }).total, 1);
});
test('a sync explicitly withdrawing due date preserves original history and requests review', t => {
  const db = openDatabase(':memory:'); t.after(() => db.close()); const original = date(-12);
  syncBatch(db, { sourceSystem: 'TPHCM', records: [{ caseCode: 'WITHDRAWN', dueAt: original, normalizedStatus: 'PROCESSING' }] }, user);
  assert.equal(listCases(db, user, {}).items[0].alertLevel, 'OVERDUE');
  assert.equal(syncBatch(db, { sourceSystem: 'TPHCM', records: [{ caseCode: 'WITHDRAWN', dueAt: null }] }, user).updated, 1);
  const item = listCases(db, user, {}).items[0]; assert.equal(item.alertLevel, 'NEEDS_REVIEW'); assert.equal(item.effectiveDueAt, null); assert.equal(item.originalDueAt, original); assert.equal(item.isOverdue, false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM case_history WHERE kind='DUE_DATE_CHANGED'").get().n, 1);
});
