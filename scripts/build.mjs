import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const check = spawnSync(process.execPath, ['scripts/check.mjs'], { stdio: 'inherit' }); if (check.status !== 0) process.exit(check.status || 1);
const extension = spawnSync(process.execPath, ['extension/build.mjs'], { stdio: 'inherit' }); if (extension.status !== 0) process.exit(extension.status || 1);
const target = resolve('./dist'); mkdirSync(target, { recursive: true });
// Include the tools needed by the shipped README, including clasp and verification.
for (const dir of ['server', 'shared', 'web', 'extension', 'docs', 'deploy', 'apps-script', 'scripts', 'tests']) cpSync(dir, resolve(target, dir), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json']) cpSync(file, resolve(target, file));
cpSync('.env.example', resolve(target, '.env.example'));
cpSync('.env.google.example', resolve(target, '.env.google.example'));
cpSync('README.md', resolve(target, 'README.md'));
cpSync('.clasp.example.json', resolve(target, '.clasp.example.json'));
cpSync('.claspignore', resolve(target, '.claspignore'));
console.log(`Build ứng dụng và extension: ${target}`);
