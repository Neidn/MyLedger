import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePrepaidCost, nonnegativeKrw, positiveKrw, validateDate } from '../src/domain/money';

test('90,000 paid / 100,000 face: 30,000 spend is 27,000 real cost', () => {
  assert.equal(allocatePrepaidCost(30_000, 100_000, 90_000), 27_000);
});

test('rounding remainder goes to final lot usage', () => {
  const first = allocatePrepaidCost(3, 10, 7);
  const last = allocatePrepaidCost(7, 7, 7 - first);
  assert.equal(first + last, 7);
});

test('invalid amounts are rejected', () => {
  assert.throws(() => positiveKrw(0));
  assert.throws(() => nonnegativeKrw(-1));
  assert.throws(() => positiveKrw(0.1));
  assert.throws(() => positiveKrw(Number.MAX_SAFE_INTEGER + 1));
});

test('date parser rejects impossible dates', () => {
  assert.equal(validateDate('2026-11-11'), '2026-11-11');
  assert.throws(() => validateDate('2026-02-30'));
  assert.throws(() => validateDate('11/11/2026'));
});
