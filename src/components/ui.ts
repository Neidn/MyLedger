import type { AccountType, Transaction, TransactionKind } from '@/domain/models';

export const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
export const typeLabel: Record<AccountType, string> = { bank: '은행', cash: '현금', savings: '저축', prepaid: '선결제', card: '카드' };
export const kindLabel: Record<TransactionKind, string> = {
  opening: '초기 잔액', income: '수입', expense: '지출', transfer: '이체',
  prepaid_topup: '할인 충전', replenishment_repayment: '계좌 보충',
};

/** Shared <datalist> id for category suggestions. */
export const CATEGORY_OPTIONS_ID = 'category-options';

/** Amounts as entered, recovered from the user-account entries (system legs are not listed). */
export function enteredAmounts(t: Transaction): { amount: number; face?: number } {
  const entries = t.entries || [];
  const out = entries.find((e) => e.amountKrw < 0)?.amountKrw ?? 0;
  const into = entries.find((e) => e.amountKrw > 0)?.amountKrw ?? 0;
  if (t.kind === 'prepaid_topup') return { amount: -out, face: into };
  if (t.kind === 'expense') return { amount: -out };
  return { amount: into };
}

export async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `요청 오류 (${response.status})`);
  return payload as T;
}
