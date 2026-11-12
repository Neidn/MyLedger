import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteLedgerRepository } from '../src/adapters/sqlite/repository';
import { DomainError } from '../src/lib/errors';
import { migrate, MIGRATIONS } from '../scripts/migrations.mjs';

function withRepo(run: (repo: SqliteLedgerRepository, file: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-accounts-'));
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

test('migrations: fresh DB reaches latest version with archived_at column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-migrate-'));
  try {
    const db = new Database(join(dir, 'fresh.sqlite'));
    const result = migrate(db);
    assert.deepEqual(result, { from: 0, to: MIGRATIONS.length });
    assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    const columns = (db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(columns.includes('archived_at'));
    assert.deepEqual(migrate(db), { from: MIGRATIONS.length, to: MIGRATIONS.length });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations: existing v1 DB upgrades in place and keeps its data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-migrate-'));
  try {
    const db = new Database(join(dir, 'v1.sqlite'));
    db.exec(readFileSync(resolve('sql/001_init.sql'), 'utf8'));
    db.pragma('user_version = 1');
    db.prepare("INSERT INTO accounts(id,name,type,is_system,created_at) VALUES('A','생활비','bank',0,'2026-11-01T00:00:00.000Z')").run();
    assert.deepEqual(migrate(db), { from: 1, to: MIGRATIONS.length });
    const row = db.prepare("SELECT name, archived_at FROM accounts WHERE id='A'").get() as { name: string; archived_at: string | null };
    assert.deepEqual(row, { name: '생활비', archived_at: null });
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('migrations: refuse a DB newer than this code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-migrate-'));
  try {
    const db = new Database(join(dir, 'future.sqlite'));
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    assert.throws(() => migrate(db), /Unsupported SQLite schema version/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rename: changes only the name', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const renamed = repo.renameAccount(bank.id, '  월급 통장 ');
  assert.equal(renamed.name, '월급 통장');
  assert.equal(renamed.balanceKrw, 100_000);
  assert.throws(() => repo.renameAccount(bank.id, '   '), isStatus(400));
  assert.throws(() => repo.renameAccount('missing', '이름'), isStatus(404));
}));

test('delete: account with only its opening balance is removed with that opening transaction', () => withRepo((repo, file) => {
  const keep = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 300_000 });
  const mistake = repo.createAccount({ name: '잘못 만든 계좌', type: 'bank', openingBalanceKrw: 50_000 });
  const prepaid = repo.createAccount({ name: '잘못 만든 충전금', type: 'prepaid', openingBalanceKrw: 20_000 });
  const empty = repo.createAccount({ name: '빈 계좌', type: 'cash', openingBalanceKrw: 0 });
  assert.equal(mistake.deletable, true);
  assert.equal(prepaid.deletable, true);
  assert.equal(empty.deletable, true);

  repo.deleteAccount(mistake.id);
  repo.deleteAccount(prepaid.id);
  repo.deleteAccount(empty.id);

  assert.deepEqual(repo.listAccounts().map((a) => a.id), [keep.id]);
  assert.equal(repo.getDashboard().totals.assetBalanceKrw, 300_000);
  assert.equal(repo.listTransactions().length, 1);
  assert.throws(() => repo.deleteAccount(mistake.id), isStatus(404));

  const verify = new Database(file, { readonly: true });
  assert.equal((verify.prepare('SELECT COUNT(*) AS n FROM prepaid_lots').get() as { n: number }).n, 0);
  verify.close();
}));

test('delete: refused once the account has real activity', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 100_000 });
  repo.postTransaction({ kind: 'expense', accountId: bank.id, amountKrw: 10_000 });
  repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 1_000 });

  const accounts = repo.listAccounts();
  assert.equal(accounts.find((a) => a.id === bank.id)?.deletable, false);
  assert.equal(accounts.find((a) => a.id === savings.id)?.deletable, false);
  assert.throws(() => repo.deleteAccount(bank.id), isStatus(409));
  assert.throws(() => repo.deleteAccount(savings.id), isStatus(409));
  assert.equal(repo.listAccounts().length, 2);
}));

test('archive: requires a zero balance and no outstanding replenishment', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 200_000 });
  assert.throws(() => repo.archiveAccount(bank.id), isStatus(409));

  // Borrow everything from savings: balance is 0 but 200,000 is still owed back to it.
  repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 200_000, replenishment: {} });
  assert.throws(() => repo.archiveAccount(savings.id), isStatus(409));
  assert.throws(() => repo.archiveAccount('missing'), isStatus(404));
}));

test('archive: hides the account, blocks new postings, and unarchive restores it', () => withRepo((repo) => {
  const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 100_000 });
  const old = repo.createAccount({ name: '해지한 통장', type: 'bank', openingBalanceKrw: 30_000 });
  repo.postTransaction({ kind: 'transfer', fromAccountId: old.id, toAccountId: bank.id, amountKrw: 30_000 });

  const archived = repo.archiveAccount(old.id);
  assert.ok(archived.archivedAt);
  assert.equal(repo.archiveAccount(old.id).archivedAt, archived.archivedAt);

  const dashboard = repo.getDashboard();
  assert.deepEqual(dashboard.accounts.map((a) => a.id), [bank.id]);
  assert.deepEqual(dashboard.archivedAccounts.map((a) => a.id), [old.id]);
  assert.equal(dashboard.totals.assetBalanceKrw, 130_000);
  // History that mentions the archived account stays readable.
  assert.ok(dashboard.transactions.some((t) => t.entries?.some((e) => e.accountId === old.id)));

  assert.throws(() => repo.postTransaction({ kind: 'income', accountId: old.id, amountKrw: 1_000 }), isStatus(409));
  assert.throws(() => repo.postTransaction({ kind: 'transfer', fromAccountId: bank.id, toAccountId: old.id, amountKrw: 1_000 }), isStatus(409));

  const restored = repo.unarchiveAccount(old.id);
  assert.equal(restored.archivedAt, null);
  repo.postTransaction({ kind: 'income', accountId: old.id, amountKrw: 1_000 });
  assert.equal(repo.listAccounts().find((a) => a.id === old.id)?.balanceKrw, 1_000);
}));
