import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runInContext } from 'node:vm';
import { gasRuntime } from './helpers/apps-script.mjs';

const all = { sources: ['*'], agencies: ['*'], departments: ['*'], officers: ['*'] };
function fixture(count = 250) {
  const gas = gasRuntime(['Utils','Crypto','Passwords','SheetRepository','Settings','Audit','Permissions','Users','Sources','Deadline','Cases','Setup']);
  gas.context.setupTthcMonitor_();
  const actor = { id: 'test', role: 'SUPER_ADMIN', status:'ACTIVE', scope: all }, settings = gas.app.Settings.get(), now = Date.now();
  const rows = Array.from({length: count}, (_, i) => {
    const record = { id: 'case-' + i, caseCode: 'CASE-' + i, sourceSystem: 'TPHCM', normalizedStatus: 'PROCESSING', submittedAt: i % 2 ? '2026-10-02T01:00:00+07:00' : '2026-10-01T01:00:00+07:00', procedureName: 'Synthetic procedure '.repeat(30), originalDueAt: '2026-12-01T00:00:00+07:00', updatedAt: '2026-10-15T00:00:00Z' };
    return gas.app.Cases.rowFor(record, null, gas.app.Crypto.encrypt(record), settings, now);
  });
  const query = runInContext('({submittedFrom: "2026-10-02", submittedTo: "2026-10-02"})',gas.context);
  return {gas,rows,actor,settings,now,query};
}
const decryptions = gas => gas.calls.filter(call => call.op === 'crypto' && call.operation === 'decrypt').length;

test('encrypted date index reduces repeated filtering decryptions without changing results', () => {
  const {gas,rows,actor,settings,now,query} = fixture(1000);
  // Reference implementation is the previous decrypt-every-record date filter.
  const baseline = () => rows.filter(row => {
    const time = Date.parse(gas.app.Crypto.decrypt(row.payload_encrypted).submittedAt);
    return time >= gas.app.Cases.dateFilter(query.submittedFrom, false) && time <= gas.app.Cases.dateFilter(query.submittedTo, true);
  });
  function measure(fn) { gas.calls.length=0; const start=performance.now(); const result=fn(); return {result,ms:Math.round((performance.now()-start)*100)/100,decryptions:decryptions(gas)}; }
  const old=measure(baseline), cold=measure(()=>gas.app.Cases.filterRows(rows,actor,query,settings,now)), warm=measure(()=>gas.app.Cases.filterRows(rows,actor,query,settings,now));
  assert.deepEqual(warm.result.map(row=>row.record_id),old.result.map(row=>row.record_id));
  assert.deepEqual(cold.result.map(row=>row.record_id),old.result.map(row=>row.record_id));
  assert.equal(old.decryptions,1000); assert.equal(warm.decryptions,10);
  const report={syntheticRows:1000,matchedRows:warm.result.length,baseline:{ms:old.ms,decryptions:old.decryptions},cold:{ms:cold.ms,decryptions:cold.decryptions},warm:{ms:warm.ms,decryptions:warm.decryptions},note:'Local synthetic benchmark, not live Google Sheets latency. Baseline measures only decrypt/date filtering; optimized path also checks permissions and other indexes.'};
  mkdirSync('data/preview',{recursive:true});writeFileSync('data/preview/date-index-benchmark.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
});

test('index invalidates changed payloads and respects scopes, missing dates and cache failure', () => {
  const {gas,rows,actor,settings,now,query} = fixture();
  const filter=(user=actor)=>gas.app.Cases.filterRows(rows,user,query,settings,now);
  assert.equal(filter().length,125);
  const value=gas.app.Crypto.decrypt(rows[0].payload_encrypted);
  rows[0].payload_encrypted=gas.app.Crypto.encrypt({...value,submittedAt:'2026-10-02T02:00:00+07:00'});
  assert.equal(filter().length,126);
  rows[0].payload_encrypted=gas.app.Crypto.encrypt({...value,submittedAt:null});
  assert.equal(filter().length,125);
  gas.calls.length=0;
  assert.equal(filter({id:'other',role:'VIEWER',status:'ACTIVE',scope:{...all,sources:['MOF']}}).length,0);
  assert.equal(decryptions(gas),0);
  gas.cache.get=()=>'{bad';
  gas.cache.put=()=>{throw new Error('Cache unavailable');};
  assert.equal(filter().length,125);
  rows[0].payload_encrypted='bad ciphertext';
  assert.throws(filter);
});
