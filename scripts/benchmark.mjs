import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { openDatabase, transaction } from '../server/database.mjs';
import { dashboard, listCases } from '../server/cases.mjs';
import { evaluateCase, DEFAULT_RULE } from '../server/engine.ts';
const count = Number(process.env.RECORD_COUNT || 10000);
if (!Number.isSafeInteger(count) || count < 1000 || count > 100000) throw new Error('RECORD_COUNT cần 1.000–100.000.');
const db = openDatabase(':memory:'); const user = { id: 'benchmark', role: 'SYSTEM_ADMIN', scope: {} }; const now = Date.now();
const begin = performance.now();
try {
  const insert = db.prepare('INSERT INTO cases VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  transaction(db, () => {
    for (let index = 0; index < count; index++) {
      const source = index % 2 ? 'MOC' : 'TPHCM'; const id = `SYNTHETIC-${index}`;
      const record = { sourceSystem: source, sourceName: source, caseCode: id, normalizedStatus: 'PROCESSING', agencyId: `A-${index % 3}`, agencyName: `Synthetic agency ${index % 3}`, departmentId: `D-${index % 5}`, departmentName: `Synthetic department ${index % 5}`, officerId: `O-${index % 10}`, officerName: `Synthetic officer ${index % 10}`, procedureCode: `P-${index % 10}`, procedureName: `Synthetic procedure ${index % 10}`, receivedAt: new Date(now - 864000000).toISOString(), dueAt: new Date(now + ((index % 21) - 10) * 86400000).toISOString() };
      const evaluation = evaluateCase(record, DEFAULT_RULE, now);
      insert.run(id, source, id, null, null, record.agencyId, record.departmentId, record.officerId, record.procedureCode, record.normalizedStatus, record.receivedAt, record.dueAt, evaluation.alertLevel, evaluation.riskScore, null, 0, JSON.stringify(record), JSON.stringify(evaluation), now, now, now, 8640000000000000);
    }
  });
  const inserted = performance.now(); const page = listCases(db, user, { sourceSystem: 'MOC', page: 2, pageSize: 25, sort: 'priority' }); const listed = performance.now();
  assert.equal(page.items.length, 25); assert.equal(page.total, Math.floor(count / 2));
  const result = dashboard(db, user, { sourceSystem: 'MOC' }); const grouped = performance.now(); assert.equal(result.metrics.total, page.total);
  const plan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM cases WHERE sourceSystem=? LIMIT 25').all('MOC').map(row => row.detail);
  assert.ok(plan.some(detail => /USING (?:COVERING )?INDEX/.test(detail) && detail.includes('sourceSystem')));
  const output = { syntheticRows: count, directFixtureInsertMs: Math.round(inserted - begin), scopedPageMs: Math.round(listed - inserted), scopedDashboardMs: Math.round(grouped - listed), returnedPageRows: page.items.length, sourceIndexUsed: true, queryPlan: plan, note: 'Single-process in-memory query benchmark; not production concurrency, full sync throughput or portal integration.' };
  console.log(JSON.stringify(output, null, 2));
} finally { db.close(); }
