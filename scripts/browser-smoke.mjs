import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { openDatabase } from '../server/database.mjs';
import { createUser } from '../server/auth.mjs';
import { createApp } from '../server/app.mjs';
import { seedDemo } from '../server/seed.mjs';

const paths = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const executablePath = paths.find(path => existsSync(path));
if (!executablePath) throw new Error('Cần Chrome/Edge/Chromium hoặc BROWSER_PATH.');
const allocator = createServer(); allocator.listen(0, '127.0.0.1'); await once(allocator, 'listening');
const port = allocator.address().port; await new Promise(done => allocator.close(done));
const origin = `http://127.0.0.1:${port}`; const db = openDatabase(':memory:');
const password = randomBytes(18).toString('base64url');
const admin = await createUser(db, { username: 'browser.admin', displayName: 'Browser smoke', password, role: 'SYSTEM_ADMIN', scope: {} });
seedDemo(db, admin);
const server = createApp(db, { origin, background: false }); server.listen(port, '127.0.0.1'); await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(10000); const exceptions = []; page.on('pageerror', error => exceptions.push(error.message));
  async function ready() { await page.locator('#page-content h1').waitFor(); await page.waitForFunction(() => !document.querySelector('.loading-state')); }
  async function route(path) { await page.goto(`${origin}${path}`); await ready(); assert.equal(await page.locator('#retry').count(), 0, `Broken route ${path}`); }
  await page.goto(`${origin}/login`);
  await page.locator('[name=username]').fill('browser.admin'); await page.locator('[name=password]').fill(password); await page.locator('#login-form button').click();
  await ready(); assert.match(await page.locator('#page-content').innerText(), /CHẾ ĐỘ DEMO/);
  await page.locator('[name=sourceSystem]').selectOption('MOC'); await page.locator('#filters-form button[type=submit]').click(); await ready();
  assert.equal(new URL(page.url()).searchParams.get('sourceSystem'), 'MOC');
  await page.locator('a[data-nav][href*="risk=high"]').first().click(); await ready();
  assert.equal(new URL(page.url()).pathname, '/cases'); assert.equal(new URL(page.url()).searchParams.get('sourceSystem'), 'MOC');
  assert.equal(await page.locator('tbody tr').count(), 1); await page.locator('tbody a[data-nav]').first().click(); await ready();
  assert.match(await page.locator('#page-content').innerText(), /DEMO-MOC/);
  for (const path of ['/alerts', '/sources', '/sources/MOC', '/agencies', '/departments', '/officers', '/procedures', '/reports', '/settings', '/admin/users', '/admin/roles', '/audit-logs', '/sync', '/notifications']) await route(path);
  await route('/import');
  const buffer = Buffer.from('caseCode,dueAt,normalizedStatus,officerName\nBROWSER-IMPORT,2026-10-08T09:00:00+07:00,PROCESSING,Can bo browser\n');
  await page.locator('#import-file').setInputFiles({ name: 'browser.csv', mimeType: 'text/csv', buffer }); await page.locator('#import-upload-form button').click();
  await page.locator('[data-import-step="2"]').click();
  await page.locator('#import-mapping-form').waitFor(); await page.locator('#import-mapping-form [name=sourceSystem]').selectOption('MOC');
  for (const [index, field] of ['caseCode', 'dueAt', 'normalizedStatus', 'officerName'].entries()) await page.locator(`[name=column-${index}]`).selectOption(field);
  await page.locator('#import-mapping-form button[type=submit]').click(); await page.locator('#import-commit-form').waitFor();
  await page.locator('#import-commit-form input[type=checkbox]').check();
  await page.locator('#import-commit-form button[type=submit]').click(); await page.locator('#new-import').waitFor();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM cases WHERE caseCode='BROWSER-IMPORT'").get().n, 1);
  await route('/dashboard?sourceSystem=MOC'); const preview = resolve('data/preview'); mkdirSync(preview, { recursive: true });
  await page.screenshot({ path: resolve(preview, 'dashboard.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#menu-toggle').click(); assert.equal(await page.locator('.sidebar').evaluate(element => element.classList.contains('open')), true);
  await page.locator('.sidebar a[href^="/dashboard"]').first().click(); await ready();
  await page.screenshot({ path: resolve(preview, 'mobile.png'), fullPage: false });
  assert.deepEqual(exceptions, []);
  console.log('Browser PASS: login, MOC filter, risk drilldown, detail, 14 routes, CSV import, responsive 390px; no JavaScript errors. Screenshots: data/preview/.');
} finally {
  await browser?.close(); await new Promise(done => server.close(done)); db.close();
}
