import type { Account, AccountType, Dashboard, Replenishment, Transaction, TransactionCommand } from './models';

/** DB-agnostic repository contract. Neither routes nor domain import SQLite/pg. */
export interface LedgerRepository {
  listAccounts(): Account[];
  createAccount(input: { name: string; type: AccountType; openingBalanceKrw: number }): Account;
  postTransaction(command: TransactionCommand, idempotencyKey?: string): Transaction;
  listTransactions(limit?: number): Transaction[];
  listReplenishments(): Replenishment[];
  repayReplenishment(id: string, input: { fromAccountId: string; amountKrw: number; occurredOn?: string }, idempotencyKey?: string): Transaction;
  getDashboard(): Dashboard;
  checkHealth(): boolean;
}
