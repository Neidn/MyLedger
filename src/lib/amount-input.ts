/** Longest digit string kept: 15 digits stays within Number.MAX_SAFE_INTEGER. */
const MAX_DIGITS = 15;

/** What the user typed -> plain digits ("1,234원" -> "1234"). Empty stays empty. */
export function parseAmountInput(text: string): string {
  return text.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS);
}

/** Plain digits -> display with thousands separators ("1234567" -> "1,234,567"). */
export function formatAmount(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Caret index in `formatted` that sits just after its `digitCount`-th digit. */
export function caretAfterDigits(formatted: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (formatted[i] >= '0' && formatted[i] <= '9' && ++seen === digitCount) return i + 1;
  }
  return formatted.length;
}
