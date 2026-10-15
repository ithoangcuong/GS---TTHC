import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mocProfileConfig } from '../extension/adapters/moc-profile.mjs';

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
  const moc = await browser.newPage();
  moc.on('pageerror', error => errors.push(error.message));
  const mocUrl = 'https://motcuabxd.moc.gov.vn/vi/dossier/search';
  await moc.route('https://motcuabxd.moc.gov.vn/**', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><meta charset="utf-8"><title>SYNTHETIC MOC</title>
    <style>app-list-search,mat-table,mat-row,mat-header-row,mat-cell,mat-header-cell{display:block}</style>
    <app-list-search><h2>Tra cứu hồ sơ toàn cơ quan</h2><input formcontrolname="advFilingFrom" value="14/7/2026"><input formcontrolname="advFilingTo" value="12/10/2026"><div class="searchtbl-allAgency"><mat-table>
    <mat-header-row><mat-header-cell></mat-header-cell><mat-header-cell>Mã số hồ sơ</mat-header-cell>
    <mat-header-cell>Thủ tục</mat-header-cell><mat-header-cell>Thời gian quy định</mat-header-cell>
    <mat-header-cell>Người nộp</mat-header-cell><mat-header-cell>Cơ quan thực hiện</mat-header-cell>
    <mat-header-cell>Trạng thái</mat-header-cell><mat-header-cell>Thao tác</mat-header-cell></mat-header-row>
    <mat-row><mat-cell></mat-cell><mat-cell>SYNTHETIC-001<br>02</mat-cell><mat-cell>1.000001<br>- Thủ tục kiểm thử</mat-cell>
    <mat-cell>Còn lại 999 ngày<ul><li>Ngày nộp: 02/10/2026<br>14:18:32</li><li>Ngày tiếp nhận: 02/10/2026 16:03:15</li><li>Ngày hẹn trả: 13/10/202616:03:15</li></ul></mat-cell>
    <mat-cell id="moc-pii">PRIVATE APPLICANT</mat-cell><mat-cell><ul><li>Cơ quan : Đơn vị kiểm thử</li><li>Cán bộ: Cán bộ tổng hợp</li></ul></mat-cell>
    <mat-cell>Đang xử lý</mat-cell><mat-cell>...</mat-cell></mat-row></mat-table></div></app-list-search>` }));
  await moc.goto(mocUrl);
  await moc.evaluate(() => {
    globalThis.chrome = { runtime: { id: 'synthetic-runtime-id', onMessage: { addListener: listener => { globalThis.syntheticCollectorListener = listener; } } } };
    for (const key of ['innerText', 'textContent']) Object.defineProperty(document.getElementById('moc-pii'), key, { get() { throw new Error('MOC applicant must never be read'); } });
  });
  await moc.addScriptTag({ content: readFileSync(new URL('../extension/content/collector.js', import.meta.url), 'utf8') });
  const readMoc = () => moc.evaluate(config => {
    let result;
    syntheticCollectorListener({ type: 'COLLECT_VERIFIED_TABLE', sourceSystem: 'MOC', config },
      { id: 'synthetic-runtime-id', url: 'chrome-extension://synthetic-runtime-id/background/service-worker.mjs' }, output => { result = output; });
    return result;
  }, mocProfileConfig('motcuabxd.moc.gov.vn'));
  const mocResult = await readMoc();
  assert.equal(mocResult.ok, true, mocResult.error);
  assert.equal(mocResult.records.length, 1, JSON.stringify(mocResult.errors));
  assert.equal(mocResult.records[0].caseCode, 'SYNTHETIC-00102');
  assert.equal(mocResult.records[0].dueAt, '2026-10-13T09:03:15.000Z');
  assert.equal(mocResult.records[0].agencyName, 'Đơn vị kiểm thử');
  assert.equal(mocResult.collectionContext.submittedFrom, '2026-07-14');
  assert.equal(mocResult.collectionContext.submittedTo, '2026-10-12');
  assert.ok(!JSON.stringify(mocResult).includes('PRIVATE'));
  // One plain code and four PMCN-labelled codes must all remain valid.
  await moc.evaluate(() => {
    const original = document.querySelector('mat-row');
    for (let i = 1; i <= 4; i++) {
      const row = original.cloneNode(true); row.dataset.pmcnFixture = 'true';
      const cell = row.querySelectorAll('mat-cell')[1];
      cell.textContent = '';
      const link = document.createElement('a');
      link.append(document.createTextNode(`H29.154-261010-17000${i}`));
      const label = document.createElement('span'); label.textContent = ' (Hồ sơ của PMCN)'; link.append(label);
      const privateSibling = document.createElement('span'); privateSibling.textContent = 'PRIVATE';
      for (const key of ['innerText', 'textContent']) Object.defineProperty(privateSibling, key, { get() { throw new Error('Code-cell sibling must not be read'); } });
      cell.append(link, privateSibling); original.parentElement.append(row);
    }
  });
  const pmcnResult = await readMoc();
  assert.equal(pmcnResult.total, 5);
  assert.equal(pmcnResult.records.length, 5, JSON.stringify(pmcnResult.errors));
  assert.equal(pmcnResult.errors.length, 0);
  assert.equal(pmcnResult.records[1].caseCode, 'H29.154-261010-170001');
  assert.ok(!JSON.stringify(pmcnResult.records).includes('PMCN'));
  await moc.evaluate(() => document.querySelectorAll('[data-pmcn-fixture]').forEach(node => node.remove()));
  // Public MOC template uses native table with Material cells. Exercise alternate
  // wrappers, sort decorations and per-row column order without reading applicant cells.
  await moc.evaluate(() => {
    const ids = ['select', 'code', 'procedureName', 'processingTime', 'applicantName', 'agency', 'status', 'action'];
    document.querySelector('.searchtbl-allAgency').className = 'alternate-layout';
    document.querySelectorAll('mat-header-cell').forEach((node, index) => {
      node.classList.add(`mat-column-${ids[index]}`);
      const icon = document.createElement('span'); icon.textContent = ' sort'; node.append(icon);
    });
    document.querySelectorAll('mat-row mat-cell').forEach((node, index) => node.classList.add(`mat-column-${ids[index]}`));
    const row = document.querySelector('mat-row');
    row.prepend(row.querySelector('.mat-column-agency'));
    const old = document.querySelector('mat-table');
    const table = document.createElement('table');
    table.append(...old.childNodes); old.replaceWith(table);
  });
  const nativeMoc = await readMoc();
  assert.equal(nativeMoc.ok, true, nativeMoc.error);
  assert.equal(nativeMoc.records.length, 1, JSON.stringify(nativeMoc.errors));
  assert.equal(nativeMoc.records[0].agencyName, 'Đơn vị kiểm thử');
  assert.ok(!JSON.stringify(nativeMoc).includes('PRIVATE'));
  await moc.evaluate(() => {
    const table = document.querySelector('table'), replacement = document.createElement('mat-table');
    replacement.append(...table.childNodes); table.replaceWith(replacement);
    const row = document.querySelector('mat-row');
    row.insertBefore(row.querySelector('.mat-column-agency'), row.querySelector('.mat-column-status'));
  });
  await moc.locator('h2').evaluate(node => { node.hidden = true; });
  assert.equal((await readMoc()).ok, false);
  await moc.locator('h2').evaluate(node => { node.hidden = false; });
  await moc.locator('mat-table').evaluate(node => { node.setAttribute('aria-busy', 'true'); });
  assert.match((await readMoc()).error, /đang tải/);
  await moc.locator('mat-table').evaluate(node => { node.removeAttribute('aria-busy'); });
  await moc.locator('mat-header-cell').nth(3).evaluate(node => { node.hidden = true; });
  const missingHeader = await readMoc();
  assert.equal(missingHeader.ok, false);
  assert.match(missingHeader.error, /thiếu Thời gian quy định/);
  assert.ok(!missingHeader.error.includes('PRIVATE'));
  await moc.locator('mat-header-cell').nth(3).evaluate(node => { node.hidden = false; });
  await moc.locator('mat-row mat-cell').nth(3).evaluate(node => { node.hidden = true; });
  assert.equal((await readMoc()).errors.length, 1);
  await moc.locator('mat-row mat-cell').nth(3).evaluate(node => { node.hidden = false; });
  await moc.locator('mat-table').evaluate(node => { node.parentElement.append(node.cloneNode(true)); });
  assert.equal((await readMoc()).ok, false);
  await moc.locator('mat-table').last().evaluate(node => { node.remove(); });
  await moc.locator('mat-row').evaluate(node => { node.hidden = true; });
  assert.match((await readMoc()).emptyMessage, /1 dòng dữ liệu đang bị ẩn/);
  await moc.locator('mat-row').evaluate(node => { node.hidden = false; });
  await moc.locator('mat-row').evaluate(node => { node.remove(); });
  assert.equal((await readMoc()).total, 0);
  assert.match((await readMoc()).emptyMessage, /bảng không có dòng dữ liệu/);
  const options = await browser.newPage();
  options.on('pageerror', error => errors.push(error.message));
  await options.route('https://extension.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const file = new URL(`../extension${pathname}`, import.meta.url);
    const contentType = pathname.endsWith('.mjs') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html';
    return route.fulfill({ contentType, body: readFileSync(file) });
  });
  await options.addInitScript(() => {
    globalThis.savedConfigurations = {};
    globalThis.chrome = { runtime: { sendMessage: async message => {
      if (message.type === 'GET_STATE') return { ok: true, configurations: savedConfigurations };
      if (message.type === 'SAVE_ADAPTER_CONFIG') {
        savedConfigurations[message.config.sourceSystem] = message.config; return { ok: true };
      }
      throw new Error('Unexpected message');
    } } };
  });
  await options.goto('https://extension.test/options/index.html');
  await options.locator('#source option').last().waitFor({ state: 'attached' });
  assert.equal(await options.locator('#source option').count(), 11);
  await options.selectOption('#source', 'MOC');
  assert.equal(await options.inputValue('#listUrl'), 'https://motcuabxd.moc.gov.vn/vi/dossier/search');
  for (const [id, value] of Object.entries({ loggedInSelector: '#synthetic-login', tableSelector: '#synthetic-table',
    headerSelector: 'thead th', rowSelector: 'tbody tr', cellSelector: 'td', reference: 'SYNTHETIC UI TEST ONLY' })) await options.locator(`#${id}`).fill(value);
  await options.locator('#mapping-rows input').fill('Code');
  await options.locator('#verified').check();
  await options.locator('#guided button[type=submit]').click();
  await options.waitForFunction(() => document.getElementById('guided-status').textContent.includes('Đã lưu MOC'));
  await options.selectOption('#source', 'MOH');
  assert.equal(await options.inputValue('#tableSelector'), '');
  await options.selectOption('#source', 'MOC');
  assert.equal(await options.inputValue('#tableSelector'), '#synthetic-table');
  assert.equal(await options.locator('#verified').isChecked(), false);
  assert.equal(await options.evaluate(() => savedConfigurations.MOC.headerMappings.Code), 'caseCode');
  const popup = await browser.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  await popup.route('https://extension.test/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: pathname.endsWith('.mjs') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html',
      body: readFileSync(new URL(`../extension${pathname}`, import.meta.url)) });
  });
  await popup.addInitScript(() => {
    let configured = false;
    let job = null, attempt = null;
    globalThis.activationCalls = 0;
    globalThis.chrome = { tabs: { query: async () => [{ id: 7 }] }, runtime: { sendMessage: async message => {
      if (message.type === 'GET_STATE') return { ok: true, portal: { id: 'MOC', name: 'Bộ Xây dựng', configured }, hasCollectorToken: false,
        automaticConnection: true, syncJob: job, syncAttempt: attempt };
      if (message.type === 'START_SYNC') {
        attempt = { status: 'PREPARING', message: 'Đang kết nối Dashboard…' };
        return new Promise(resolve => { globalThis.finishSave = () => {
          attempt = null; job = { status: 'SYNC_SUCCESS', sourceSystem: 'MOC', total: 4, created: 4, updated: 0, skipped: 0, failed: 0, errors: [] };
          resolve({ ok: true });
        }; });
      }
      if (message.type === 'VIEW_SAVED_CASES') { globalThis.viewedSavedCases = true; return { ok: true }; }
      if (message.type === 'ENABLE_MOC_PROFILE') {
        if (!message.confirmed || message.tabId !== 7) throw new Error('Missing user confirmation');
        activationCalls++; configured = true;
        return { ok: true, sourceSystem: 'MOC', total: 1, valid: 1, records: [{ caseCode: 'SYNTHETIC-00102' }], errors: [] };
      }
      throw new Error('Unexpected popup message');
    } } };
  });
  await popup.goto('https://extension.test/popup/index.html');
  await popup.locator('#moc-setup').waitFor({ state: 'visible' });
  await popup.locator('#moc-setup button').click();
  assert.equal(await popup.evaluate(() => activationCalls), 0);
  await popup.locator('#moc-confirm').check();
  await popup.locator('#moc-setup button').click();
  await popup.locator('#moc-setup').waitFor({ state: 'hidden' });
  assert.equal(await popup.evaluate(() => activationCalls), 1);
  assert.match(await popup.locator('#preview-result').innerText(), /SYNTHETIC-00102/);
  assert.equal(await popup.locator('#preview').isEnabled(), true);
  assert.equal(await popup.locator('#sync').isEnabled(), true, 'automatic connection allows writing without pasting a token');
  await popup.locator('#sync').click();
  assert.equal(await popup.locator('#sync').isEnabled(), false);
  assert.match(await popup.locator('#save-status').innerText(), /Đang/);
  assert.equal(await popup.locator('#preview-result').innerText(), '');
  await popup.evaluate(() => finishSave());
  await popup.locator('#view-dashboard').waitFor({ state: 'visible' });
  assert.match(await popup.locator('#save-status').innerText(), /4 hồ sơ mới/);
  await popup.locator('#view-dashboard').click();
  assert.equal(await popup.evaluate(() => viewedSavedCases), true);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic Chrome: generic/MOC DOM, combined dates, PII excluded, hidden/loading/duplicate tables, per-source options and MOC popup activation. No live authenticated portal acceptance claimed.');
} finally { await browser.close(); }
