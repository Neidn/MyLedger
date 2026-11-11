import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.env.SQLITE_PATH || './data/ledger.sqlite');
if (!existsSync(file)) throw new Error('SQLite database is not initialized.');
const backupDir = resolve(process.env.BACKUP_DIR || './backups');
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = resolve(backupDir, `ledger-${stamp}.sqlite`);
const db = new Database(file, { readonly: true });
try {
  await db.backup(destination);
  const check = new Database(destination, { readonly: true });
  try {
    const value = check.pragma('integrity_check', { simple: true });
    if (value !== 'ok') throw new Error(`Backup failed integrity_check: ${value}`);
  } finally {
    check.close();
  }
  console.log(`SQLite online backup verified: ${destination}`);
} finally {
  db.close();
}
