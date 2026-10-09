import { openDatabase } from './database.mjs';
import { createApp } from './app.mjs';
import { createGoogleRuntime } from './google-runtime.mjs';
const db = openDatabase();
let runtime;
try { runtime = await createGoogleRuntime(db); }
catch (error) { db.close(); console.error(`Không khởi động được: ${error.message}`); process.exit(1); }
const server = createApp(db, runtime);
const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT) || 3000;
server.listen(port, host, () => console.log(`GS-TTHC: ${process.env.APP_ORIGIN || `http://localhost:${port}`} (${process.env.NODE_ENV || 'development'})`));
function shutdown() { server.close(async () => { try { await runtime.sheetStore?.flush(); db.close(); process.exit(0); } catch { db.close(); process.exit(1); } }); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
