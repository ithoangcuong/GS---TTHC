import { GoogleSheetsClient, SHEET_HEADERS, parsePermissionRows } from './google-sheets.mjs';
import { SOURCES } from '../shared/registry.mjs';

export async function setupGoogleSheet(env = process.env, { client: injectedClient } = {}) {
  const spreadsheetId = env.GOOGLE_SHEETS_ID; const sheetName = (env.GOOGLE_SHEETS_PERMISSIONS_TAB || 'Permissions').trim();
  const adminEmail = env.GOOGLE_ADMIN_EMAIL?.trim().toLowerCase();
  const rows = [SHEET_HEADERS, [adminEmail, 'Quản trị hệ thống', 'SYSTEM_ADMIN', '', '', '', '', true]];
  parsePermissionRows(rows);
  if (!sheetName || sheetName.length > 100 || /[\u0000-\u001f\[\]:*?/\\]/.test(sheetName) || sheetName.toLowerCase() === 'gs_data') throw new Error('Tên tab phân quyền không hợp lệ.');
  const client = injectedClient || new GoogleSheetsClient({ spreadsheetId, credentialsPath: env.GOOGLE_SERVICE_ACCOUNT_FILE, readonly: false });
  const metadata = await client.request('GET', '?fields=sheets.properties');
  const existing = metadata.sheets?.find(sheet => sheet.properties?.title === sheetName);
  if (!existing) await client.request('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: sheetName, gridProperties: { frozenRowCount: 1, columnCount: 9, rowCount: 5002 } } } }] });
  const range = `'${sheetName.replaceAll("'", "''")}'`;
  const current = await client.readValues(range);
  if (current.some(row => row.some(value => value !== '' && value !== null))) {
    parsePermissionRows(current, { sourceIds: SOURCES.map(source => source.id) });
    console.log(`Tab ${sheetName} đã có bảng quyền hợp lệ; giữ nguyên dữ liệu. Kiểm tra email ${adminEmail} trong bảng trước khi đăng nhập.`);
    return;
  }
  await client.request('PUT', `/values/${encodeURIComponent(`'${sheetName.replaceAll("'", "''")}'!A1:H2`)}?valueInputOption=RAW`, { range: `'${sheetName.replaceAll("'", "''")}'!A1:H2`, majorDimension: 'ROWS', values: rows });
  console.log(`Đã tạo tab ${sheetName} và cấp SYSTEM_ADMIN cho ${adminEmail}. Các tab khác được giữ nguyên.`);
}
