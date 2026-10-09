import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';

const root = 'apps-script';
const files = readdirSync(root).filter(name => /\.(gs|html)$/.test(name));
let functions = 0;
for (const name of files) {
  const source = readFileSync(`${root}/${name}`, 'utf8');
  if (name.endsWith('.gs')) {
    new Script(source, { filename: name });
    assert.ok(!/\b(?:import|require)\s*\(|\b(?:process|Buffer|document|window)\./.test(source), `${name}: Node/browser API in Apps Script`);
    for (const match of source.matchAll(/^function\s+(\w+)\s*\(/gm)) {
      functions++;
      assert.ok(['doGet', 'doPost', 'rpc'].includes(match[1]) || match[1].endsWith('_'), `${name}: unexpected public RPC ${match[1]}`);
    }
  } else {
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      new Script(match[1].replace(/<\?[\s\S]*?\?>/g, 'null'), { filename: name });
    }
    for (const match of source.matchAll(/include_?\(['"]([^'"]+)['"]\)/g)) assert.ok(existsSync(`${root}/${match[1]}.html`), `${name}: missing include ${match[1]}`);
    assert.ok(!/\balert\s*\(/.test(source), `${name}: browser alert UX`);
  }
}
const manifest = JSON.parse(readFileSync(`${root}/appsscript.json`, 'utf8'));
assert.equal(manifest.runtimeVersion, 'V8');
assert.equal(manifest.timeZone, 'Asia/Ho_Chi_Minh');
assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
if (existsSync('.clasp.json')) {
  const clasp = JSON.parse(readFileSync('.clasp.json', 'utf8'));
  assert.equal(clasp.rootDir, root);
  assert.match(clasp.scriptId, /^[A-Za-z0-9_-]{20,200}$/);
}
console.log(`Apps Script: ${files.length} files parse; ${functions} top-level entry points checked; manifest and includes valid.`);
