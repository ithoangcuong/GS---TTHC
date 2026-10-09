// Verify the issued admin on the real deployment without consuming its first-use change.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const credentials = JSON.parse(readFileSync('data/account-bootstrap-private/credentials.json', 'utf8'));
const url = readFileSync('data/admin-bootstrap-private/script-properties.txt', 'utf8').match(/^WEB_APP_URL\s*=\s*(\S+)\s*$/m)?.[1];
assert.match(url || '', /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Chrome/Edge or BROWSER_PATH is required.');
const browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  let frame;
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const candidate of page.frames()) {
      if (await candidate.locator('#account-login').count()) { frame = candidate; break; }
    }
    if (frame) break;
    await page.waitForTimeout(500);
  }
  assert.ok(frame && await frame.locator('#account-login').count(), 'Account login form not rendered.');
  await frame.locator('#account-login').waitFor({ state: 'visible', timeout: 30000 });
  await frame.locator('#login-form input[name="username"]').fill(credentials.username);
  await frame.locator('#login-form input[name="password"]').fill(credentials.adminPassword);
  await frame.locator('#account-login').click();
  await frame.locator('#password-form').waitFor({ state: 'visible', timeout: 90000 });
  const verification = await frame.evaluate(() => new Promise(resolveResult => {
    const token = sessionStorage.getItem('tthc.dashboard.session');
    const timeout = setTimeout(() => resolveResult({ failure: 'RPC_TIMEOUT' }), 30000);
    const call = (action, done) => google.script.run.withSuccessHandler(done).withFailureHandler(() => { clearTimeout(timeout); resolveResult({ failure: 'RPC_TRANSPORT' }); }).rpc(action, {}, token);
    call('auth.session', session => {
      if (!session.ok) { clearTimeout(timeout); resolveResult({ failure: session.error?.code || 'SESSION_FAILED' }); return; }
      call('dashboard.summary', dashboard => {
        clearTimeout(timeout);
        resolveResult({ username: session.data.user.username, role: session.data.user.role, mustChangePassword: session.data.mustChangePassword, restrictedBusinessCode: dashboard.error?.code, businessAllowed: dashboard.ok });
      });
    });
  }));
  assert.equal(verification.username, credentials.username);
  assert.equal(verification.role, 'SUPER_ADMIN');
  assert.equal(verification.mustChangePassword, true);
  assert.equal(verification.businessAllowed, false);
  assert.equal(verification.restrictedBusinessCode, 'PASSWORD_CHANGE_REQUIRED');
  assert.deepEqual(errors, []);
  mkdirSync(resolve('data/preview'), { recursive: true });
  await page.screenshot({ path: resolve('data/preview/account-admin-first-login-live.png'), fullPage: true });
  await frame.locator('#password-logout').click();
  await frame.locator('#account-login').waitFor({ state: 'visible', timeout: 30000 });
  const report = { checkedAt: new Date().toISOString(), httpStatus: response?.status(), actualAdminLoginVerified: true, firstUsePasswordChangePreserved: true, logoutVerified: true, ...verification, javascriptErrors: errors };
  writeFileSync(resolve('data/preview/account-admin-live-login-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
