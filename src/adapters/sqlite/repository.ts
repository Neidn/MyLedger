import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createPostings } from '@/domain/postings';
import { existsSync } from 'node:fs';
import type { Account, AccountType, Dashboard, Replenishment, Transaction, TransactionCommand } from '@/domain/models';
import type { LedgerRepository } from '@/domain/ports';
import { allocatePrepaidCost, kstToday, nonnegativeKrw, positiveKrw, shortText, validateDate } from '@/domain/money';
import { badRequest, conflict, notFound } from '@/lib/errors';

type AccountRow = { id: string; name: string; type: AccountType; created_at: string; archived_at: string | null };
type TxRow = { id: string; kind: Transaction['kind']; category: string | null; note: string | null; occurred_on: string; created_at: string };
type LotRow = { id: string; remaining_face: number; remaining_paid: number };
type ReplenishmentRow = {
  id: string;
  protected_account_id: string;
  protected_account_name: string;
  destination_account_id: string;
  destination_account_name: string;
  principal_amount: number;
  repaid_amount: number;
  due_on: string | null;
};

export class SqliteLedgerRepository implements LedgerRepository {
  private readonly db: Database.Database;

  constructor(file: string) {
    if (!existsSync(file)) throw new Error('SQLite DB가 없습니다. npm run db:migrate 를 먼저 실행하세요.');
    this.db = new Database(file);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = FULL');
  }

  checkHealth(): boolean {
    const result = this.db.prepare('SELECT 1 AS healthy').get() as { healthy: number };
    return result.healthy === 1;
  }

  listAccounts(): Account[] {
    // deletable: nothing but opening-balance entries and no replenishment links.
    const rows = this.db.prepare(`
      SELECT a.id, a.name, a.type, a.created_at, a.archived_at,
             COALESCE((SELECT SUM(e.amount_krw) FROM entries e WHERE e.account_id = a.id), 0) AS balance_krw,
             CASE WHEN EXISTS (SELECT 1 FROM entries e JOIN transactions t ON t.id = e.transaction_id
                               WHERE e.account_id = a.id AND t.kind <> 'opening')
                    OR EXISTS (SELECT 1 FROM replenishments r
                               WHERE r.protected_account_id = a.id OR r.destination_account_id = a.id)
                  THEN 0 ELSE 1 END AS deletable
      FROM accounts a
      WHERE a.is_system = 0
      ORDER BY a.created_at, a.id
    `).all() as Array<AccountRow & { balance_krw: number; deletable: number }>;
    return rows.map((r) => ({
      id: r.id, name: r.name, type: r.type, balanceKrw: r.balance_krw, createdAt: r.created_at,
      archivedAt: r.archived_at, deletable: r.deletable === 1,
    }));
  }

  renameAccount(id: string, name: string): Account {
    this.findAccount(id);
    const clean = shortText(name, 50, '계좌 이름');
    if (!clean) badRequest('계좌 이름을 입력하세요.');
    this.db.prepare('UPDATE accounts SET name=? WHERE id=?').run(clean, id);
    return this.getAccount(id);
  }

  archiveAccount(id: string): Account {
    const execute = this.db.transaction(() => {
      const account = this.findAccount(id);
      if (account.archived_at) return;
      const { balance } = this.db.prepare('SELECT COALESCE(SUM(amount_krw),0) AS balance FROM entries WHERE account_id=?').get(id) as { balance: number };
      if (balance !== 0) conflict('잔액이 0원인 계좌만 보관할 수 있습니다. 먼저 다른 계좌로 옮기세요.');
      const { owed } = this.db.prepare(`SELECT COUNT(*) AS owed FROM replenishments
        WHERE protected_account_id=? AND principal_amount > repaid_amount`).get(id) as { owed: number };
      if (owed > 0) conflict('보충이 남아 있는 계좌는 보관할 수 없습니다.');
      this.db.prepare('UPDATE accounts SET archived_at=? WHERE id=?').run(new Date().toISOString(), id);
    });
    execute.immediate();
    return this.getAccount(id);
  }

  unarchiveAccount(id: string): Account {
    this.findAccount(id);
    this.db.prepare('UPDATE accounts SET archived_at=NULL WHERE id=?').run(id);
    return this.getAccount(id);
  }

  deleteAccount(id: string): void {
    const execute = this.db.transaction(() => {
      if (!this.getAccount(id).deletable) conflict('거래 기록이 있는 계좌는 삭제할 수 없습니다. 대신 보관하세요.');
      // Only opening transactions reference it (account + SYS:opening), so removing them
      // keeps every remaining transaction balanced.
      const openings = this.db.prepare('SELECT DISTINCT transaction_id AS id FROM entries WHERE account_id=?').all(id) as Array<{ id: string }>;
      this.db.prepare('DELETE FROM prepaid_lots WHERE account_id=?').run(id);
      for (const tx of openings) {
        this.db.prepare('DELETE FROM entries WHERE transaction_id=?').run(tx.id);
        this.db.prepare('DELETE FROM transactions WHERE id=?').run(tx.id);
      }
      this.db.prepare('DELETE FROM accounts WHERE id=?').run(id);
    });
    execute.immediate();
  }

  createAccount(input: { name: string; type: AccountType; openingBalanceKrw: number }): Account {
    const name = shortText(input.name, 50, '계좌 이름');
    if (!name) badRequest('계좌 이름을 입력하세요.');
    if (!['bank', 'savings', 'cash', 'prepaid', 'card'].includes(input.type)) badRequest('지원하지 않는 계좌 유형입니다.');
    let opening: number;
    try { opening = nonnegativeKrw(input.openingBalanceKrw, 'openingBalanceKrw'); }
    catch { return badRequest('초기 잔액은 0 이상의 정수여야 합니다.'); }
    const id = randomUUID();
    const now = new Date().toISOString();
    const execute = this.db.transaction(() => {
      this.db.prepare('INSERT INTO accounts(id,name,type,is_system,created_at) VALUES(?,?,?,0,?)').run(id, name, input.type, now);
      if (opening > 0) {
        // For a card the opening amount is the bill already owed.
        const isCard = input.type === 'card';
        const txId = this.insertTransaction('opening', kstToday(), isCard ? '초기 카드 결제 예정액' : '초기 잔액', null);
        this.insertEntries(txId, createPostings({ kind: isCard ? 'opening_debt' : 'opening', accountId: id, amountKrw: opening }));
        if (input.type === 'prepaid') {
          this.insertLot(id, txId, opening, opening, null, now);
        }
      }
    });
    execute.immediate();
    return this.getAccount(id);
  }

  postTransaction(command: TransactionCommand, idempotencyKey?: string): Transaction {
    this.validateIdempotencyKey(idempotencyKey);
    const execute = this.db.transaction(() => {
      const duplicate = this.findByIdempotencyKey(idempotencyKey);
      if (duplicate) return this.readTransaction(duplicate)!;

      const occurredOn = command.occurredOn ? validateDate(command.occurredOn, 'occurredOn') : kstToday();
      const note = shortText(command.note, 300, '메모') || null;
      let txId: string;
      if (command.kind === 'income' || command.kind === 'expense') {
        const account = this.requireAccount(command.accountId);
        const amount = positiveKrw(command.amountKrw, 'amountKrw');
        if (account.type === 'prepaid' && command.kind === 'income') badRequest('선결제 계좌는 충전 기능으로 입금하세요.');
        if (account.type === 'card' && command.kind === 'income') badRequest('카드 계좌에는 수입을 등록할 수 없습니다. 카드값 납부는 은행 → 카드 이체로 기록하세요.');
        if (command.kind === 'expense') this.requireBalance(account.id, amount);
        txId = this.insertTransaction(command.kind, occurredOn, note, shortText(command.category, 60, '카테고리') || null, idempotencyKey);
        this.insertEntries(txId, createPostings({ kind: command.kind, accountId: account.id, amountKrw: amount }));
        if (command.kind === 'expense' && account.type === 'prepaid') {
          this.consumePrepaidLots(account.id, txId, amount, occurredOn);
        }
      } else if (command.kind === 'transfer') {
        const from = this.requireAccount(command.fromAccountId);
        const to = this.requireAccount(command.toAccountId);
        const amount = positiveKrw(command.amountKrw, 'amountKrw');
        if (from.id === to.id) badRequest('동일 계좌로 이체할 수 없습니다.');
        if (from.type === 'prepaid' || to.type === 'prepaid') badRequest('선결제 계좌는 전용 충전/소비 기능을 사용하세요.');
        if (from.type === 'card') badRequest('카드에서 다른 계좌로 이체할 수 없습니다. 카드값 납부는 은행 → 카드로 이체하세요.');
        this.requireBalance(from.id, amount);
        if (command.replenishment && typeof command.replenishment !== 'object') badRequest('보충 정보가 유효하지 않습니다.');
        const dueOn = command.replenishment?.dueOn ? validateDate(command.replenishment.dueOn, 'dueOn') : null;
        txId = this.insertTransaction('transfer', occurredOn, note, null, idempotencyKey);
        this.insertEntries(txId, createPostings({ kind: 'transfer', fromAccountId: from.id, toAccountId: to.id, amountKrw: amount }));
        if (command.replenishment) {
          this.db.prepare(`INSERT INTO replenishments
            (id,transfer_transaction_id,protected_account_id,destination_account_id,principal_amount,repaid_amount,due_on,created_at)
            VALUES (?,?,?,?,?,0,?,?)`).run(randomUUID(), txId, from.id, to.id, amount, dueOn, new Date().toISOString());
        }
      } else if (command.kind === 'prepaid_topup') {
        const from = this.requireAccount(command.fromAccountId);
        const prepaid = this.requireAccount(command.prepaidAccountId);
        const paid = positiveKrw(command.paidAmountKrw, 'paidAmountKrw');
        const face = positiveKrw(command.faceAmountKrw, 'faceAmountKrw');
        if (paid > face) badRequest('초기 버전은 액면 금액이 결제금액 이상인 충전만 지원합니다.');
        if (prepaid.type !== 'prepaid' || from.type === 'prepaid') badRequest('출금 계좌와 충전 계좌 유형을 확인하세요.');
        const expiresOn = command.expiresOn ? validateDate(command.expiresOn, 'expiresOn') : null;
        this.requireBalance(from.id, paid);
        txId = this.insertTransaction('prepaid_topup', occurredOn, note, null, idempotencyKey);
        this.insertEntries(txId, createPostings({ kind: 'prepaid_topup', fromAccountId: from.id, prepaidAccountId: prepaid.id, paidAmountKrw: paid, faceAmountKrw: face }));
        this.insertLot(prepaid.id, txId, face, paid, expiresOn, new Date().toISOString());
      } else {
        badRequest('지원하지 않는 거래 유형입니다.');
      }
      return this.readTransaction(txId)!;
    });
    try { return execute.immediate(); }
    catch (err) {
      if (err instanceof Error && (err.message.includes('amountKrw:') || err.message.includes('날짜') || err.message.includes('길이 제한'))) {
        badRequest(err.message);
      }
      throw err;
    }
  }

  listTransactions(limit = 50): Transaction[] {
    const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
    const rows = this.db.prepare(`SELECT id,kind,category,note,occurred_on,created_at
      FROM transactions ORDER BY occurred_on DESC,created_at DESC,id DESC LIMIT ?`).all(safeLimit) as TxRow[];
    return rows.map((r) => this.mapTransaction(r));
  }

  listReplenishments(): Replenishment[] {
    const rows = this.db.prepare(`SELECT r.id,r.protected_account_id,r.destination_account_id,r.principal_amount,
      r.repaid_amount,r.due_on, a.name AS protected_account_name, b.name AS destination_account_name
      FROM replenishments r JOIN accounts a ON r.protected_account_id=a.id
      JOIN accounts b ON r.destination_account_id=b.id
      ORDER BY CASE WHEN r.principal_amount > r.repaid_amount THEN 0 ELSE 1 END, r.due_on, r.created_at DESC`).all() as ReplenishmentRow[];
    return rows.map((r) => ({
      id: r.id, protectedAccountId: r.protected_account_id, protectedAccountName: r.protected_account_name,
      destinationAccountId: r.destination_account_id, destinationAccountName: r.destination_account_name,
      principalKrw: r.principal_amount, repaidKrw: r.repaid_amount, remainingKrw: r.principal_amount - r.repaid_amount,
      dueOn: r.due_on,
    }));
  }

  repayReplenishment(id: string, input: { fromAccountId: string; amountKrw: number; occurredOn?: string }, idempotencyKey?: string): Transaction {
    this.validateIdempotencyKey(idempotencyKey);
    const execute = this.db.transaction(() => {
      const duplicate = this.findByIdempotencyKey(idempotencyKey);
      if (duplicate) return this.readTransaction(duplicate)!;
      const row = this.db.prepare('SELECT * FROM replenishments WHERE id=?').get(id) as
        | { id: string; protected_account_id: string; principal_amount: number; repaid_amount: number }
        | undefined;
      if (!row) notFound('보충 의무를 찾을 수 없습니다.');
      const from = this.requireAccount(input.fromAccountId);
      const protectedAccount = this.requireAccount(row.protected_account_id);
      const amount = positiveKrw(input.amountKrw, 'amountKrw');
      if (from.id === protectedAccount.id) badRequest('보충 출금 계좌와 대상 계좌가 같습니다.');
      if (from.type === 'prepaid' || protectedAccount.type === 'prepaid') badRequest('선결제 계좌의 보충은 지원하지 않습니다.');
      if (from.type === 'card') badRequest('카드로는 보충할 수 없습니다. 은행·현금 계좌를 선택하세요.');
      if (amount > row.principal_amount - row.repaid_amount) conflict('미보충액보다 많은 금액을 갚을 수 없습니다.');
      this.requireBalance(from.id, amount);
      const occurredOn = input.occurredOn ? validateDate(input.occurredOn, 'occurredOn') : kstToday();
      const txId = this.insertTransaction('replenishment_repayment', occurredOn, '임시 인출 보충', null, idempotencyKey);
      this.insertEntries(txId, createPostings({ kind: 'replenishment_repayment', fromAccountId: from.id, toAccountId: protectedAccount.id, amountKrw: amount }));
      this.db.prepare('UPDATE replenishments SET repaid_amount=repaid_amount+? WHERE id=?').run(amount, id);
      this.db.prepare(`INSERT INTO replenishment_payments(id,replenishment_id,transaction_id,amount_krw) VALUES(?,?,?,?)`)
        .run(randomUUID(), id, txId, amount);
      return this.readTransaction(txId)!;
    });
    try { return execute.immediate(); }
    catch (err) {
      if (err instanceof Error && (err.message.includes('amountKrw:') || err.message.includes('날짜'))) badRequest(err.message);
      throw err;
    }
  }

  getDashboard(): Dashboard {
    const all = this.listAccounts();
    const accounts = all.filter((a) => !a.archivedAt);
    const archivedAccounts = all.filter((a) => a.archivedAt);
    const replenishments = this.listReplenishments();
    const sum = (filter: (a: Account) => boolean) => accounts.filter(filter).reduce((n, a) => n + a.balanceKrw, 0);
    return {
      accounts, archivedAccounts, transactions: this.listTransactions(30), replenishments,
      totals: {
        assetBalanceKrw: sum(() => true),
        liquidBalanceKrw: sum((a) => a.type === 'bank' || a.type === 'cash'),
        prepaidBalanceKrw: sum((a) => a.type === 'prepaid'),
        cardOutstandingKrw: accounts.filter((a) => a.type === 'card').reduce((n, a) => n + Math.max(0, -a.balanceKrw), 0),
        outstandingReplenishmentKrw: replenishments.reduce((n, r) => n + r.remainingKrw, 0),
      },
    };
  }

  /** Any user account, archived or not — for account management. */
  private findAccount(id: string): AccountRow {
    const account = this.db.prepare('SELECT id,name,type,created_at,archived_at FROM accounts WHERE id=? AND is_system=0').get(id) as AccountRow | undefined;
    if (!account) notFound('계좌를 찾을 수 없습니다.');
    return account;
  }

  private getAccount(id: string): Account {
    const account = this.listAccounts().find((a) => a.id === id);
    if (!account) notFound('계좌를 찾을 수 없습니다.');
    return account;
  }

  /** An account that may take new postings. */
  private requireAccount(id: string): AccountRow {
    const account = this.findAccount(id);
    if (account.archived_at) conflict(`보관된 계좌(${account.name})에는 거래를 등록할 수 없습니다. 먼저 복원하세요.`);
    return account;
  }

  private requireBalance(id: string, minimum: number): void {
    // A card is credit: spending on it raises the bill instead of needing a balance.
    if (this.findAccount(id).type === 'card') return;
    const result = this.db.prepare('SELECT COALESCE(SUM(amount_krw),0) AS balance FROM entries WHERE account_id=?').get(id) as { balance: number };
    if (result.balance < minimum) conflict('출금 계좌의 잔액이 부족합니다.');
  }

  private insertTransaction(kind: Transaction['kind'], occurredOn: string, note: string | null, category: string | null, key?: string): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO transactions(id,kind,category,note,occurred_on,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?)')
      .run(id, kind, category, note, occurredOn, new Date().toISOString(), key || null);
    return id;
  }

  private insertEntries(txId: string, values: Array<[string, number]>): void {
    if (values.length < 2 || values.some(([, amount]) => !Number.isSafeInteger(amount) || amount === 0) ||
      values.reduce((total, [, amount]) => total + amount, 0) !== 0) {
      throw new Error('불균형 원장 항목을 저장할 수 없습니다.');
    }
    const statement = this.db.prepare('INSERT INTO entries(id,transaction_id,account_id,amount_krw) VALUES(?,?,?,?)');
    for (const [accountId, amount] of values) statement.run(randomUUID(), txId, accountId, amount);
  }

  private insertLot(accountId: string, txId: string, face: number, paid: number, expiresOn: string | null, now: string): void {
    this.db.prepare(`INSERT INTO prepaid_lots(id,account_id,topup_transaction_id,face_amount,paid_amount,
      remaining_face,remaining_paid,expires_on,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(randomUUID(), accountId, txId, face, paid, face, paid, expiresOn, now);
  }

  private consumePrepaidLots(accountId: string, txId: string, amount: number, occurredOn: string): void {
    const lots = this.db.prepare(`SELECT id,remaining_face,remaining_paid FROM prepaid_lots
      WHERE account_id=? AND remaining_face > 0 AND (expires_on IS NULL OR expires_on >= ?)
      ORDER BY created_at, rowid`).all(accountId, occurredOn) as LotRow[];
    let remaining = amount;
    const insertAllocation = this.db.prepare(`INSERT INTO prepaid_allocations(id,spend_transaction_id,lot_id,face_used,paid_used)
      VALUES(?,?,?,?,?)`);
    const updateLot = this.db.prepare(`UPDATE prepaid_lots SET remaining_face=remaining_face-?,remaining_paid=remaining_paid-? WHERE id=?`);
    for (const lot of lots) {
      if (remaining === 0) break;
      const usedFace = Math.min(remaining, lot.remaining_face);
      const paidUsed = allocatePrepaidCost(usedFace, lot.remaining_face, lot.remaining_paid);
      updateLot.run(usedFace, paidUsed, lot.id);
      insertAllocation.run(randomUUID(), txId, lot.id, usedFace, paidUsed);
      remaining -= usedFace;
    }
    if (remaining > 0) conflict('사용 가능한 충전금(미만료 잔액)이 부족합니다.');
  }

  private findByIdempotencyKey(key?: string): string | null {
    if (!key) return null;
    const row = this.db.prepare('SELECT id FROM transactions WHERE idempotency_key=?').get(key) as { id: string } | undefined;
    return row?.id || null;
  }

  private validateIdempotencyKey(key?: string): void {
    if (key !== undefined && (typeof key !== 'string' || key.length < 1 || key.length > 128)) {
      badRequest('Idempotency-Key 형식이 유효하지 않습니다.');
    }
  }

  private readTransaction(id: string): Transaction | null {
    const row = this.db.prepare(`SELECT id,kind,category,note,occurred_on,created_at FROM transactions WHERE id=?`).get(id) as TxRow | undefined;
    return row ? this.mapTransaction(row) : null;
  }

  private mapTransaction(row: TxRow): Transaction {
    const entries = this.db.prepare(`SELECT e.account_id, a.name AS account_name, e.amount_krw
      FROM entries e JOIN accounts a ON a.id=e.account_id
      WHERE e.transaction_id=? AND a.is_system=0 ORDER BY e.rowid`).all(row.id) as
      Array<{ account_id: string; account_name: string; amount_krw: number }>;
    const costs = this.db.prepare('SELECT SUM(paid_used) AS real_cost FROM prepaid_allocations WHERE spend_transaction_id=?').get(row.id) as
      { real_cost: number | null };
    return {
      id: row.id, kind: row.kind, note: row.note, category: row.category,
      occurredOn: row.occurred_on, createdAt: row.created_at,
      entries: entries.map((e) => ({ accountId: e.account_id, accountName: e.account_name, amountKrw: e.amount_krw })),
      realCostKrw: costs.real_cost,
    };
  }
}
