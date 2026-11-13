import { readFileSync } from 'node:fs';

/** Ordered schema files. PRAGMA user_version = number of files applied. Append only. */
export const MIGRATIONS = ['001_init.sql', '002_account_archive.sql', '003_card_accounts.sql'];

const sqlDir = new URL('../sql/', import.meta.url);

/**
 * Applies pending migrations up to `target`, each in its own IMMEDIATE transaction with
 * its version bump. Foreign keys are off while migrating (SQLite ignores that pragma
 * inside a transaction, and table rebuilds need it off); each step must pass
 * foreign_key_check before it commits, and the caller's setting is restored afterwards.
 */
export function migrate(db, target = MIGRATIONS.length) {
  const from = db.pragma('user_version', { simple: true });
  if (from > MIGRATIONS.length) throw new Error(`Unsupported SQLite schema version: ${from}`);
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    for (let version = from + 1; version <= target; version++) {
      const sql = readFileSync(new URL(MIGRATIONS[version - 1], sqlDir), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        const violations = db.pragma('foreign_key_check');
        if (violations.length) throw new Error(`Migration ${MIGRATIONS[version - 1]} broke foreign keys: ${JSON.stringify(violations.slice(0, 5))}`);
        db.pragma(`user_version = ${version}`);
      }).immediate();
    }
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
  return { from, to: Math.max(from, target) };
}
