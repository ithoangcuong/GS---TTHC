import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { backup } from 'node:sqlite';
import { openDatabase } from './database.mjs';
import { createUser, publicUser } from './auth.mjs';
import { seedDemo } from './seed.mjs';
const command = process.argv[2];
if (command === 'demo') { process.env.DATABASE_PATH = './data/demo.sqlite'; process.env.AUTH_MODE = 'local'; process.env.DATA_BACKEND = 'sqlite'; }
const db = openDatabase();
try {
  if (command === 'migrate') console.log('Migration hoàn tất.');
  else if (command === 'setup-google') { const { setupGoogleSheet } = await import('./google-setup.mjs'); await setupGoogleSheet(); }
  else if (command === 'setup' || command === 'demo') {
    if (process.env.AUTH_MODE === 'google') throw new Error('Chế độ Google dùng npm run setup:google để khởi tạo tab phân quyền; không tạo mật khẩu nội bộ.');
    const username = process.env.ADMIN_USERNAME || (command === 'demo' ? 'demo.admin' : 'admin');
    let row = db.prepare('SELECT * FROM users WHERE username=?').get(username); let admin;
    if (!row) {
      const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
      admin = await createUser(db, { username, displayName: command === 'demo' ? 'Quản trị dữ liệu minh họa' : 'Quản trị hệ thống', password, role: 'SYSTEM_ADMIN', scope: {} });
      console.log(`Tài khoản trung tâm: ${username}\nMật khẩu khởi tạo (chỉ in lần này): ${password}`);
    } else { admin = publicUser(row); console.log(`Tài khoản ${username} đã tồn tại; giữ nguyên mật khẩu và dữ liệu.`); }
    if (command === 'demo') {
      if (admin.role !== 'SYSTEM_ADMIN') throw new Error('Seed demo cần tài khoản SYSTEM_ADMIN.');
      console.log(`Đã tạo ${seedDemo(db, admin)} hồ sơ MINH HỌA trong database riêng data/demo.sqlite.`);
    }
  } else if (command === 'backup') {
    const target = resolve(process.argv[3] || `./data/backups/central-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    if (existsSync(target)) throw new Error('Tệp backup đã tồn tại; chọn đường dẫn mới.');
    mkdirSync(dirname(target), { recursive: true }); await backup(db, target); console.log(`Backup: ${target}`);
  } else throw new Error('Lệnh hỗ trợ: setup, setup-google, migrate, demo, backup.');
} finally { db.close(); }
if (command === 'demo') await import('./main.mjs');
