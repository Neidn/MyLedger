import type { Account, AccountType, Dashboard, Replenishment, Transaction, TransactionAmendment, TransactionCommand } from './models';

/** DB-agnostic repository contract. Neither routes nor domain import SQLite/pg. */
export interface LedgerRepository {
  listAccounts(): Account[];
  createAccount(input: { name: string; type: AccountType; openingBalanceKrw: number }): Account;
  renameAccount(id: string, name: string): Account;
  /** Requires a zero balance and no outstanding replenishment owed to the account. */
  archiveAccount(id: string): Account;
  unarchiveAccount(id: string): Account;
  /** Only for accounts with nothing but their opening balance (created by mistake). */
  deleteAccount(id: string): void;
  postTransaction(command: TransactionCommand, idempotencyKey?: string): Transaction;
  listTransactions(limit?: number): Transaction[];
  /** Records a reversal (same kind, negated entries, original date). Returns the reversal. */
  cancelTransaction(id: string, idempotencyKey?: string): Transaction;
  /** Reverses the original and posts a corrected copy atomically. Returns the replacement. */
  amendTransaction(id: string, changes: TransactionAmendment, idempotencyKey?: string): Transaction;
  listReplenishments(): Replenishment[];
  repayReplenishment(id: string, input: { fromAccountId: string; amountKrw: number; occurredOn?: string }, idempotencyKey?: string): Transaction;
  getDashboard(): Dashboard;
  checkHealth(): boolean;
}
