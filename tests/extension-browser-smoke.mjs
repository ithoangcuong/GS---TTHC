import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

// Synthetic portal page and runtime stub; this checks real DOM visibility, not live portal integration.
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .filter(Boolean).find(existsSync);
if (!executablePath) throw new Error('Cần Chrome/Edge hoặc BROWSER_PATH để kiểm tra DOM collector.');
const url = 'https://motcua.tphcm.gov.vn/synthetic-browser-list';
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://motcua.tphcm.gov.vn/**', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html lang="vi"><meta charset="utf-8"><title>DOM TỔNG HỢP</title>
    <div id="synthetic-login">SYNTHETIC AUTHENTICATION MARKER</div>
    <table id="synthetic-table"><thead><tr><th>Code</th><th>Due</th><th>Status</th><th>Applicant</th><th>Countdown</th></tr></thead>
    <tbody><tr><td>SYNTHETIC-BROWSER-001<span style="display:none">PRIVATE HIDDEN TEXT</span></td>
      <td>08/10/2026 09:04:34</td><td>Synthetic processing</td><td id="pii">PRIVATE APPLICANT</td><td>999 days</td></tr>
    <tr style="display:none"><td>HIDDEN-ROW</td><td>08/10/2026 09:04:34</td><td>Synthetic processing</td><td>PRIVATE</td><td>999</td></tr></tbody></table>
    </html>` }));
  await page.goto(url);
  await page.evaluate(() => {
    globalThis.chrome = { runtime: { id: 'synthetic-runtime-id',
      onMessage: { addListener: listener => { globalThis.syntheticCollectorListener = listener; } } } };
    Object.defineProperty(document.getElementById('pii'), 'textContent', { get() { throw new Error('PII must never be read'); } });
    Object.defineProperty(document.getElementById('pii'), 'innerText', { get() { throw new Error('PII must never be read'); } });
  });
  await page.addScriptTag({ content: readFileSync(new URL('../extension/content/collector.js', import.meta.url), 'utf8') });
  const config = { sourceSystem: 'TPHCM', verified: true,
    evidence: { reference: 'SYNTHETIC BROWSER DOM TEST ONLY', verifiedAt: new Date().toISOString() },
    listUrl: url, loggedInSelector: '#synthetic-login', tableSelector: '#synthetic-table',
    headerSelector: 'thead th', rowSelector: 'tbody tr', cellSelector: 'td',
    headerMappings: { Code: 'caseCode', Due: 'dueAt', Status: 'sourceStatus' },
    statusMappings: { 'Synthetic processing': 'PROCESSING' } };
  const collected = await page.evaluate(config => {
    let output;
    syntheticCollectorListener({ type: 'COLLECT_VERIFIED_TABLE', sourceSystem: 'TPHCM', config },
      { id: 'synthetic-runtime-id', url: 'chrome-extension://synthetic-runtime-id/background/service-worker.mjs' }, result => { output = result; });
    return output;
  }, config);
  assert.equal(collected.ok, true, collected.error);
  assert.equal(collected.total, 1);
  assert.equal(collected.records.length, 1);
  assert.equal(collected.records[0].caseCode, 'SYNTHETIC-BROWSER-001');
  assert.equal(collected.records[0].dueAt, '2026-10-08T02:04:34.000Z');
  assert.equal(collected.records[0].normalizedStatus, 'PROCESSING');
  assert.ok(collected.records[0].lastObservedAt);
  assert.ok(!JSON.stringify(collected).includes('PRIVATE'));
  await page.locator('#synthetic-login').evaluate(element => { element.style.visibility = 'hidden'; });
  const blocked = await page.evaluate(config => {
    let output;
    syntheticCollectorListener({ type: 'COLLECT_VERIFIED_TABLE', sourceSystem: 'TPHCM', config },
      { id: 'synthetic-runtime-id', url: 'chrome-extension://synthetic-runtime-id/background/service-worker.mjs' }, result => { output = result; });
    return output;
  }, config);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /đăng nhập/);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic Chrome DOM collector: visible rows/text only, unmapped PII never read, UTC+07, lastObservedAt, hidden login blocked. No live portal/extension deployment verified.');
} finally { await browser.close(); }
