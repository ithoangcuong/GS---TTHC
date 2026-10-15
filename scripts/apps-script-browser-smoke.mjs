// Local verification only. Accounts and business data are synthetic;
// production HTML, GAS business rules and the bundled AES-SIV cipher run unchanged.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInContext } from 'node:vm';
import { chromium } from 'playwright-core';
import { gasRuntime } from '../tests/helpers/apps-script.mjs';

const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
if (!executablePath) throw new Error('Cần Edge / Chrome / Chromium hoặc biến BROWSER_PATH.');
const names = readdirSync('apps-script').filter(name => name.endsWith('.gs')).map(name => name.slice(0, -3));
for (const name of ['Auth', 'Cases', 'Dashboard', 'Reports', 'Alerts', 'Router', 'Code']) assert.ok(names.includes(name), `Missing GAS module ${name}`);
const first = ['Utils', 'Crypto', 'Passwords', 'SheetRepository', 'Settings', 'Permissions', 'Users', 'Sources', 'Audit', 'Deadline'];
const modules = [...first, ...names.filter(name => !first.includes(name) && name !== 'Setup'), 'Setup'];
const gas = gasRuntime(modules, { GOOGLE_CLIENT_ID: 'SYNTHETIC_BROWSER_CLIENT', GOOGLE_CLIENT_SECRET: 'SYNTHETIC_BROWSER_SECRET', WEB_APP_URL: 'https://script.google.com/macros/s/SYNTHETIC_BROWSER_DEPLOYMENT/exec' });
gas.properties.set('RECOVERY_EMAIL_ENABLED','true');
const evaluate = source => runInContext(source, gas.context);
const call = (action, payload = {}, token = '') => gas.plain(evaluate(`rpc(${JSON.stringify(action)},${JSON.stringify(payload)},${JSON.stringify(token)})`));
evaluate('setupTthcMonitor_()');
evaluate('bootstrapAdmin_()');
const at = Date.now();
const iso = offset => new Date(at + offset * 3600000).toISOString();
const fixtureRows = [];
for (const [sourceSystem, count] of [['TPHCM', 62], ['MOF', 6]]) {
  for (let index = 0; index < count; index++) {
    const completed = sourceSystem === 'TPHCM' && index >= 56;
    const status = completed ? 'COMPLETED' : index === 55 ? 'WAITING_ADDITIONAL_DOCUMENTS' : 'PROCESSING';
    fixtureRows.push({
      sourceSystem, caseCode: `SYNTHETIC-${sourceSystem}-${String(index + 1).padStart(3, '0')}`,
      procedureCode: 'SYNTHETIC-PROCEDURE', procedureName: 'SYNTHETIC Thủ tục kiểm thử',
      agencyName: 'SYNTHETIC AGENCY', departmentName: 'SYNTHETIC UNIT',
      officerName: index % 2 ? 'SYNTHETIC OFFICER B' : 'SYNTHETIC OFFICER A',
      normalizedStatus: status, sourceStatus: status, submittedAt: iso(-120), receivedAt: iso(-100),
      originalDueAt: completed ? iso(-20) : index < 10 ? iso(-index - 1) : index < 20 ? iso(index - 9) : iso(96 + index),
      ...(completed ? { completedAt: index % 2 ? iso(-19) : iso(-21) } : {}),
      lastObservedAt: iso(index % 4 === 0 ? -30 : -1), currentStep: 2, totalSteps: 5,
    });
  }
}
evaluate(`(() => {
  const input=${JSON.stringify(fixtureRows)}, now=Date.now(), settings=TTHC.Settings.get();
  const syntheticStatuses=['PROCESSING','COMPLETED','WAITING_ADDITIONAL_DOCUMENTS'];
  const confirmedSyntheticMappingRows=['TPHCM','MOF'].flatMap(source=>syntheticStatuses.map(status=>({mapping_id:'synthetic-'+source+'-'+status,source_id:source,source_status:status,normalized_status:status,confirmed:true,updated_at:new Date(now).toISOString()})));
  TTHC.Repo.writeBatch('STATUS_MAPPING',confirmedSyntheticMappingRows,'mapping_id');
  const mappingTables={STATUS_MAPPING:TTHC.Repo.read('STATUS_MAPPING'),SOURCE_MAPPING:[]};
  const records=input.map((raw,i)=>Object.assign(TTHC.Cases.normalize(raw,raw.sourceSystem,TTHC.Cases.configurations(mappingTables,raw.sourceSystem),now),{id:'synthetic-case-'+String(i+1).padStart(3,'0'),createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),lastSyncedAt:new Date(now).toISOString()}));
  const encrypted=TTHC.Crypto.encryptMany(records);
  const rows=records.map((record,i)=>TTHC.Cases.rowFor(record,null,encrypted[i],settings,now));
  TTHC.Repo.writeBatch('CASES',rows,'record_id');
  const sources=TTHC.Repo.read('SOURCES').map(source=>Object.assign({},source,source.source_id==='TPHCM'||source.source_id==='MOF'?{last_observed_at:new Date(now-3600000).toISOString(),last_synced_at:new Date(now).toISOString(),synced_count:source.source_id==='TPHCM'?62:6}:{}));
  TTHC.Repo.writeBatch('SOURCES',sources,'source_id');
  TTHC.Repo.writeBatch('ALERTS',TTHC.Alerts.prepare(records,[],settings,now),'alert_id');
})()`);


const requests = [];
let failNextAction = '';
let html = readFileSync('apps-script/Index.html', 'utf8')
  .replace(/<\?!=\s*TTHC\.View\.include\('Styles'\);\s*\?>/, readFileSync('apps-script/Styles.html', 'utf8'))
  .replace(/<\?!=\s*TTHC\.View\.include\('Scripts'\);\s*\?>/, readFileSync('apps-script/Scripts.html', 'utf8'));
assert.ok(!html.includes('<?'), 'All GAS template includes must be expanded');
const bridge = '<script>window.google={script:{url:{getLocation(callback){callback({parameter:Object.fromEntries(new URLSearchParams(location.search))});}},run:{withSuccessHandler(success){const api={withFailureHandler(failure){api.failure=failure;return api;},rpc(action,payload,token){fetch("/__rpc",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,payload,token})}).then(response=>response.json()).then(success).catch(error=>api.failure&&api.failure(error));}};return api;}}}};</script>';
const ribbon = '<div style="position:fixed;bottom:0;left:0;right:0;z-index:200;background:#572d70;color:white;text-align:center;font:11px Arial;padding:4px;pointer-events:none">SYNTHETIC LOCAL HARNESS ? No live accounts / portal / Sheets data</div>';
async function requestBody(request) { let text = ''; for await (const chunk of request) { text += chunk; if (text.length > 1024 * 1024) throw new Error('Test request too large'); } return text ? JSON.parse(text) : {}; }
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/__rpc') {
      const body = await requestBody(request); requests.push({ action: body.action, authenticated: Boolean(body.token) });
      let result;
      if (body.action === failNextAction) { failNextAction = ''; result = { ok: false, error: { code: 'SYNTHETIC_TRANSIENT', message: 'SYNTHETIC lỗi kết nối; thử lại.', requestId: 'synthetic-request-error' } }; }
      else result = call(body.action, body.payload, body.token);
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
    }
    if (url.pathname === '/__control') {
      const body = await requestBody(request);
      if (body.failNextAction !== undefined) failNextAction = body.failNextAction;
      if (body.missingConfig !== undefined) {
        if (body.missingConfig) gas.properties.delete('SPREADSHEET_ID'); else gas.properties.set('SPREADSHEET_ID', 'SYNTHETIC_SHEET_123456');
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}'); return;
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html.replace('<body>', '<body>' + (url.searchParams.get('bridge') === 'missing' ? '' : bridge) + ribbon));
  } catch (error) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ message: error.message })); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true, timeout: 20000 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
  await context.route('https://accounts.google.com/**', () => { throw new Error('Password login must never open Google OAuth'); });
  const page = await context.newPage();
  const exceptions = []; page.on('pageerror', error => exceptions.push(error.message));
  page.setDefaultTimeout(15000);
  const passwords = { admin: gas.properties.get('BOOTSTRAP_PASSWORD'), viewer: gas.properties.get('DEFAULT_USER_PASSWORD') };
  async function settled() { await page.waitForFunction(() => { const content=document.querySelector('#page-content'); return content&&content.getAttribute('aria-busy')==='false'&&content.dataset.routeKey===(location.hash||'#dashboard')&&!document.querySelector('[data-api-pending="true"]'); }); }
  async function ready() { await settled(); await page.locator('#page-content h1').waitFor(); assert.equal(await page.locator('.error-request').count(), 0, await page.locator('#page-content').innerText()); }
  async function mobileMenuClosed() { await page.waitForFunction(() => { const sidebar=document.querySelector('.sidebar'); return sidebar&&!sidebar.classList.contains('open')&&sidebar.getBoundingClientRect().right<=1; }); }
  async function route(path, expectError = false) { await page.evaluate(hash => { location.hash = hash; }, path); if (expectError) { await settled(); await page.locator('#page-content .empty-state').waitFor(); } else await ready(); }
  async function control(value) { await page.evaluate(async body => { const response = await fetch('/__control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error('Harness control failed'); }, value); }
  async function fillLogin(username, password) { await page.locator('#login-form [name=username]').fill(username); await page.locator('#login-form [name=password]').fill(password); await page.locator('#account-login').click(); }
  async function savePassword(currentPassword, newPassword) {
    await page.locator('#password-form [name=currentPassword]').fill(currentPassword);
    await page.locator('#password-form [name=newPassword]').fill(newPassword);
    await page.locator('#password-form [name=confirmPassword]').fill(newPassword);
    await page.locator('#password-form [type=submit]').click();
    await ready();
  }
  async function login(username) {
    await fillLogin(username, passwords[username]);
    await page.waitForFunction(() => document.querySelector('#password-form') || document.querySelector('.sidebar'));
    if (await page.locator('#password-form').count()) {
      const next = 'SYNTHETIC-browser-changed-' + username + '-2026!';
      await savePassword(passwords[username], next); passwords[username] = next;
    } else await ready();
  }
  async function logout() { await page.locator('#account-switch').click(); await page.locator('#account-login').waitFor(); }
  async function loginRegression() {
    await page.goto(origin); await page.locator('#account-login').waitFor();
    assert.equal(await page.locator('#google-login, input[type=email]').count(), 0);
    assert.equal(await page.locator('#login-form [name=password]').getAttribute('type'), 'password');
    assert.equal(await page.locator('#login-form [name=password]').getAttribute('autocomplete'), 'current-password');
    await control({ missingConfig: true }); await page.reload(); await page.locator('#account-login').waitFor();
    assert.equal(await page.locator('#account-login').isDisabled(), true);
    await page.locator('.login-setup summary').click();
    assert.match(await page.locator('.login-setup').innerText(), /SPREADSHEET_ID/);
    const attempts = requests.filter(request => request.action === 'auth.login').length;
    await page.locator('#login-form').dispatchEvent('submit');
    assert.equal(requests.filter(request => request.action === 'auth.login').length, attempts);
    await control({ missingConfig: false }); await page.reload(); await page.locator('#account-login').waitFor();
    assert.equal(await page.locator('#account-login').isEnabled(), true);
    await fillLogin('admin', 'SYNTHETIC-wrong-password'); await page.waitForFunction(() => document.querySelector('#login-error')?.textContent.length);
    assert.equal(await page.locator('#login-form [name=password]').inputValue(), '');
    await fillLogin('admin', passwords.admin); await page.locator('#password-form').waitFor();
    assert.equal(await page.locator('#cancel-password-change').count(), 0);
    const firstToken = await page.evaluate(() => sessionStorage.getItem('tthc.dashboard.session'));
    assert.equal(call('users.list', {}, firstToken).error.code, 'PASSWORD_CHANGE_REQUIRED');
    const businessRequests = requests.filter(request => !request.action.startsWith('auth.')).length;
    await page.evaluate(() => { location.hash = '#users'; });
    await page.locator('#password-form').waitFor();
    assert.equal(requests.filter(request => !request.action.startsWith('auth.')).length, businessRequests);
    await page.locator('#password-form [name=currentPassword]').fill(passwords.admin);
    await page.locator('#password-form [name=newPassword]').fill('SYNTHETIC-browser-changed-admin-2026!');
    await page.locator('#password-form [name=confirmPassword]').fill('SYNTHETIC-mismatch-password');
    const changes = requests.filter(request => request.action === 'auth.changePassword').length;
    await page.locator('#password-form [type=submit]').click();
    assert.ok((await page.locator('#password-error').innerText()).length > 0);
    assert.equal(requests.filter(request => request.action === 'auth.changePassword').length, changes);
    await page.evaluate(() => { location.hash = '#dashboard'; });
    const next = 'SYNTHETIC-browser-changed-admin-2026!'; await savePassword(passwords.admin, next); passwords.admin = next;
    const changedToken = await page.evaluate(() => sessionStorage.getItem('tthc.dashboard.session'));
    assert.notEqual(changedToken, firstToken);
    assert.equal(call('auth.session', {}, firstToken).error.code, 'AUTH_REQUIRED');
    assert.equal(await page.locator('input[type=password]').count(), 0);
    assert.ok(!JSON.stringify(await page.evaluate(() => ({ local: {...localStorage}, session: {...sessionStorage} }))).includes(next));
    await page.reload(); await ready();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tthc.dashboard.session')), changedToken);
    await page.locator('#account-password').click(); await page.locator('#cancel-password-change').click(); await ready();
  }
  async function issuanceRegression() {
    await route('#users');
    await page.locator('#user-form [name=username]').fill('viewer');
    await page.locator('#user-form [name=displayName]').fill('SYNTHETIC VIEWER');
    await page.locator('#user-form [name=role]').selectOption('VIEWER');
    const scope = { sources: ['TPHCM'], agencies: ['SYNTHETIC AGENCY'], departments: ['SYNTHETIC UNIT'], officers: ['SYNTHETIC OFFICER A'] };
    for (const [key, values] of Object.entries(scope)) await page.locator('#user-form [name=scope_' + key + ']').fill(values.join(','));
    await page.locator('#user-form [type=submit]').click(); await ready();
    await page.locator('#account-credentials').waitFor();
    assert.equal(await page.locator('#account-credentials [name=issuedUsername]').inputValue(), 'viewer');
    assert.equal(await page.locator('#account-credentials [name=defaultPassword]').inputValue(), gas.properties.get('DEFAULT_USER_PASSWORD'));
    assert.equal(await page.locator('#account-credentials [name=defaultPassword]').getAttribute('readonly'), '');
    const issued = gas.app.Users.byUsername('viewer');
    assert.equal(issued.role, 'VIEWER');
    assert.deepEqual(gas.plain(gas.app.Users.scope(issued)), scope);
    await page.locator('[data-clear-credentials]').click();
    await page.locator('[data-reset-password="' + issued.user_id + '"]').click();
    await page.locator('#account-credentials').waitFor();
    assert.equal(await page.locator('#account-credentials [name=defaultPassword]').inputValue(), gas.properties.get('DEFAULT_USER_PASSWORD'));
    await page.locator('[data-clear-credentials]').click();
    await route('#dashboard');
  }
  async function deniedLogin() {
    await fillLogin('unlisted.user', 'SYNTHETIC-wrong-password');
    await page.waitForFunction(() => document.querySelector('#login-error')?.textContent.length);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('tthc.dashboard.session')), null);
    assert.equal(await page.locator('.sidebar').count(), 0);
  }
  if (process.argv.includes('--auth-only')) {
    await loginRegression(); await issuanceRegression(); await logout(); await login('viewer');
    assert.equal(await page.locator('.sidebar a[href="#users"]').count(), 0);
    await logout(); await deniedLogin();
    assert.deepEqual(exceptions, []);
    assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
    console.log('Account browser PASS: username/password login, setup retry, generic denial, first-use change with no business access, confirmation guard, session rotation/restoration, ordinary change cancel, administrator issuance/default/reset, viewer restrictions and logout. Local GAS + bundled crypto fixtures only.');
  } else if (process.argv.includes('--targeted')) {
    await page.goto(origin); await page.locator('#account-login').waitFor(); await login('admin');
    const submittedDay = new Date(Date.parse(iso(-120)) + 7 * 3600000).toISOString().slice(0,10);
    await page.locator('[name=submittedFrom]').fill('1990-01-01');
    await page.locator('[name=submittedTo]').fill('1990-01-01');
    await page.locator('#filter-form [type=submit]').click(); await ready();
    assert.equal(await page.locator('.metric').first().locator('.metric-value').innerText(), '0');
    await page.locator('[name=submittedFrom]').fill(submittedDay);
    await page.locator('[name=submittedTo]').fill(submittedDay);
    await page.locator('#filter-form [type=submit]').click(); await ready();
    assert.notEqual(await page.locator('.metric').first().locator('.metric-value').innerText(), '0');
    await page.reload(); await ready();
    assert.equal(await page.locator('[name=submittedFrom]').inputValue(), submittedDay);
    assert.equal(await page.locator('[name=submittedTo]').inputValue(), submittedDay);
    assert.match(await page.locator('#page-content').innerText(),/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/,'Observed and deadline dates must use DD/MM/YYYY HH:mm:ss');
    const officer=page.locator('.bar-row[href*="officerKey="]').first();const officerKey=new URLSearchParams((await officer.getAttribute('href')).split('?')[1]).get('officerKey');assert.match(officerKey,/^[A-Za-z0-9_-]+$/);
    await officer.click();await ready();assert.ok(page.url().includes('officerKey='));assert.match(await page.locator('#page-content .notice').innerText(),/nhóm cán bộ/);
    assert.ok(page.url().includes('submittedFrom='+submittedDay) && page.url().includes('submittedTo='+submittedDay));
    const token=await page.evaluate(()=>sessionStorage.getItem('tthc.dashboard.session'));
    const selected=call('cases.list',{officerKey,page:1,pageSize:25},token);assert.equal(selected.ok,true);assert.equal(await page.locator('tbody tr').count(),selected.data.items.length);
    await page.locator('[name=sourceSystem]').selectOption('TPHCM');await page.locator('#filter-form [type=submit]').click();await ready();assert.ok(page.url().includes('officerKey=')&&page.url().includes('sourceSystem=TPHCM'));
    await route('#reports?period=custom');await page.locator('tbody a[href*="agencyKey="]').first().click();await ready();assert.ok(page.url().includes('agencyKey=')&&!page.url().includes('period='),'Report group drilldown must omit report-only period');
    await route('#dashboard');const preview=resolve('data/preview');mkdirSync(preview,{recursive:true});await page.screenshot({path:resolve(preview,'apps-script-dashboard.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mobileMenuClosed();await page.screenshot({path:resolve(preview,'apps-script-mobile.png'),fullPage:false});
    assert.deepEqual(exceptions, []); console.log('Targeted browser PASS: GAS indexed chart/report drilldowns, native date formatting and responsive dashboard.');
  } else {
    await loginRegression(); await issuanceRegression();
  await page.locator('#account-recovery').click();
  await page.locator('#recovery-form [name=email]').fill('recovery@example.test');
  await page.locator('#recovery-form [name=currentPassword]').fill(passwords.admin);
  await page.locator('#recovery-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#recovery-message')?.textContent.includes('Đã gửi'));
  const emailedToken=()=>gas.mail.at(-1).body.match(/token=(tthc\.r\.[a-f0-9]{64})/)[1];
  await page.goto(origin+'?recovery=verify&token='+emailedToken());
  await page.locator('#recovery-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#recovery-message')?.textContent.includes('đã được xác minh'));
  await page.locator('#recovery-back').click();await ready();await logout();
  assert.equal(await page.locator('#retry-session').count(),0);
  await page.locator('#forgot-password').click();
  await page.locator('#recovery-form [name=username]').fill('admin');
  await page.locator('#recovery-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#recovery-message')?.textContent.includes('Nếu tài khoản'));
  await page.goto(origin+'?recovery=reset&token='+emailedToken());
  const recovered='SYNTHETIC-browser-email-recovered-2026!';
  await page.locator('#recovery-form [name=newPassword]').fill(recovered);
  await page.locator('#recovery-form [name=confirmPassword]').fill('SYNTHETIC-does-not-match');
  await page.locator('#recovery-form [type=submit]').click();
  assert.match(await page.locator('#recovery-message').innerText(),/chưa khớp/);
  await page.locator('#recovery-form [name=confirmPassword]').fill(recovered);
  await page.locator('#recovery-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#recovery-message')?.textContent.includes('Đã đặt lại'));
  passwords.admin=recovered;
  await page.locator('#recovery-back').click();await page.locator('#account-login').waitFor();await login('admin');
  console.log('PASS: verified recovery email, forgot-password link, password reset and login with new password');
  // HTML Service runs inside an iframe; a top-level preview hides base target bugs.
  const embeddedPage = await context.newPage();
  const sessionToken = await page.evaluate(() => sessionStorage.getItem('tthc.dashboard.session'));
  await embeddedPage.goto(origin);
  await embeddedPage.evaluate(token => sessionStorage.setItem('tthc.dashboard.session', token), sessionToken);
  await embeddedPage.setContent('<iframe name="app-frame" src="' + origin + '" width="1440" height="1080"></iframe>');
  const embedded = embeddedPage.frame({ name: 'app-frame' });
  const outerUrl = embeddedPage.url();
  async function embeddedReady(hash) {
    await embedded.waitForFunction(expected => {
      const content = document.querySelector('#page-content');
      return location.hash === expected && content?.getAttribute('aria-busy') === 'false' && content.dataset.routeKey === expected;
    }, hash);
    assert.equal(await embedded.locator('.error-request').count(), 0);
    await embedded.locator('#page-content h1').waitFor();
    assert.equal(embeddedPage.url(), outerUrl, 'Internal links must not navigate the outer Apps Script page');
  }
  await embedded.locator('.sidebar').waitFor();
  for (const name of ['cases', 'alerts', 'reports', 'statistics', 'sources', 'officers', 'users', 'audit', 'settings', 'sync', 'dashboard']) {
    await embedded.locator('.sidebar a.nav-link[href="#' + name + '"]').click();
    await embeddedReady('#' + name);
  }
  await embedded.locator('.metric.overdue').click();
  const drilldownHash = await embedded.evaluate(() => location.hash);
  await embeddedReady(drilldownHash);
  assert.match(drilldownHash, /alertLevel=OVERDUE/);
  await embedded.locator('tbody a.text-link').first().click();
  await embedded.waitForFunction(() => location.hash.includes('id='));
  await embeddedReady(await embedded.evaluate(() => location.hash));
  await embeddedPage.close();
  console.log('PASS: iframe sidebar navigation, dashboard drilldown and case detail preserve the outer page');
  assert.equal(await page.locator('.metric').count(), 8, 'Dashboard must expose all operational KPI cards');
  assert.match(await page.locator('#page-content').innerText(), /Quan sát.*24 giờ/);
  await page.locator('[name=sourceSystem]').selectOption('TPHCM'); await page.locator('#filter-form [type=submit]').click(); await ready();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('sourceSystem'), 'TPHCM');
  const sourceSummary = call('dashboard.summary', { sourceSystem: 'TPHCM' }, await page.evaluate(() => sessionStorage.getItem('tthc.dashboard.session')));
  assert.equal(sourceSummary.ok, true);
  assert.equal(await page.locator('.metric').first().locator('.metric-value').innerText(), Number(sourceSummary.data.kpis.totalProcessing).toLocaleString('vi-VN'));
  await page.locator('.metric.overdue').click(); await ready();
  assert.ok(page.url().includes('sourceSystem=TPHCM') && page.url().includes('alertLevel=OVERDUE'));
  assert.equal(await page.locator('tbody tr').count(), 10);
  await page.locator('tbody a.text-link').first().click(); await ready();
  assert.match(await page.locator('#page-content').innerText(), /Quan sát lần cuối/);
  assert.match(await page.locator('#page-content').innerText(), /Đồng bộ lần cuối/);
  assert.match(await page.locator('#page-content').innerText(), /Nguồn chưa cung cấp lịch sử trạng thái/);
  await route('#cases?id=synthetic-case-001');
  assert.match(await page.locator('#page-content').innerText(), /chưa được cập nhật trong/i);
  await route('#cases?sourceSystem=TPHCM');
  assert.equal(await page.locator('tbody tr').count(), 25);
  await page.locator('[data-page="2"]').click(); await ready();
  assert.equal(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('page'), '2');
  assert.equal(await page.locator('tbody tr').count(), 25);
  const previousFirst = await page.locator('tbody a.text-link').first().innerText();
  await page.locator('[data-page="3"]').click(); await ready();
  assert.equal(await page.locator('tbody tr').count(), 12);
  assert.notEqual(await page.locator('tbody a.text-link').first().innerText(), previousFirst);
  await route('#cases?sourceSystem=TPHCM&q=SYNTHETIC-TPHCM-001');
  assert.equal(await page.locator('tbody tr').count(), 1, 'Case code search must use real indexed backend query');
  await route('#cases?q=NO_SUCH_SYNTHETIC_CASE'); assert.match(await page.locator('#page-content').innerText(), /Không có hồ sơ phù hợp/);
  await control({ failNextAction: 'cases.list' }); await route('#cases?sourceSystem=MOF',true);
  await page.locator('[data-refresh]').waitFor(); assert.match(await page.locator('#page-content').innerText(), /SYNTHETIC lỗi kết nối/);
  await page.locator('[data-refresh]').click(); await ready(); assert.equal(await page.locator('tbody tr').count(), 6);
  for (const path of ['#alerts', '#reports', '#statistics', '#sources', '#officers', '#users', '#audit', '#settings', '#sync']) await route(path);
  await route('#sources'); assert.equal(await page.locator('.source-card').count(), 11);
  assert.equal(await page.locator('.source-card .badge.waiting_for_sample').count(), 11);
  await page.locator('#token-form [type=submit]').click(); await page.locator('.token-secret').waitFor();
  assert.match(await page.locator('.token-secret').inputValue(), /^tthc\.c\.[a-f0-9]{64}$/);
  await page.locator('[data-revoke-token]').click(); await page.waitForFunction(() => !document.querySelector('.token-secret'));
  await route('#alerts');
  if (await page.locator('[data-ack]').count()) { await page.locator('[data-ack]').first().click(); await ready(); assert.match(await page.locator('#page-content').innerText(), /Đã tiếp nhận/); }
  await route('#reports');
  const downloadReady = page.waitForEvent('download'); await page.locator('[data-export]').click(); const download = await downloadReady;
  assert.ok(download.suggestedFilename().endsWith('.csv')); assert.ok((await download.path()) !== null);
  await route('#users');
  await page.locator('#user-form [name=username]').fill('browser-added'); await page.locator('#user-form [name=displayName]').fill('SYNTHETIC BROWSER ADDED');
  for (const key of ['sources', 'agencies', 'departments', 'officers']) await page.locator(`#user-form [name=scope_${key}]`).fill(key === 'sources' ? 'TPHCM' : '*');
  await page.locator('#user-form [type=submit]').click(); await ready(); await page.locator('#account-credentials').waitFor(); assert.equal(await page.locator('#account-credentials [name=issuedUsername]').inputValue(), 'browser-added'); assert.equal(await page.locator('#account-credentials [name=defaultPassword]').inputValue(), gas.properties.get('DEFAULT_USER_PASSWORD')); await page.locator('[data-clear-credentials]').click();
  const createdUser = gas.plain(gas.app.Users.byUsername('browser-added'));
  await page.locator(`[data-toggle-user="${createdUser.user_id}"]`).click(); await ready();
  assert.equal(gas.app.Users.byUsername('browser-added').status, 'DISABLED');
  await route('#settings'); await page.locator('[name=warningHours]').fill('36'); await page.locator('[name=staleHours]').fill('24'); await page.locator('#settings-form [type=submit]').click(); await ready();
  assert.equal(gas.app.Settings.get().warningSeconds, 36 * 3600);
  await route('#dashboard');
  await page.waitForFunction(()=>!document.querySelector('.toast'));
  const preview = resolve('data/preview'); mkdirSync(preview, { recursive: true });
  for (const width of [1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Viewport ${width} must not overflow`);
  }
  await page.setViewportSize({ width: 1440, height: 1080 }); await page.screenshot({ path: resolve(preview, 'apps-script-dashboard.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile dashboard must not overflow');
  await page.locator('#menu-toggle').click(); assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
  await mobileMenuClosed();
  await page.screenshot({ path: resolve(preview, 'apps-script-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1080 }); await logout();
  await login('viewer');
  assert.equal(await page.locator('.sidebar a[href="#users"], .sidebar a[href="#settings"], .sidebar a[href="#audit"]').count(), 0);
  await route('#sources'); assert.equal(await page.locator('.source-card').count(), 1); assert.equal(await page.locator('[data-toggle-source], #token-form').count(), 0);
  await route('#reports'); assert.equal(await page.locator('[data-export]').count(), 0);
  await route('#alerts'); assert.equal(await page.locator('[data-ack]').count(), 0);
  await route('#cases'); assert.equal(await page.locator('[data-export]').count(), 0);
  const scopedText = await page.locator('tbody').innerText(); assert.ok(!scopedText.includes('SYNTHETIC OFFICER B') && !scopedText.includes('SYNTHETIC-MOF'));
  await page.evaluate(() => { location.hash = '#users'; }); await page.locator('.empty-state').waitFor();
  assert.match(await page.locator('#page-content').innerText(), /chưa được cấp quyền/);
  await page.screenshot({ path: resolve(preview, 'apps-script-access-denied.png'), fullPage: false });

    await logout(); await deniedLogin();
    await page.goto(origin + '/?bridge=missing'); await page.locator('#account-login').waitFor();
    assert.match(await page.locator('.login-form').innerText(), /Google Apps Script/);
    assert.deepEqual(exceptions, []);
    assert.ok(requests.some(request => request.action === 'users.create') && requests.some(request => request.action === 'reports.export'));
    assert.ok(requests.filter(request => !request.action.startsWith('auth.')).every(request => request.authenticated));
    assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
    console.log('Browser PASS: actual GAS RPC + AES-SIV/scrypt synthetic fixtures; username/password and first-use change; issued/reset credentials; KPI filters/search/pagination/detail, collector token, alerts, CSV, accounts/settings, viewer scope/server denial and 1366/1440/1920/390 responsiveness. Screenshots data/preview/apps-script-*.png; live deployment is not verified.');
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
