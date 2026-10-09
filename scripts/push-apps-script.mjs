import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const command = resolve('node_modules/@google/clasp/build/src/index.js');
if (!existsSync(command)) throw new Error('Chạy npm.cmd install trước khi dùng clasp.');
if (!existsSync('.clasp.json')) throw new Error('Sao chép .clasp.example.json thành .clasp.json rồi điền Script ID đã có.');
const config = JSON.parse(readFileSync('.clasp.json', 'utf8'));
if (config.rootDir !== 'apps-script' || !/^[A-Za-z0-9_-]{20,200}$/.test(config.scriptId || '')) throw new Error('Cấu hình clasp không hợp lệ.');
function run(args, message) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) { console.error(message); process.exit(result.status || 1); }
}
run(['scripts/check-apps-script.mjs'], 'Apps Script chưa vượt qua kiểm tra; không push.');
// Always download the existing remote code into an isolated timestamped folder.
// Never pull over local working files; never create or delete a Google project.
const snapshot = resolve('data/apps-script-backups', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(snapshot, { recursive: true });
const backupConfig = resolve(snapshot, '.clasp.json');
writeFileSync(backupConfig, JSON.stringify({ scriptId: config.scriptId, rootDir: snapshot }, null, 2));
writeFileSync(resolve(snapshot, '.claspignore'), '*.md\n');
run([command, '-P', backupConfig, '-I', resolve(snapshot, '.claspignore'), 'pull'], 'Không sao lưu được source remote. Dừng push; đăng nhập bằng npx.cmd clasp login rồi thử lại.');
if (!existsSync(resolve(snapshot, 'appsscript.json'))) throw new Error('Snapshot remote không có manifest; dừng push.');
console.log(`Đã lưu bản source remote tại ${snapshot}`);
// The manifest change is part of this explicit push, after the remote backup.
// clasp otherwise silently skips a manifest push in a noninteractive terminal with exit code 0.
run([command, 'push', '--force'], 'Clasp chưa push thành công; bản remote đã được sao lưu.');
const verified = resolve(snapshot, 'verified-remote');
mkdirSync(verified);
const verifyConfig = resolve(verified, '.clasp.json'), verifyIgnore = resolve(verified, '.claspignore');
writeFileSync(verifyConfig, JSON.stringify({ scriptId: config.scriptId, rootDir: verified }, null, 2));
writeFileSync(verifyIgnore, '*.md\n');
run([command, '-P', verifyConfig, '-I', verifyIgnore, 'pull'], 'Chưa đọc lại được source remote để xác nhận; không coi push là đã kiểm chứng.');
const localFiles = readdirSync('apps-script').filter(name => /\.(gs|html)$/.test(name) || name === 'appsscript.json');
const expected = localFiles.map(name => name.replace(/\.gs$/, '.js')).sort();
const actual = readdirSync(verified).filter(name => /\.(js|html)$/.test(name) || name === 'appsscript.json').sort();
assert.deepEqual(actual, expected, 'Danh sách file remote khác bản local; cần kiểm tra trước deploy.');
for (const name of localFiles) {
  const local = readFileSync(resolve('apps-script', name), 'utf8');
  const remote = readFileSync(resolve(verified, name.replace(/\.gs$/, '.js')), 'utf8');
  if (name === 'appsscript.json') assert.deepEqual(JSON.parse(remote), JSON.parse(local), 'Manifest remote khác bản local.');
  else assert.equal(remote.replace(/\r\n/g, '\n'), local.replace(/\r\n/g, '\n'), `Source remote khác bản local: ${name}`);
}
console.log(`Đã đọc lại và xác nhận ${expected.length} file remote khớp source local. Triển khai Web App sau khi cấu hình Script Properties.`);
