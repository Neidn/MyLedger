import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryOptions } from '../src/domain/categories';

test('presets are separate per kind and have no duplicates', () => {
  assert.ok(EXPENSE_CATEGORIES.includes('식비'));
  assert.ok(INCOME_CATEGORIES.includes('급여'));
  assert.ok(!EXPENSE_CATEGORIES.includes('급여'));
  assert.ok(!INCOME_CATEGORIES.includes('식비'));
  for (const list of [EXPENSE_CATEGORIES, INCOME_CATEGORIES]) assert.equal(new Set(list).size, list.length);
});

test('categoryOptions: presets in fixed order, then custom names already used', () => {
  const options = categoryOptions('expense', ['유흥비', '식비', '반려동물', '  ', '반려동물']);
  assert.deepEqual(options.slice(0, EXPENSE_CATEGORIES.length), [...EXPENSE_CATEGORIES]);
  assert.deepEqual(options.slice(EXPENSE_CATEGORIES.length), ['반려동물']);
});

test('categoryOptions: income uses income presets', () => {
  assert.deepEqual(categoryOptions('income', ['식비']), [...INCOME_CATEGORIES, '식비']);
  assert.deepEqual(categoryOptions('income', []), [...INCOME_CATEGORIES]);
});
