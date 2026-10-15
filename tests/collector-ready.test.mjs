import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWhenReady } from '../extension/background/collector-ready.mjs';

const empty = { ok: true, total: 0, records: [], errors: [], emptyMessage: 'Bảng trống' };
test('loading and empty snapshots wait for rows, without returning an empty success prematurely', async () => {
  const ready = { ok: true, total: 1, records: [{ caseCode: 'TEST' }], errors: [] };
  const results = [{ ok: false, code: 'COLLECTOR_LOADING' }, empty, ready];
  let checks = 0, waits = 0;
  const result = await collectWhenReady(async () => results.shift(), async () => { checks++; }, async ms => { assert.equal(ms, 1000); waits++; });
  assert.equal(result, ready); assert.equal(checks, 6); assert.equal(waits, 2);
});
test('persistently empty table stops after five waits and retains its diagnostic', async () => {
  let reads = 0, waits = 0;
  const result = await collectWhenReady(async () => { reads++; return empty; }, async () => {}, async () => { waits++; });
  assert.equal(result.emptyMessage, 'Bảng trống'); assert.equal(reads, 6); assert.equal(waits, 5);
});
test('authentication, parser and row-validation failures are never retried', async () => {
  for (const result of [{ ok: false, error: 'Chưa đăng nhập' }, { ok: false, error: 'Không nhận diện bảng' },
    { ok: true, total: 1, records: [], errors: [{ error: 'Thiếu ngày' }] }]) {
    assert.equal(await collectWhenReady(async () => result, async () => {}, async () => assert.fail('must not retry')), result);
  }
});
test('navigation during a wait or read aborts without collecting another page', async () => {
  let active = true, reads = 0;
  await assert.rejects(() => collectWhenReady(async () => { reads++; return empty; },
    async () => { if (!active) throw new Error('Tab đã chuyển trang'); }, async () => { active = false; }), /chuyển trang/);
  assert.equal(reads, 1);
  active = true;
  await assert.rejects(() => collectWhenReady(async () => { active = false; return { ok: true, total: 1, records: [{}] }; },
    async () => { if (!active) throw new Error('Tab đã chuyển trang'); }), /chuyển trang/);
});
