/** card: credit card, a liability — its balance is negative while a bill is owed. */
export type AccountType = 'bank' | 'savings' | 'cash' | 'prepaid' | 'card';
export type TransactionKind = 'opening' | 'income' | 'expense' | 'transfer' | 'prepaid_topup' | 'replenishment_repayment';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balanceKrw: number;
  createdAt: string;
  /** Archived accounts are hidden and accept no new postings; history stays intact. */
  archivedAt: string | null;
  /** True while the account has nothing but its opening balance, i.e. it can be deleted as a mistake. */
  deletable: boolean;
}

export type TransactionCommand =
  | { kind: 'income' | 'expense'; accountId: string; amountKrw: number; category?: string; note?: string; occurredOn?: string }
  | { kind: 'transfer'; fromAccountId: string; toAccountId: string; amountKrw: number; replenishment?: { dueOn?: string }; note?: string; occurredOn?: string }
  | { kind: 'prepaid_topup'; fromAccountId: string; prepaidAccountId: string; paidAmountKrw: number; faceAmountKrw: number; expiresOn?: string; note?: string; occurredOn?: string };

export interface TransactionEntry {
  accountId: string;
  accountName: string;
  amountKrw: number;
}

export interface Transaction {
  id: string;
  kind: TransactionKind;
  note: string | null;
  category: string | null;
  occurredOn: string;
  createdAt: string;
  entries?: TransactionEntry[];
  realCostKrw?: number | null;
  /** Set on a cancellation record: the transaction it reverses. */
  reversesTransactionId: string | null;
  /** Set on a cancelled transaction: the record that reversed it. */
  reversedByTransactionId: string | null;
}

export interface TransactionFilter {
  /** 'YYYY-MM': only transactions dated in that month. */
  month?: string;
  /** Case-insensitive substring of the note or category. */
  query?: string;
  limit?: number;
}

export interface CategorySpending {
  /** null = no category entered. */
  category: string | null;
  spendingKrw: number;
  /** Transactions still in effect (excludes cancelled ones and cancellation records). */
  count: number;
}

/**
 * One calendar month. Spending/income come from the SYS:expense / SYS:income legs, so card
 * purchases count when made, transfers/top-ups/bill payments never count, and a cancellation
 * (dated on the original day) nets out of the month it belongs to.
 */
export interface MonthlyReport {
  month: string;
  spendingKrw: number;
  incomeKrw: number;
  netKrw: number;
  /** Ranked by spending, largest first. */
  categories: CategorySpending[];
}

/** Fields a correction may change; everything else (kind, accounts) comes from the original. */
export interface TransactionAmendment {
  /** Amount; for a prepaid top-up this is the amount actually paid. */
  amountKrw?: number;
  /** Prepaid top-up only: face value received. */
  faceAmountKrw?: number;
  note?: string;
  category?: string;
  occurredOn?: string;
}

export interface Replenishment {
  id: string;
  protectedAccountId: string;
  protectedAccountName: string;
  destinationAccountId: string;
  destinationAccountName: string;
  principalKrw: number;
  repaidKrw: number;
  remainingKrw: number;
  dueOn: string | null;
}

export interface Dashboard {
  accounts: Account[];
  archivedAccounts: Account[];
  transactions: Transaction[];
  replenishments: Replenishment[];
  totals: {
    assetBalanceKrw: number;
    liquidBalanceKrw: number;
    prepaidBalanceKrw: number;
    /** Card bills owed (sum of negative card balances, as a positive number). */
    cardOutstandingKrw: number;
    outstandingReplenishmentKrw: number;
  };
}
