/** Kinds that carry a user-chosen category. */
export type CategorizedKind = 'income' | 'expense';

/**
 * Preset categories shown as one-tap choices. Names follow what is already in use
 * (식비, 생활비, 교통비, ...) so existing history lines up. Fixed order on purpose:
 * chips stay where muscle memory expects them. Anything else goes through 기타 (free text).
 */
export const EXPENSE_CATEGORIES: readonly string[] = [
  '식비', '카페·간식', '생활비', '교통비', '통신비', '주거·관리비', '보험비', '병원비',
  '미용', '의류·쇼핑', '유흥비', '모임비', '문화·여가', '구독', '교육', '경조사·선물', '여행', '업무',
];

export const INCOME_CATEGORIES: readonly string[] = ['급여', '상여', '부업', '용돈', '이자·배당', '환급', '판매'];

/** Presets for the kind, followed by custom names already used for it (deduplicated, in the given order). */
export function categoryOptions(kind: CategorizedKind, used: readonly string[]): string[] {
  const presets = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const options = [...presets];
  for (const name of used) {
    const clean = name.trim();
    if (clean && !options.includes(clean)) options.push(clean);
  }
  return options;
}
