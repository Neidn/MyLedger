'use client';

import { createContext, useContext, useState } from 'react';
import { categoryOptions, type CategorizedKind } from '@/domain/categories';

/** Categories already used, per kind; DashboardApp provides it after each load. */
export const UsedCategoriesContext = createContext<Record<CategorizedKind, string[]>>({ income: [], expense: [] });

type Props = {
  kind: CategorizedKind;
  /** Selected category; '' = none. */
  value: string;
  onChange: (category: string) => void;
  id: string;
  label?: string;
};

/**
 * One-tap category chips: presets for the kind, then custom names already used, then
 * 기타 (직접 입력) for a free-text name. Tapping the selected chip clears it (category is optional).
 * Give it key={kind} so switching income/expense resets the free-text mode.
 */
export default function CategoryPicker({ kind, value, onChange, id, label = '항목 (선택)' }: Props) {
  const used = useContext(UsedCategoriesContext)[kind];
  const options = categoryOptions(kind, used);
  const [custom, setCustom] = useState(() => !!value && !options.includes(value));

  return <div className="field">
    <span className="field-label" id={`${id}-label`}>{label}</span>
    <div className="chips" role="group" aria-labelledby={`${id}-label`}>
      {options.map((name) => {
        const selected = !custom && value === name;
        return <button key={name} type="button" className="chip" aria-pressed={selected}
          onClick={() => { setCustom(false); onChange(selected ? '' : name); }}>{name}</button>;
      })}
      <button type="button" className="chip" aria-pressed={custom}
        onClick={() => { setCustom(!custom); onChange(''); }}>기타 (직접 입력)</button>
    </div>
    {custom && <input id={id} aria-label="항목 직접 입력" maxLength={60} autoFocus value={value}
      onChange={(e) => onChange(e.target.value)} placeholder="예: 반려동물" />}
  </div>;
}
