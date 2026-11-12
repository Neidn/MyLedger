import { readFileSync } from 'node:fs';

/** Ordered schema files. PRAGMA user_version = number of files applied. Append only. */
export const MIGRATIONS = ['001_init.sql', '002_account_archive.sql'];

const sqlDir = new URL('../sql/', import.meta.url);

/** Applies pending migrations, each in its own IMMEDIATE transaction with its version bump. */
export function migrate(db) {
  const from = db.pragma('user_version', { simple: true });
  if (from > MIGRATIONS.length) throw new Error(`Unsupported SQLite schema version: ${from}`);
  for (let version = from + 1; version <= MIGRATIONS.length; version++) {
    const sql = readFileSync(new URL(MIGRATIONS[version - 1], sqlDir), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    }).immediate();
  }
  return { from, to: MIGRATIONS.length };
}
