import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SOURCES } from '../shared/registry.mjs';
import { DEFAULT_FIELD_MAPPINGS, DEFAULT_STATUS_MAPPINGS } from '../shared/normalize.mjs';
import { DEFAULT_RULE } from './engine.ts';

export function openDatabase(path = process.env.DATABASE_PATH || './data/central.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,appliedAt INTEGER NOT NULL)');
  const folder = new URL('./migrations/', import.meta.url);
  for (const file of readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(file)) continue;
    transaction(db, () => { db.exec(readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(file, Date.now()); });
  }
  transaction(db, () => {
    for (const source of SOURCES) {
      db.prepare('INSERT INTO source_systems(id,name,hostname,url,adapter,version,adapterStatus) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,hostname=excluded.hostname,url=excluded.url,adapter=excluded.adapter,version=excluded.version,adapterStatus=excluded.adapterStatus').run(source.id, source.name, source.hostname, source.url || `https://${source.hostname}/`, source.adapter || `${source.id}Adapter`, source.version || '0.1.0', source.adapterStatus || 'WAITING_FOR_SAMPLE');
      db.prepare('INSERT OR IGNORE INTO source_field_mappings VALUES (?,?)').run(source.id, JSON.stringify(DEFAULT_FIELD_MAPPINGS[source.id] || {}));
      db.prepare('INSERT OR IGNORE INTO source_status_mappings VALUES (?,?)').run(source.id, JSON.stringify(DEFAULT_STATUS_MAPPINGS[source.id] || {}));
    }
    db.prepare('INSERT OR IGNORE INTO alert_rules VALUES (?,?,?,?)').run('GLOBAL', '*', JSON.stringify(DEFAULT_RULE), Date.now());
    db.prepare('INSERT OR IGNORE INTO system_settings VALUES (?,?)').run('calendar', JSON.stringify({ confirmed: false, workingWeekdays: [], holidays: [], workingDates: [] }));
  });
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, userId, action, target = '', details = {}) {
  db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)').run(randomUUID(), userId || null, action, target, JSON.stringify(details), Date.now());
}
export function sourceMappings(db, sourceId) {
  return {
    fieldMappings: JSON.parse(db.prepare('SELECT config FROM source_field_mappings WHERE sourceSystem=?').get(sourceId)?.config || '{}'),
    statusMappings: JSON.parse(db.prepare('SELECT config FROM source_status_mappings WHERE sourceSystem=?').get(sourceId)?.config || '{}'),
  };
}
export function ruleFor(db, record) {
  let config = { ...DEFAULT_RULE, risk: { ...DEFAULT_RULE.risk } };
  for (const [type, id] of [['GLOBAL', '*'], ['SOURCE', record.sourceSystem], ['AGENCY', record.agencyId], ['PROCEDURE', record.procedureCode]]) {
    if (!id) continue;
    const row = db.prepare('SELECT config FROM alert_rules WHERE scopeType=? AND scopeId=?').get(type, id);
    if (row) { const rule = JSON.parse(row.config); config = { ...config, ...rule, risk: { ...config.risk, ...rule.risk } }; }
  }
  return config;
}
