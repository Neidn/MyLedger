'use client';

import { useState, type FormEvent } from 'react';
import type { Transaction } from '@/domain/models';
import AmountInput from './AmountInput';
import { CATEGORY_OPTIONS_ID, enteredAmounts, kindLabel, won } from './ui';

type Props = {
  t: Transaction;
  busy: boolean;
  onCancel: (t: Transaction) => void;
  /** Sends the correction; resolves true on success so the form can close. */
  onAmend: (t: Transaction, changes: Record<string, unknown>) => Promise<boolean>;
};

const entryText = (entry: { accountName: string; amountKrw: number }) => `${entry.accountName} ${entry.amountKrw > 0 ? '+' : ''}${won(entry.amountKrw)}`;

/** One transaction with its 취소됨 / 취소 기록 state and inline 수정 / 취소. */
export default function TransactionRow({ t, busy, onCancel, onAmend }: Props) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [face, setFace] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState('');

  const cancelled = !!t.reversedByTransactionId;
  const isReversal = !!t.reversesTransactionId;
  const changeable = !cancelled && !isReversal && t.kind !== 'opening';

  function startEdit() {
    const entered = enteredAmounts(t);
    setAmount(String(entered.amount));
    setFace(entered.face !== undefined ? String(entered.face) : '');
    setNote(t.note || '');
    setCategory(t.category || '');
    setDate(t.occurredOn);
    setEditing(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const changes: Record<string, unknown> = { amountKrw: Number(amount), note: note.trim(), occurredOn: date };
    if (t.kind === 'prepaid_topup') changes.faceAmountKrw = Number(face);
    if (t.kind === 'income' || t.kind === 'expense') changes.category = category.trim();
    if (await onAmend(t, changes)) setEditing(false);
  }

  return <div className={`list-row ${cancelled ? 'cancelled' : ''}`}>
    <div style={{ minWidth: 0 }} className={editing ? 'tx-edit' : ''}>
      <div className="list-name">{t.note || t.category || kindLabel[t.kind]}</div>
      <div className="list-sub">{t.occurredOn} · {kindLabel[t.kind]}{t.category && t.note ? ` · ${t.category}` : ''}
        {cancelled && <> <span className="badge cancelled">취소됨</span></>}
        {isReversal && <> <span className="badge reversal">취소 기록</span></>}
      </div>
      <div className="list-sub">{t.entries?.map(entryText).join(' / ')}</div>
      {t.kind === 'expense' && !isReversal && t.realCostKrw !== null && t.realCostKrw !== undefined && <div className="list-sub">실질 부담액 {won(t.realCostKrw)}</div>}
      {editing
        ? <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label htmlFor={`tx-amount-${t.id}`}>{t.kind === 'prepaid_topup' ? '실제 결제 금액 (원)' : '금액 (원)'}</label>
              <AmountInput id={`tx-amount-${t.id}`} required value={amount} onValueChange={setAmount} /></div>
            {t.kind === 'prepaid_topup' && <div className="field"><label htmlFor={`tx-face-${t.id}`}>충전 액면 금액 (원)</label>
              <AmountInput id={`tx-face-${t.id}`} required value={face} onValueChange={setFace} /></div>}
            {(t.kind === 'income' || t.kind === 'expense') && <div className="field"><label htmlFor={`tx-cat-${t.id}`}>항목</label>
              <input id={`tx-cat-${t.id}`} list={CATEGORY_OPTIONS_ID} value={category} onChange={(e) => setCategory(e.target.value)} /></div>}
            <div className="field"><label htmlFor={`tx-date-${t.id}`}>날짜</label>
              <input id={`tx-date-${t.id}`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field full"><label htmlFor={`tx-note-${t.id}`}>메모</label>
              <input id={`tx-note-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <div className="account-actions">
            <button className="btn small" type="submit" disabled={busy || !amount}>저장</button>
            <button className="btn small secondary" type="button" onClick={() => setEditing(false)}>닫기</button>
          </div>
        </form>
        : changeable && <div className="account-actions">
          {t.kind !== 'replenishment_repayment' && <button className="btn small secondary" type="button" disabled={busy} onClick={startEdit}>수정</button>}
          <button className="btn small danger" type="button" disabled={busy} onClick={() => onCancel(t)}>취소</button>
        </div>}
    </div>
  </div>;
}
