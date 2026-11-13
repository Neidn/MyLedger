'use client';

import { useLayoutEffect, useRef, type InputHTMLAttributes } from 'react';
import { caretAfterDigits, formatAmount, parseAmountInput } from '@/lib/amount-input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  /** Plain digits, e.g. "1234567". */
  value: string;
  onValueChange: (digits: string) => void;
};

/** Won amount field that shows thousands separators while typing ("1,234,567"). */
export default function AmountInput({ value, onValueChange, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  // Digits that were left of the caret at the last edit; restored after commas move.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pendingCaret.current === null || document.activeElement !== el) return;
    const pos = caretAfterDigits(el.value, pendingCaret.current);
    el.setSelectionRange(pos, pos);
    pendingCaret.current = null;
  }, [value]);

  return <input
    {...rest}
    ref={ref}
    type="text"
    inputMode="numeric"
    autoComplete="off"
    value={formatAmount(value)}
    onChange={(e) => {
      const caret = e.target.selectionStart ?? e.target.value.length;
      pendingCaret.current = parseAmountInput(e.target.value.slice(0, caret)).length;
      onValueChange(parseAmountInput(e.target.value));
    }}
  />;
}
