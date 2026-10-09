import { GoogleSheetsClient, GoogleSheetsReader } from './google-sheets.mjs';
import { GoogleOidc } from './google-oidc.mjs';
import { SheetPermissions } from './sheet-permissions.mjs';
import { GoogleSheetStore } from './sheet-store.mjs';
import { SOURCES } from '../shared/registry.mjs';

function positiveSeconds(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10 || parsed > 900) throw new Error('Chu kỳ đồng bộ quyền phải có 10–900 giây.');
  return parsed;
}

export async function createGoogleRuntime(db, env = process.env) {
  const mode = env.AUTH_MODE || 'local'; const dataBackend = env.DATA_BACKEND || 'sqlite';
  if (!['local', 'google'].includes(mode) || !['sqlite', 'google_sheets'].includes(dataBackend)) throw new Error('AUTH_MODE/DATA_BACKEND không hợp lệ.');
  if (mode === 'local' && dataBackend === 'sqlite') return { authMode: 'local' };
  if (mode !== 'google') throw new Error('DATA_BACKEND=google_sheets cần AUTH_MODE=google.');
  for (const key of ['GOOGLE_SHEETS_ID', 'GOOGLE_SERVICE_ACCOUNT_FILE', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_ORIGIN']) {
    if (!env[key]?.trim()) throw new Error(`Cần cấu hình ${key} trên máy chủ để kết nối Google.`);
  }
  const clientOptions = { spreadsheetId: env.GOOGLE_SHEETS_ID, credentialsPath: env.GOOGLE_SERVICE_ACCOUNT_FILE, maxResponseBytes: 32 * 1024 * 1024 };
  const sheetName = (env.GOOGLE_SHEETS_PERMISSIONS_TAB || 'Permissions').trim();
  if (sheetName.toLowerCase() === 'gs_data') throw new Error('Tab Permissions phải tách khỏi tab lưu dữ liệu GS_Data.');
  const googleOidc = new GoogleOidc({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${new URL(env.APP_ORIGIN).origin}/api/auth/google/callback`, production: env.NODE_ENV === 'production' });
  const permissions = new SheetPermissions(db, { reader: new GoogleSheetsReader({ ...clientOptions, sheetName, sourceIds: SOURCES.map(source => source.id) }),
    spreadsheetId: env.GOOGLE_SHEETS_ID, sheetName, refreshSeconds: positiveSeconds(env.PERMISSIONS_REFRESH_SECONDS, 30), maxAgeSeconds: positiveSeconds(env.PERMISSIONS_MAX_AGE_SECONDS, 120) });
  const sheetStore = dataBackend === 'google_sheets' ? new GoogleSheetStore(db, { client: new GoogleSheetsClient({ ...clientOptions, readonly: false }) }) : null;
  if (sheetStore) await sheetStore.initialize();
  await permissions.refresh();
  if (sheetStore) await sheetStore.flush();
  return { authMode: 'google', googleOidc, permissions, sheetStore };
}
