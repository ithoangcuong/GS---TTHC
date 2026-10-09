// Read-only check of the deployed account login page. Never submits credentials.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const propertiesPath = resolve('data/admin-bootstrap-private/script-properties.txt');
const configuredUrl = existsSync(propertiesPath)
  ? readFileSync(propertiesPath, 'utf8').match(/^WEB_APP_URL\s*=\s*(\S+)\s*$/m)?.[1]
  : '';
const url = process.argv.find(argument => argument.startsWith('--url='))?.slice(6) || process.env.TTHC_WEB_APP_URL || configuredUrl;
assert.match(url || '', /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/, 'Pass --url=<deployed /exec URL> or set TTHC_WEB_APP_URL.');
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
assert.ok(executablePath, 'Chrome/Edge or BROWSER_PATH is required.');
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const page = await context.newPage();
  const exceptions = [];
  page.on('pageerror', error => exceptions.push(error.name));
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  let loginFrame;
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const frame of page.frames()) {
      if (await frame.locator('#account-login').count()) { loginFrame = frame; break; }
    }
    if (loginFrame) break;
    await page.waitForTimeout(500);
  }
  assert.ok(loginFrame, 'The deployed page did not render the TTHC account login form.');
  const config = await loginFrame.evaluate(() => new Promise(resolveConfig => {
    const timeout = setTimeout(() => resolveConfig({ probeError: 'RPC_TIMEOUT' }), 15000);
    google.script.run.withSuccessHandler(result => {
      clearTimeout(timeout);
      const data = result && result.data;
      resolveConfig(result && result.ok && data ? {
        configured: data.configured,
        setupIssues: Array.isArray(data.setupIssues) ? data.setupIssues.map(issue => ({ property: issue.property, reason: issue.reason })) : null,
      } : { probeError: result?.error?.code || 'RPC_FAILED' });
    }).withFailureHandler(() => { clearTimeout(timeout); resolveConfig({ probeError: 'RPC_CONNECTION_ERROR' }); }).rpc('auth.config', {}, '');
  }));
  const report = {
    checkedAt: new Date().toISOString(),
    httpStatus: response?.status(),
    loginVisible: await loginFrame.locator('#account-login').isVisible(),
    loginEnabled: await loginFrame.locator('#account-login').isEnabled(),
    usernameVisible: await loginFrame.locator('#login-form [name=username]').isVisible(),
    passwordVisible: await loginFrame.locator('#login-form [name=password][type=password]').isVisible(),
    googleLoginButtons: await loginFrame.locator('#google-login').count(),
    ...config,
    loginOrigin: new URL(loginFrame.url()).origin,
    javascriptErrors: exceptions,
    accountLoginVerified: false,
  };
  const output = resolve('data/preview');
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'apps-script-live-login.png'), fullPage: true });
  writeFileSync(resolve(output, 'admin-login-live-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.httpStatus, 200, 'Deployed Web App must return HTTP 200.');
  assert.deepEqual(exceptions, [], 'Deployed login page must have no JavaScript errors.');
  assert.ok(!report.probeError, 'Deployed auth.config RPC must respond.');
  if (process.argv.includes('--require-ready')) {
    assert.equal(report.configured, true, 'Admin login configuration is incomplete.');
    assert.equal(report.loginEnabled, true, 'Account login button must be enabled.');
    assert.equal(report.usernameVisible, true, 'Username field must be visible.');
    assert.equal(report.passwordVisible, true, 'Password field must be visible.');
    assert.equal(report.googleLoginButtons, 0, 'Account login must not render the removed Google flow.');
  }
} finally {
  await browser?.close();
}
