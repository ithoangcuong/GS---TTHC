import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { openDatabase } from '../server/database.mjs';
import { createApp } from '../server/app.mjs';
import { SheetPermissions } from '../server/sheet-permissions.mjs';

const candidates = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const executablePath = candidates.find(path => existsSync(path));
if (!executablePath) throw new Error('Cần Chrome/Edge/Chromium hoặc BROWSER_PATH.');
const spreadsheetId = '18AjwLQla8V88ANBKZHXHwNhmkrHvvgld3v3HeLna7BU';
const adminEmail = 'ithoangcuong@gmail.com';
const db = openDatabase(':memory:');
let readerCalls = 0;
let flushCalls = 0;
let grants = [
  { email: adminEmail, displayName: 'Quản trị kiểm thử', role: 'SYSTEM_ADMIN', scope: {}, active: true },
  { email: 'browser.viewer@example.com', displayName: 'Người xem kiểm thử', role: 'VIEWER', scope: { sourceSystems: ['TPHCM'] }, active: true },
];
const permissions = new SheetPermissions(db, { spreadsheetId, reader: { async read() { readerCalls++; return grants; } } });
await permissions.refresh();
const pending = new Map();
let origin;
let verifiedBrowserBinding = false;
let googleRequests = 0;
const googleOidc = {
  start() {
    const state = randomBytes(32).toString('base64url');
    const browserToken = randomBytes(32).toString('base64url');
    pending.set(state, browserToken);
    return { state, browserToken, authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${state}` };
  },
  async finish({ state, code, browserToken }) {
    const expected = pending.get(state); pending.delete(state);
    assert.ok(expected, 'The callback carries server-issued one-time state');
    assert.equal(code, 'browser-simulated-code');
    assert.equal(browserToken, expected, 'The browser returns the HttpOnly Google cookie across the redirect');
    verifiedBrowserBinding = true;
    return { sub: 'browser-google-subject', email: adminEmail, displayName: 'Simulated Google profile' };
  },
};
const sheetStore = { async flush() { flushCalls++; }, status() {
  return { provider: 'google_sheets', enabled: true, ready: true, spreadsheetId, tab: 'GS_Data', pendingEvents: 0, lastCommittedAt: Date.now(), lastError: null };
} };
const server = createApp(db, { authMode: 'google', googleOidc, permissions, sheetStore, background: false, allowAnyHost: true });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(10000);
  const exceptions = [];
  page.on('pageerror', error => exceptions.push(error.message));
  await page.route('https://accounts.google.com/**', async route => {
    googleRequests++;
    const url = new URL(route.request().url());
    assert.equal(url.pathname, '/o/oauth2/v2/auth');
    const state = url.searchParams.get('state');
    assert.ok(pending.has(state));
    await route.fulfill({ status: 302, headers: { location: `${origin}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=browser-simulated-code` }, body: '' });
  });
  async function ready() {
    await page.locator('#page-content h1').waitFor();
    await page.waitForFunction(() => !document.querySelector('.loading-state'));
    assert.equal(await page.locator('#retry').count(), 0);
  }
  const preview = resolve('data/preview'); mkdirSync(preview, { recursive: true });
  await page.goto(`${origin}/login`);
  await page.getByRole('link', { name: 'Đăng nhập bằng Google' }).waitFor();
  assert.equal(await page.locator('[name=username], [name=password]').count(), 0);
  await page.screenshot({ path: resolve(preview, 'google-login.png'), fullPage: true });
  await page.getByRole('link', { name: 'Đăng nhập bằng Google' }).click();
  await ready();
  assert.equal(new URL(page.url()).pathname, '/dashboard');
  assert.equal(googleRequests, 1);
  assert.equal(verifiedBrowserBinding, true);
  assert.ok(flushCalls > 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
  assert.equal(db.prepare('SELECT email FROM users WHERE googleSubject=?').get('browser-google-subject').email, adminEmail);
  const sessionCookie = (await page.context().cookies()).find(cookie => cookie.name === 'gs_session');
  assert.ok(sessionCookie?.httpOnly);
  await page.goto(`${origin}/admin/users`); await ready();
  assert.equal(await page.getByRole('heading', { name: 'Phân quyền trên Google Sheet', exact: true }).count(), 1);
  assert.match(await page.locator('#page-content').innerText(), new RegExp(adminEmail.replaceAll('.', '\\.')));
  const openSheet = page.getByRole('link', { name: 'Mở Google Sheet', exact: true });
  assert.equal(await openSheet.getAttribute('href'), `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
  assert.equal(await openSheet.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await page.locator('#user-form, [data-edit-user], #user-editor').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).count(), 0);
  assert.equal(await page.locator('#refresh-sheet-permissions').count(), 1);
  const before = readerCalls;
  const [refresh] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/permissions/refresh' && response.request().method() === 'POST'),
    page.locator('#refresh-sheet-permissions').click(),
  ]);
  assert.equal(refresh.status(), 200, 'The browser sends the session CSRF token to the real refresh API');
  assert.equal(readerCalls, before + 1);
  await ready();
  await page.screenshot({ path: resolve(preview, 'google-permissions.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The Sheet permissions page fits a 390px viewport');
  await page.locator('#menu-toggle').click();
  assert.equal(await page.locator('.sidebar').evaluate(element => element.classList.contains('open')), true);
  await page.locator('#menu-toggle').click();
  grants = grants.map(row => row.email === adminEmail ? { ...row, active: false } : row);
  await permissions.refresh();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  await page.goto(`${origin}/dashboard`);
  await page.getByRole('link', { name: 'Đăng nhập bằng Google' }).waitFor();
  assert.equal(await page.locator('#page-content').count(), 0);
  assert.equal(await page.locator('[name=username], [name=password]').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Google login fits a 390px viewport');
  assert.deepEqual(exceptions, []);
  console.log('Google browser PASS: simulated Google redirects with real browser cookies and app APIs; Sheet grants, CSRF refresh, durable flush, revocation, responsive 390px; no JavaScript errors. No live Google account or Sheet accessed. Screenshots: data/preview/google-login.png, data/preview/google-permissions.png.');
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
  db.close();
}
