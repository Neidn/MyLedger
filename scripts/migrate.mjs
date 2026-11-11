import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const file = resolve(process.env.SQLITE_PATH || './data/ledger.sqlite');
mkdirSync(dirname(file), { recursive: true });
const db = new Database(file);
try {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = FULL');
  const current = db.pragma('user_version', { simple: true });
  if (current === 0) {
    const sql = readFileSync(resolve('./sql/001_init.sql'), 'utf8');
    const migrate = db.transaction(() => {
      db.exec(sql);
      db.pragma('user_version = 1');
    });
    migrate.immediate();
    console.log('SQLite schema initialized: version 1');
  } else if (current === 1) {
    console.log('SQLite schema is up to date: version 1');
  } else {
    throw new Error(`Unsupported SQLite schema version: ${current}`);
  }
} finally {
  db.close();
}
