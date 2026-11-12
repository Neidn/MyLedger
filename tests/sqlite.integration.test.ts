import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { SqliteLedgerRepository } from '../src/adapters/sqlite/repository';
import { migrate } from '../scripts/migrations.mjs';

test('SQLite contract: discounted topup, reimbursement and balanced postings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'my-ledger-'));
  const file = join(dir, 'test.sqlite');
  try {
    const db = new Database(file);
    db.pragma('foreign_keys = ON');
    migrate(db);
    db.close();

    const repo = new SqliteLedgerRepository(file);
    const savings = repo.createAccount({ name: '여행비', type: 'savings', openingBalanceKrw: 1_000_000 });
    const bank = repo.createAccount({ name: '생활비', type: 'bank', openingBalanceKrw: 300_000 });
    const prepaid = repo.createAccount({ name: '충전금', type: 'prepaid', openingBalanceKrw: 0 });

    const transfer = repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 200_000, replenishment: { dueOn: '2026-11-25' } }, 'my-transfer-key');
    const duplicate = repo.postTransaction({ kind: 'transfer', fromAccountId: savings.id, toAccountId: bank.id, amountKrw: 200_000, replenishment: { dueOn: '2026-11-25' } }, 'my-transfer-key');
    assert.equal(transfer.id, duplicate.id);

    const replenishmentId = repo.listReplenishments()[0].id;
    repo.repayReplenishment(replenishmentId, { fromAccountId: bank.id, amountKrw: 50_000 });
    assert.equal(repo.listReplenishments()[0].remainingKrw, 150_000);

    repo.postTransaction({ kind: 'prepaid_topup', fromAccountId: bank.id, prepaidAccountId: prepaid.id, paidAmountKrw: 90_000, faceAmountKrw: 100_000 });
    const spend = repo.postTransaction({ kind: 'expense', accountId: prepaid.id, amountKrw: 30_000 });
    assert.equal(spend.realCostKrw, 27_000);

    const dashboard = repo.getDashboard();
    assert.equal(dashboard.accounts.find((a) => a.id === bank.id)?.balanceKrw, 360_000);
    assert.equal(dashboard.accounts.find((a) => a.id === savings.id)?.balanceKrw, 850_000);
    assert.equal(dashboard.totals.prepaidBalanceKrw, 70_000);
    assert.equal(dashboard.totals.outstandingReplenishmentKrw, 150_000);

    const verify = new Database(file, { readonly: true });
    const outOfBalance = verify.prepare(`SELECT t.id FROM transactions t JOIN entries e ON t.id=e.transaction_id GROUP BY t.id HAVING SUM(e.amount_krw) <> 0`).all();
    assert.equal(outOfBalance.length, 0);
    verify.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
