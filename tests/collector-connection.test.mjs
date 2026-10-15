import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFromTab } from '../extension/background/collector-connection.mjs';

const missing = () => new Error('Could not establish connection. Receiving end does not exist.');
const config = { sourceSystem: 'MOC' };
test('missing receiver injects packaged isolated collector and retries once', async () => {
  const calls = []; let attempts = 0;
  const chrome = { tabs: { sendMessage: async (...args) => {
    calls.push(['send', ...args]);
    if (++attempts === 1) throw missing();
    return { ok: true, records: [] };
  } }, scripting: { executeScript: async args => { calls.push(['inject', args]); } } };
  const result = await collectFromTab(chrome, 7, 'MOC', config, async () => { calls.push(['check']); });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(call => call[0]), ['send', 'check', 'inject', 'check', 'send']);
  assert.deepEqual(calls[2][1], { target: { tabId: 7, frameIds: [0] }, files: ['content/collector.js'], world: 'ISOLATED' });
  assert.deepEqual(calls[0], calls[4]);
});
test('existing receiver, parser failures and unrelated transport errors never inject', async () => {
  for (const result of [{ ok: true }, { ok: false, error: 'Chưa đăng nhập' }, new Error('The tab was closed.')]) {
    const chrome = { tabs: { sendMessage: async () => { if (result instanceof Error) throw result; return result; } },
      scripting: { executeScript: async () => assert.fail('must not inject') } };
    const read = () => collectFromTab(chrome, 7, 'MOC', config, async () => assert.fail('must not retry'));
    if (result instanceof Error) await assert.rejects(read, /tab was closed/);
    else assert.equal(await read(), result);
  }
});
test('navigation before recovery prevents injection; navigation after injection prevents retry', async () => {
  for (const failAt of [1, 2]) {
    let sends = 0, injections = 0, checks = 0;
    const chrome = { tabs: { sendMessage: async () => { sends++; throw missing(); } },
      scripting: { executeScript: async () => { injections++; } } };
    await assert.rejects(() => collectFromTab(chrome, 7, 'MOC', config, async () => {
      if (++checks === failAt) throw new Error('Tab đã chuyển trang');
    }), /chuyển trang/);
    assert.equal(sends, 1); assert.equal(injections, failAt - 1);
  }
});
test('denied injection or still missing receiver returns actionable error without retry loop', async () => {
  for (const denied of [true, false]) {
    let sends = 0, injections = 0;
    const chrome = { tabs: { sendMessage: async () => { sends++; throw missing(); } },
      scripting: { executeScript: async () => { injections++; if (denied) throw new Error('Cannot access contents of url'); } } };
    await assert.rejects(() => collectFromTab(chrome, 7, 'MOC', config, async () => {}), /tải lại trang/);
    assert.equal(injections, 1); assert.equal(sends, denied ? 1 : 2);
  }
});
