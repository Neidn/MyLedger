import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { migrate } from './migrations.mjs';

const file = resolve(process.env.SQLITE_PATH || './data/ledger.sqlite');
mkdirSync(dirname(file), { recursive: true });
const db = new Database(file);
try {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  const { from, to } = migrate(db);
  console.log(from === to ? `SQLite schema is up to date: version ${to}` : `SQLite schema migrated: version ${from} -> ${to}`);
} finally {
  db.close();
}
