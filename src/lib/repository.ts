import type { LedgerRepository } from '@/domain/ports';
import { SqliteLedgerRepository } from '@/adapters/sqlite/repository';

let singleton: LedgerRepository | undefined;

export function getRepository(): LedgerRepository {
  if (!singleton) {
    const driver = process.env.DB_DRIVER || 'sqlite';
    if (driver !== 'sqlite') {
      throw new Error(`DB_DRIVER=${driver} adapter is not implemented. See docs/MIGRATION.md.`);
    }
    singleton = new SqliteLedgerRepository(process.env.SQLITE_PATH || './data/ledger.sqlite');
  }
  return singleton;
}
