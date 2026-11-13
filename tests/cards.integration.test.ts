import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteLedgerRepository } from '../src/adapters/sqlite/repository';
import { DomainError } from '../src/lib/errors';
import { migrate, MIGRATIONS } from '../scripts/migrations.mjs';

function withRepo(run: (repo: SqliteLedgerRepository, file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-cards-'));
  const file = join(dir, 'test.sqlite');
  try {
    const db = new Database(file);
    db.pragma('foreign_keys = ON');
    migrate(db);
    db.close();
    run(new SqliteLedgerRepository(file), file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isStatus = (status: number) => (error: unknown) => error instanceof DomainError && error.status === status;
const spending = (file: string) => {
  const db = new Database(file, { readonly: true });
  const { total } = db.prepare("SELECT COALESCE(SUM(amount_krw),0) AS total FROM entries WHERE account_id='SYS:expense'").get() as { total: number };
  db.close();
  return total;
};

test('migration v3: rebuilds accounts to allow card without losing data or foreign keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-cards-'));
  const file = join(dir, 'v2.sqlite');
  try {
    // Seed v2 rows with raw SQL: repository code always targets the latest schema.
    const upgrade = new Database(file);
    upgrade.pragma('foreign_keys = ON');
    migrate(upgrade, 2);
    upgrade.exec(`
      INSERT INTO accounts(id,name,type,is_system,created_at) VALUES('BANK','생활비','bank',0,'2026-11-01T00:00:00.000Z');
      INSERT INTO accounts(id,name,type,is_system,created_at,archived_at) VALUES('OLD','옛 통장','cash',0,'2026-11-01T00:00:00.000Z','2026-11-02T00:00:00.000Z');
      INSERT INTO transactions(id,kind,note,occurred_on,created_at) VALUES('T1','opening','초기 잔액','2026-11-01','2026-11-01T00:00:00.000Z');
      INSERT INTO entries(id,transaction_id,account_id,amount_krw) VALUES('E1','T1','BANK',100000),('E2','T1','SYS:opening',-100000);
    `);
    const bank = { id: 'BANK' };
    assert.deepEqual(migrate(upgrade), { from: 2, to: MIGRATIONS.length });
    assert.equal(upgrade.pragma('foreign_keys', { simple: true }), 1, 'foreign_keys restored after migration');
    assert.deepEqual(upgrade.pragma('foreign_key_check'), []);
    upgrade.close();

    const repo = new SqliteLedgerRepository(file);
    const accounts = repo.listAccounts();
    assert.equal(accounts.find((a) => a.id === bank.id)?.balanceKrw, 100_000);
    assert.ok(accounts.find((a) => a.name === '옛 통장')?.archivedAt, 'archived_at survives the rebuild');
    assert.equal(repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 }).type, 'card');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('card: opening balance is the amount owed and reduces net assets', () => withRepo((repo) => {
  repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 300_000 });
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 50_000 });
  assert.equal(card.balanceKrw, -50_000);
  assert.equal(card.deletable, true);
  const { totals } = repo.getDashboard();
  assert.equal(totals.cardOutstandingKrw, 50_000);
  assert.equal(totals.assetBalanceKrw, 250_000);
  assert.equal(totals.liquidBalanceKrw, 300_000);
}));

test('card: purchases count as spending when made and may exceed any balance', () => withRepo((repo, file) => {
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 });
  repo.postTransaction({ kind: 'expense', accountId: card.id, amountKrw: 30_000, category: '식비' });
  repo.postTransaction({ kind: 'expense', accountId: card.id, amountKrw: 20_000 });
  assert.equal(repo.listAccounts().find((a) => a.id === card.id)?.balanceKrw, -50_000);
  assert.equal(spending(file), 50_000);
  assert.equal(repo.getDashboard().totals.cardOutstandingKrw, 50_000);
}));

test('card: paying the bill is a transfer, not spending', () => withRepo((repo, file) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 300_000 });
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 });
  repo.postTransaction({ kind: 'expense', accountId: card.id, amountKrw: 70_000 });
  repo.postTransaction({ kind: 'transfer', fromAccountId: bank.id, toAccountId: card.id, amountKrw: 70_000, note: '카드값' });
  const accounts = repo.listAccounts();
  assert.equal(accounts.find((a) => a.id === card.id)?.balanceKrw, 0);
  assert.equal(accounts.find((a) => a.id === bank.id)?.balanceKrw, 230_000);
  assert.equal(spending(file), 70_000, 'only the purchase is spending; the bill payment is not');
  assert.equal(repo.getDashboard().totals.cardOutstandingKrw, 0);
}));

test('card: can pay for a prepaid top-up', () => withRepo((repo) => {
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 });
  const prepaid = repo.createAccount({ name: '충전금', type: 'prepaid', openingBalanceKrw: 0 });
  repo.postTransaction({ kind: 'prepaid_topup', fromAccountId: card.id, prepaidAccountId: prepaid.id, paidAmountKrw: 90_000, faceAmountKrw: 100_000 });
  const accounts = repo.listAccounts();
  assert.equal(accounts.find((a) => a.id === card.id)?.balanceKrw, -90_000);
  assert.equal(accounts.find((a) => a.id === prepaid.id)?.balanceKrw, 100_000);
}));

test('card: rejects income, outgoing transfers and repayment from the card', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 100_000 });
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 });
  assert.throws(() => repo.postTransaction({ kind: 'income', accountId: card.id, amountKrw: 1_000 }), isStatus(400));
  assert.throws(() => repo.postTransaction({ kind: 'transfer', fromAccountId: card.id, toAccountId: bank.id, amountKrw: 1_000 }), isStatus(400));
  repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 10_000, replenishment: {} });
  const owed = repo.listReplenishments()[0];
  assert.throws(() => repo.repayReplenishment(owed.id, { fromAccountId: card.id, amountKrw: 1_000 }), isStatus(400));
}));

test('card: archive needs the bill paid off', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 10_000 });
  assert.throws(() => repo.archiveAccount(card.id), isStatus(409));
  repo.postTransaction({ kind: 'transfer', fromAccountId: bank.id, toAccountId: card.id, amountKrw: 10_000 });
  assert.ok(repo.archiveAccount(card.id).archivedAt);
}));
