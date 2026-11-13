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
