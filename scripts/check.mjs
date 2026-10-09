import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
export function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.npm-cache', 'dist', 'data', '.git', 'secrets'].includes(entry.name)) return [];
    const path = resolve(dir, entry.name); return entry.isDirectory() ? sourceFiles(path) : /\.(?:mjs|js|ts)$/.test(entry.name) ? [path] : [];
  });
}
let errors = 0; const files = sourceFiles('.');
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); errors++; }
  const source = readFileSync(file, 'utf8');
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) { console.error(`${file}: dynamic code execution prohibited`); errors++; }
  if (/\r?\n[^\r\n]*[ \t]+\r?\n/.test(source)) { console.error(`${file}: trailing whitespace`); errors++; }
}
const gas = spawnSync(process.execPath, ['scripts/check-apps-script.mjs'], { encoding: 'utf8' });
if (gas.status !== 0) { process.stderr.write(gas.stderr); errors++; }
else process.stdout.write(gas.stdout);
const vendor = spawnSync(process.execPath, ['scripts/build-crypto-vendor.mjs', '--check'], { encoding: 'utf8' });
if (vendor.status !== 0) { process.stderr.write(vendor.stderr); errors++; }
else process.stdout.write(vendor.stdout);
if (errors) process.exitCode = 1;
else console.log(`Kiểm tra cú pháp và quy tắc an toàn: ${files.length} tệp hợp lệ.`);
