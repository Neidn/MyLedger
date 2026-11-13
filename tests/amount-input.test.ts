import test from 'node:test';
import assert from 'node:assert/strict';
import { caretAfterDigits, formatAmount, parseAmountInput } from '../src/lib/amount-input';

test('parseAmountInput keeps digits only, drops leading zeros, caps length', () => {
  assert.equal(parseAmountInput('1,234,567'), '1234567');
  assert.equal(parseAmountInput('12a3원'), '123');
  assert.equal(parseAmountInput('000120'), '120');
  assert.equal(parseAmountInput('0'), '0');
  assert.equal(parseAmountInput(''), '');
  assert.equal(parseAmountInput('-500'), '500');
  assert.equal(parseAmountInput('1'.repeat(20)).length, 15);
});

test('formatAmount adds thousands separators', () => {
  assert.equal(formatAmount('1234567'), '1,234,567');
  assert.equal(formatAmount('999'), '999');
  assert.equal(formatAmount('0'), '0');
  assert.equal(formatAmount(''), '');
});

test('caretAfterDigits keeps the cursor after the same digit when commas move', () => {
  // "1,234" -> typed "5" after "12": raw "1,2534", 3 digits before caret -> "12,534" caret after "125"
  assert.equal(caretAfterDigits('12,534', 3), 4);
  assert.equal(caretAfterDigits('1,234,567', 0), 0);
  assert.equal(caretAfterDigits('1,234,567', 7), 9);
  assert.equal(caretAfterDigits('1,234', 1), 1);
  assert.equal(caretAfterDigits('1,234', 2), 3);
});
