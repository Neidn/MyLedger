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
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-reversal-'));
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
const balanceOf = (repo: SqliteLedgerRepository, id: string) => repo.listAccounts().find((a) => a.id === id)?.balanceKrw;
const sysTotal = (file: string, account: string) => {
  const db = new Database(file, { readonly: true });
  const { total } = db.prepare('SELECT COALESCE(SUM(amount_krw),0) AS total FROM entries WHERE account_id=?').get(account) as { total: number };
  db.close();
  return total;
};
const assertBalanced = (file: string) => {
  const db = new Database(file, { readonly: true });
  const bad = db.prepare('SELECT transaction_id FROM entries GROUP BY transaction_id HAVING SUM(amount_krw) <> 0').all();
  db.close();
  assert.deepEqual(bad, []);
};

test('migration v4: v3 DB gains reversal columns and keeps data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-reversal-'));
  const file = join(dir, 'v3.sqlite');
  try {
    const db = new Database(file);
    db.pragma('foreign_keys = ON');
    migrate(db, 3);
    db.prepare("INSERT INTO transactions(id,kind,occurred_on,created_at) VALUES('T','income','2026-11-01','2026-11-01T00:00:00.000Z')").run();
    assert.deepEqual(migrate(db), { from: 3, to: MIGRATIONS.length });
    const row = db.prepare("SELECT id, reverses_transaction_id FROM transactions WHERE id='T'").get();
    assert.deepEqual(row, { id: 'T', reverses_transaction_id: null });
    const columns = (db.prepare('PRAGMA table_info(replenishments)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(columns.includes('cancelled_at'));
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel: expense is reversed on its original date and both sides are linked', () => withRepo((repo, file) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const expense = repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 50_000, category: '식비', occurredOn: '2026-10-20' });
  const reversal = repo.cancelTransaction(expense.id);

  assert.equal(balanceOf(repo, bank.id), 100_000);
  assert.equal(sysTotal(file, 'SYS:expense'), 0, 'spending nets to zero');
  assert.equal(reversal.kind, 'expense');
  assert.equal(reversal.occurredOn, '2026-10-20');
  assert.equal(reversal.reversesTransactionId, expense.id);
  assert.equal(repo.listTransactions().find((t) => t.id === expense.id)?.reversedByTransactionId, reversal.id);
  assertBalanced(file);

  assert.throws(() => repo.cancelTransaction(expense.id), isStatus(409));
  assert.throws(() => repo.cancelTransaction(reversal.id), isStatus(409));
  assert.throws(() => repo.cancelTransaction('missing'), isStatus(404));
}));

test('cancel: idempotency key returns the same reversal', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const expense = repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 1_000 });
  const first = repo.cancelTransaction(expense.id, 'cancel-key');
  const second = repo.cancelTransaction(expense.id, 'cancel-key');
  assert.equal(first.id, second.id);
}));

test('cancel: refused for opening balances, archived accounts, or when money is already spent', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 0 });
  const income = repo.postTransaction({ kind: 'income', accountId: bank.id, amountKrw: 10_000 });
  repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 8_000 });
  assert.throws(() => repo.cancelTransaction(income.id), isStatus(409), 'only 2,000 left to take back 10,000');

  const old = repo.createAccount({ name: '옛 통장', type: 'bank', openingBalanceKrw: 5_000 });
  const opening = repo.listTransactions().find((t) => t.kind === 'opening' && t.entries?.some((e) => e.accountId === old.id))!;
  assert.throws(() => repo.cancelTransaction(opening.id), isStatus(400));

  const move = repo.postTransaction({ kind: 'transfer', fromAccountId: old.id, toAccountId: bank.id, amountKrw: 5_000 });
  repo.archiveAccount(old.id);
  assert.throws(() => repo.cancelTransaction(move.id), isStatus(409));
}));

test('cancel: prepaid spend restores the lot at its original cost', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 200_000 });
  const prepaid = repo.createAccount({ name: '충전금', type: 'prepaid', openingBalanceKrw: 0 });
  repo.postTransaction({ kind: 'prepaid_topup', fromAccountId: bank.id, prepaidAccountId: prepaid.id, paidAmountKrw: 90_000, faceAmountKrw: 100_000 });
  const spend = repo.postTransaction({ kind: 'expense', accountId: prepaid.id, amountKrw: 30_000 });
  repo.cancelTransaction(spend.id);
  assert.equal(balanceOf(repo, prepaid.id), 100_000);
  // Whole lot is available again at its full discounted cost.
  const all = repo.postTransaction({ kind: 'expense', accountId: prepaid.id, amountKrw: 100_000 });
  assert.equal(all.realCostKrw, 90_000);
}));

test('cancel: top-up only while unused', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 200_000 });
  const prepaid = repo.createAccount({ name: '충전금', type: 'prepaid', openingBalanceKrw: 0 });
  const unused = repo.postTransaction({ kind: 'prepaid_topup', fromAccountId: bank.id, prepaidAccountId: prepaid.id, paidAmountKrw: 45_000, faceAmountKrw: 50_000 });
  repo.cancelTransaction(unused.id);
  assert.equal(balanceOf(repo, prepaid.id), 0);
  assert.equal(balanceOf(repo, bank.id), 200_000);

  const used = repo.postTransaction({ kind: 'prepaid_topup', fromAccountId: bank.id, prepaidAccountId: prepaid.id, paidAmountKrw: 45_000, faceAmountKrw: 50_000 });
  repo.postTransaction({ kind: 'expense', accountId: prepaid.id, amountKrw: 1_000 });
  assert.throws(() => repo.cancelTransaction(used.id), isStatus(409));
}));

test('cancel: temporary withdrawal needs its repayments cancelled first', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 200_000 });
  const borrow = repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 50_000, replenishment: {} });
  const owed = repo.listReplenishments()[0];
  const repay = repo.repayReplenishment(owed.id, { fromAccountId: bank.id, amountKrw: 20_000 });

  assert.throws(() => repo.cancelTransaction(borrow.id), isStatus(409));
  repo.cancelTransaction(repay.id);
  assert.equal(repo.listReplenishments()[0].remainingKrw, 50_000);

  repo.cancelTransaction(borrow.id);
  assert.equal(repo.listReplenishments().length, 0);
  assert.equal(repo.getDashboard().totals.outstandingReplenishmentKrw, 0);
  assert.equal(balanceOf(repo, savings.id), 200_000);
  assert.equal(balanceOf(repo, bank.id), 100_000);
}));

test('cancel: card purchase lowers the bill again', () => withRepo((repo) => {
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 });
  const buy = repo.postTransaction({ kind: 'expense', accountId: card.id, amountKrw: 12_000 });
  repo.cancelTransaction(buy.id);
  assert.equal(balanceOf(repo, card.id), 0);
}));

test('amend: wrong amount is replaced in one step, keeping account, category and date', () => withRepo((repo, file) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const typo = repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 50_000, category: '식비', note: '점심', occurredOn: '2026-11-10' });
  const fixed = repo.amendTransaction(typo.id, { amountKrw: 5_000 });

  assert.equal(balanceOf(repo, bank.id), 95_000);
  assert.equal(sysTotal(file, 'SYS:expense'), 5_000);
  assert.equal(fixed.category, '식비');
  assert.equal(fixed.note, '점심');
  assert.equal(fixed.occurredOn, '2026-11-10');
  assert.ok(repo.listTransactions().find((t) => t.id === typo.id)?.reversedByTransactionId);
  assertBalanced(file);

  const moved = repo.amendTransaction(fixed.id, { note: '저녁', occurredOn: '2026-11-11', category: '외식' });
  assert.deepEqual([moved.note, moved.occurredOn, moved.category], ['저녁', '2026-11-11', '외식']);
  assert.equal(balanceOf(repo, bank.id), 95_000);
}));

test('amend: top-up and temporary-withdrawal transfer keep their links', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 200_000 });
  const prepaid = repo.createAccount({ name: '충전금', type: 'prepaid', openingBalanceKrw: 0 });
  const topup = repo.postTransaction({ kind: 'prepaid_topup', fromAccountId: bank.id, prepaidAccountId: prepaid.id, paidAmountKrw: 9_000, faceAmountKrw: 10_000 });
  repo.amendTransaction(topup.id, { amountKrw: 90_000, faceAmountKrw: 100_000 });
  assert.equal(balanceOf(repo, prepaid.id), 100_000);
  assert.equal(balanceOf(repo, bank.id), 110_000);

  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 100_000 });
  const borrow = repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 30_000, replenishment: { dueOn: '2026-12-25' } });
  repo.amendTransaction(borrow.id, { amountKrw: 40_000 });
  const owed = repo.listReplenishments();
  assert.equal(owed.length, 1);
  assert.deepEqual([owed[0].principalKrw, owed[0].dueOn], [40_000, '2026-12-25']);
}));

test('amend: refused for repayments and opening balances', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 100_000 });
  repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 10_000, replenishment: {} });
  const repay = repo.repayReplenishment(repo.listReplenishments()[0].id, { fromAccountId: bank.id, amountKrw: 5_000 });
  assert.throws(() => repo.amendTransaction(repay.id, { amountKrw: 1_000 }), isStatus(400));
  const opening = repo.listTransactions().find((t) => t.kind === 'opening')!;
  assert.throws(() => repo.amendTransaction(opening.id, { amountKrw: 1 }), isStatus(400));
}));

test('amend: a failing replacement leaves the original untouched', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 10_000 });
  const expense = repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 1_000 });
  assert.throws(() => repo.amendTransaction(expense.id, { amountKrw: 999_999 }), isStatus(409));
  assert.equal(balanceOf(repo, bank.id), 9_000);
  assert.equal(repo.listTransactions().find((t) => t.id === expense.id)?.reversedByTransactionId, null);
}));
