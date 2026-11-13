import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostings } from '../src/domain/postings';

const total = (entries: Array<[string, number]>) => entries.reduce((sum, [, amount]) => sum + amount, 0);

test('income, expense and transfer postings balance to zero', () => {
  const cases = [
    createPostings({ kind: 'income', accountId: 'A', amountKrw: 3000000 }),
    createPostings({ kind: 'expense', accountId: 'A', amountKrw: 20000 }),
    createPostings({ kind: 'transfer', fromAccountId: 'A', toAccountId: 'B', amountKrw: 200000 }),
  ];
  for (const entries of cases) assert.equal(total(entries), 0);
});

test('card opening debt makes the card negative and balances against SYS:opening', () => {
  const entries = createPostings({ kind: 'opening_debt', accountId: 'C', amountKrw: 50000 });
  assert.deepEqual(entries, [['C', -50000], ['SYS:opening', 50000]]);
});

test('prepaid discount creates noncash benefit leg', () => {
  const entries = createPostings({ kind: 'prepaid_topup', fromAccountId: 'BANK', prepaidAccountId: 'PREPAID', paidAmountKrw: 90000, faceAmountKrw: 100000 });
  assert.deepEqual(entries, [['BANK', -90000], ['PREPAID', 100000], ['SYS:benefit', -10000]]);
  assert.equal(total(entries), 0);
});
