import { positiveKrw } from './money';

export type Posting = [accountId: string, deltaKrw: number];

type PostingCommand =
  | { kind: 'opening' | 'opening_debt' | 'income' | 'expense'; accountId: string; amountKrw: number }
  | { kind: 'transfer' | 'replenishment_repayment'; fromAccountId: string; toAccountId: string; amountKrw: number }
  | { kind: 'prepaid_topup'; fromAccountId: string; prepaidAccountId: string; paidAmountKrw: number; faceAmountKrw: number };

/** Pure business logic: DB adapters only persist balanced postings. */
export function createPostings(command: PostingCommand): Posting[] {
  let postings: Posting[];
  if (command.kind === 'opening' || command.kind === 'income') {
    const amount = positiveKrw(command.amountKrw);
    postings = [[command.accountId, amount], [command.kind === 'income' ? 'SYS:income' : 'SYS:opening', -amount]];
  } else if (command.kind === 'opening_debt') {
    // A card created with an existing bill: the card starts negative (owed).
    const amount = positiveKrw(command.amountKrw);
    postings = [[command.accountId, -amount], ['SYS:opening', amount]];
  } else if (command.kind === 'expense') {
    const amount = positiveKrw(command.amountKrw);
    postings = [[command.accountId, -amount], ['SYS:expense', amount]];
  } else if (command.kind === 'transfer' || command.kind === 'replenishment_repayment') {
    const amount = positiveKrw(command.amountKrw);
    if (command.fromAccountId === command.toAccountId) throw new Error('동일 계좌 이체는 허용되지 않습니다.');
    postings = [[command.fromAccountId, -amount], [command.toAccountId, amount]];
  } else if (command.kind === 'prepaid_topup') {
    const paid = positiveKrw(command.paidAmountKrw);
    const face = positiveKrw(command.faceAmountKrw);
    if (face < paid) throw new Error('충전 액면은 실제 결제 금액 이상이어야 합니다.');
    const bonus = face - paid;
    postings = bonus
      ? [[command.fromAccountId, -paid], [command.prepaidAccountId, face], ['SYS:benefit', -bonus]]
      : [[command.fromAccountId, -paid], [command.prepaidAccountId, face]];
  } else {
    throw new Error('지원하지 않는 원장 유형입니다.');
  }
  if (postings.reduce((sum, [, delta]) => sum + delta, 0) !== 0) throw new Error('원장 합계가 0원이 아닙니다.');
  return postings;
}
