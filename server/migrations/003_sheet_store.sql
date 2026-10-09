-- These tables remain local: they track durable writes, never authentication secrets.
CREATE TABLE sheet_store_outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,eventId TEXT NOT NULL UNIQUE,tableName TEXT NOT NULL,key TEXT NOT NULL,operation TEXT NOT NULL CHECK(operation IN ('UPSERT','DELETE')),payload TEXT NOT NULL,batchId TEXT,createdAt INTEGER NOT NULL);
CREATE INDEX sheet_store_outbox_batch ON sheet_store_outbox(batchId,sequence);
CREATE TABLE sheet_store_batches(id TEXT PRIMARY KEY,manifest TEXT NOT NULL,createdAt INTEGER NOT NULL);
CREATE TABLE sheet_store_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
