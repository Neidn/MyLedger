import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteLedgerRepository } from '../src/adapters/sqlite/repository';
import { DomainError } from '../src/lib/errors';
import { monthRange } from '../src/domain/money';
import { migrate } from '../scripts/migrations.mjs';

function withRepo(run: (repo: SqliteLedgerRepository) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-reports-'));
  const file = join(dir, 'test.sqlite');
  try {
    const db = new Database(file);
    db.pragma('foreign_keys = ON');
    migrate(db);
    db.close();
    run(new SqliteLedgerRepository(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isStatus = (status: number) => (error: unknown) => error instanceof DomainError && error.status === status;

/** One month of realistic activity plus noise that must NOT count as November spending. */
function seedNovember(repo: SqliteLedgerRepository) {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 1_000_000 });
  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 0 });
  const card = repo.createAccount({ name: '신용카드', type: 'card', openingBalanceKrw: 0 });
  const prepaid = repo.createAccount({ name: '충전금', type: 'prepaid', openingBalanceKrw: 0 });
  const post = repo.postTransaction.bind(repo);

  post({ kind: 'income', accountId: bank.id, amountKrw: 2_000_000, category: '급여', occurredOn: '2026-11-25' });
  post({ kind: 'expense', accountId: bank.id, amountKrw: 10_000, category: '식비', note: '점심 김밥', occurredOn: '2026-11-01' });
  post({ kind: 'expense', accountId: card.id, amountKrw: 5_000, category: '식비', note: '커피', occurredOn: '2026-11-30' });
  post({ kind: 'expense', accountId: bank.id, amountKrw: 3_000, category: '교통', occurredOn: '2026-11-15' });
  post({ kind: 'expense', accountId: bank.id, amountKrw: 2_000, occurredOn: '2026-11-16' });
  // Not spending: transfers, card bill payment, prepaid top-up.
  post({ kind: 'transfer', fromAccountId: bank.id, toAccountId: savings.id, amountKrw: 100_000, occurredOn: '2026-11-10' });
  post({ kind: 'transfer', fromAccountId: bank.id, toAccountId: card.id, amountKrw: 5_000, note: '카드값', occurredOn: '2026-11-30' });
  post({ kind: 'prepaid_topup', fromAccountId: bank.id, prepaidAccountId: prepaid.id, paidAmountKrw: 90_000, faceAmountKrw: 100_000, occurredOn: '2026-11-05' });
  // Outside November.
  post({ kind: 'expense', accountId: bank.id, amountKrw: 7_000, category: '식비', occurredOn: '2026-10-31' });
  post({ kind: 'expense', accountId: bank.id, amountKrw: 9_000, category: '식비', occurredOn: '2026-12-01' });
  // Cancelled inside November: nets to zero and drops out of the categories.
  const mistake = post({ kind: 'expense', accountId: bank.id, amountKrw: 50_000, category: '쇼핑', occurredOn: '2026-11-20' });
  repo.cancelTransaction(mistake.id);
  return { bank, card };
}

test('monthRange: covers the calendar month, rejects bad input', () => {
  assert.deepEqual(monthRange('2026-11'), ['2026-11-01', '2026-12-01']);
  assert.deepEqual(monthRange('2026-12'), ['2026-12-01', '2027-01-01']);
  for (const bad of ['2026-13', '2026-1', '26-11', '2026-11-01', '']) {
    assert.throws(() => monthRange(bad), /YYYY-MM/);
  }
});

test('monthly report: spending, income and net for the month only', () => withRepo((repo) => {
  seedNovember(repo);
  const report = repo.getMonthlyReport('2026-11');
  assert.equal(report.month, '2026-11');
  assert.equal(report.spendingKrw, 20_000, '10,000 + 5,000 card + 3,000 + 2,000; cancelled 50,000 nets out');
  assert.equal(report.incomeKrw, 2_000_000);
  assert.equal(report.netKrw, 1_980_000);
}));

test('monthly report: categories ranked by spending, uncategorised kept, cancelled dropped', () => withRepo((repo) => {
  seedNovember(repo);
  assert.deepEqual(repo.getMonthlyReport('2026-11').categories, [
    { category: '식비', spendingKrw: 15_000, count: 2 },
    { category: '교통', spendingKrw: 3_000, count: 1 },
    { category: null, spendingKrw: 2_000, count: 1 },
  ]);
}));

test('monthly report: editing a date moves the spending between months', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const lunch = repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 8_000, category: '식비', occurredOn: '2026-11-30' });
  repo.amendTransaction(lunch.id, { occurredOn: '2026-12-01' });
  assert.equal(repo.getMonthlyReport('2026-11').spendingKrw, 0);
  assert.equal(repo.getMonthlyReport('2026-12').spendingKrw, 8_000);
}));

test('monthly report: empty month and invalid month', () => withRepo((repo) => {
  assert.deepEqual(repo.getMonthlyReport('2026-01'), { month: '2026-01', spendingKrw: 0, incomeKrw: 0, netKrw: 0, categories: [] });
  assert.throws(() => repo.getMonthlyReport('2026-13'), isStatus(400));
}));

test('listTransactions: month filter and text search over note and category', () => withRepo((repo) => {
  seedNovember(repo);
  const november = repo.listTransactions({ month: '2026-11', limit: 500 });
  assert.ok(november.length > 0);
  assert.ok(november.every((t) => t.occurredOn.startsWith('2026-11')));

  const food = repo.listTransactions({ month: '2026-11', query: '식비' });
  assert.deepEqual(food.map((t) => t.note).sort(), ['점심 김밥', '커피']);
  assert.deepEqual(repo.listTransactions({ query: '김밥' }).map((t) => t.note), ['점심 김밥']);
  assert.equal(repo.listTransactions({ query: '식비' }).length, 4, 'all months when no month given');
  assert.equal(repo.listTransactions({ query: '%' }).length, 0, 'LIKE wildcards are literal');
  assert.throws(() => repo.listTransactions({ month: 'nope' }), isStatus(400));
}));

test('listCategories: most used first, cancellations not counted twice', () => withRepo((repo) => {
  seedNovember(repo);
  assert.deepEqual(repo.listCategories(), ['식비', '교통', '급여', '쇼핑']);
}));
