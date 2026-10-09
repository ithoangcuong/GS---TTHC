import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

// Inspect the public portal in a fresh anonymous browser; no user session is used.
const target = 'https://motcuabxd.moc.gov.vn/vi/dossier/search';
const output = resolve('data/moc-portal-inspection');
await mkdir(output, { recursive: true });
const executablePath = [process.env.BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(path => path && existsSync(path));
if (!executablePath) throw new Error('No supported browser executable.');
const browser = await chromium.launch({ executablePath, headless: true, timeout: 20000 });
const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const responses = [];
const captures = [];
const errors = [];
if (process.argv.includes('--static-only')) {
  try {
    const summary = JSON.parse(await readFile(resolve(output, 'summary.json'), 'utf8'));
    const addresses = [...new Set(summary.responses.filter(item => item.type === 'script' && /pages-search-search-module|modules-dossier-dossier-module\.|\/common\.|\/main\./.test(item.url)).map(item => item.url))];
    const runtime = summary.responses.find(item => /\/runtime\./.test(item.url) && item.capture);
    if (runtime) {
      const runtimeText = await readFile(resolve(output, runtime.capture), 'utf8');
      const chunk = runtimeText.match(/"pages-search-search-module":"([a-f0-9]{20})"/);
      if (chunk) addresses.push(new URL(`pages-search-search-module.${chunk[1]}.js`, runtime.url).href);
    }
    const config = summary.responses.find(item => item.type === 'xhr' && /\/assets\/app\.config\.json/.test(item.url));
    if (config) addresses.push(config.url);
    const results = [];
    for (let start = 0; start < addresses.length; start += 3) {
      results.push(...await Promise.all(addresses.slice(start, start + 3).map(async (address, offset) => {
        const response = await context.request.get(address, { timeout: 30000 });
        const body = await response.text();
        const name = `static-${start + offset}.${/app\.config\.json/.test(address) ? 'json' : 'js'}`;
        await writeFile(resolve(output, name), body);
        return { url: address, status: response.status(), contentType: response.headers()['content-type'], bytes: body.length, capture: name };
      })));
    }
    await writeFile(resolve(output, 'static-summary.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
  process.exit(0);
}
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  const address = response.url();
  if (new URL(address).hostname !== new URL(target).hostname) return;
  responses.push({ url: address, status: response.status(), type: response.request().resourceType() });
  if (['script', 'document'].includes(response.request().resourceType())) {
    const index = responses.length;
    captures.push((async () => {
      try {
        const body = await response.text();
        if (body.length > 4000000) return;
        const name = `${String(index).padStart(3, '0')}-${response.request().resourceType()}.${response.request().resourceType() === 'script' ? 'js' : 'html'}`;
        await writeFile(resolve(output, name), body);
        responses.find(item => item.url === address).capture = name;
      } catch (error) { errors.push(`${address}: ${error.message}`); }
    })());
  }
});
try {
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const observed = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body?.innerText || '',
    forms: [...document.forms].map(form => ({ id: form.id, action: form.action, method: form.method, fields: [...form.elements].map(field => ({ name: field.name, id: field.id, type: field.type, placeholder: field.getAttribute('placeholder') })) })),
    tables: [...document.querySelectorAll('table')].map(table => ({ id: table.id, className: table.className, headers: [...table.querySelectorAll('th')].map(th => th.innerText), rows: table.querySelectorAll('tbody tr').length, html: table.outerHTML.slice(0, 30000) })),
    scripts: [...document.scripts].map(script => script.src).filter(Boolean),
    links: [...document.querySelectorAll('a[href]')].map(anchor => ({ text: anchor.innerText, href: anchor.href })).filter(link => link.text)
  }));
  await writeFile(resolve(output, 'rendered.html'), await page.content());
  await page.screenshot({ path: resolve(output, 'public-page.png'), fullPage: true });
  await Promise.allSettled(captures);
  const summary = { target, inspectedAt: new Date().toISOString(), status: response?.status(), ...observed, responses, errors };
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ target, url: observed.url, status: response?.status(), title: observed.title, text: observed.text.slice(0, 8000), tables: observed.tables.map(table => ({ ...table, html: undefined })), scriptCount: observed.scripts.length, errors }, null, 2));
} finally {
  await browser.close();
}
