'use client';

import { useEffect, useState } from 'react';
import type { CategoryIncome, MonthlyReport, Transaction, TransactionType } from '@/domain/models';
import { kstMonth } from '@/domain/money';
import TransactionRow from './TransactionRow';
import { jsonRequest, won } from './ui';

type Props = {
  busy: boolean;
  /** Bumped by the parent after any change so this view reloads. */
  refreshKey: number;
  onCancel: (t: Transaction) => void;
  onAmend: (t: Transaction, changes: Record<string, unknown>) => Promise<boolean>;
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
const UNCATEGORISED = '미분류';
const TYPE_FILTERS: Array<[TransactionType | 'all', string]> = [['all', '전체'], ['expense', '지출'], ['income', '수입'], ['other', '이체·기타']];

type BarsProps = {
  /** '지출' or '수입', used in labels. */
  of: string;
  total: number;
  rows: CategoryIncome[];
  /** Filter the transaction list to a category. */
  onPick: (category: string) => void;
  /** Income bars use their own hue so the two charts aren't confused. */
  income?: boolean;
};

/**
 * Ranked horizontal bars, one hue per chart (spending #a8792a 3.87:1, income #3f7d64 4.85:1
 * on white), 4px rounded ends on a light track. Name, count, share and amount are text, so the
 * bar is never the only carrier of the number. Named categories are buttons that filter the list.
 */
function CategoryBars({ of, total, rows, onPick, income }: BarsProps) {
  const top = rows[0]?.amountKrw || 0;
  return <>{rows.map((c) => {
    const name = c.category ?? UNCATEGORISED;
    const share = total > 0 ? Math.round((c.amountKrw / total) * 100) : 0;
    const width = top > 0 ? Math.max(2, (c.amountKrw / top) * 100) : 0;
    const body = <>
      <div className="cat-head">
        <span>{name} <span className="list-sub">· {c.count}건 · {share}%</span></span>
        <span className="money">{won(c.amountKrw)}</span>
      </div>
      <div className="cat-track" aria-hidden="true"><div className={`cat-fill ${income ? 'income' : ''}`} style={{ width: `${width}%` }} /></div>
    </>;
    const title = `${name} · ${won(c.amountKrw)} · ${c.count}건 · ${of}의 ${share}%`;
    return c.category
      ? <button key={name} type="button" className="cat-row" title={`${title} — 눌러서 이 항목만 보기`} onClick={() => onPick(c.category!)}>{body}</button>
      : <div key={name} className="cat-row" title={title}>{body}</div>;
  })}</>;
}

/** Month at a glance: totals, spending by category, and the month's transactions with search. */
export default function MonthlyView({ busy, refreshKey, onCancel, onAmend }: Props) {
  const [month, setMonth] = useState(kstMonth);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [type, setType] = useState<TransactionType | 'all'>('all');
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let stale = false;
    const params = new URLSearchParams({ month, limit: '500' });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (type !== 'all') params.set('type', type);
    Promise.all([
      jsonRequest<{ report: MonthlyReport }>(`/api/reports/monthly?month=${month}`),
      jsonRequest<{ transactions: Transaction[] }>(`/api/transactions?${params}`),
    ]).then(([r, t]) => {
      if (stale) return;
      setReport(r.report);
      setTransactions(t.transactions);
      setError('');
    }).catch((e: Error) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [month, debouncedQuery, type, refreshKey]);

  // Net of what is listed: user-account legs of income are +, of spending -; reversal rows
  // carry the opposite sign, so cancelled items net out just like in the report.
  const listedTotal = (transactions ?? []).flatMap((t) => t.entries ?? []).reduce((n, e) => n + e.amountKrw, 0);
  const filterLabel = TYPE_FILTERS.find(([id]) => id === type)?.[1] ?? '';

  const isCurrent = month === kstMonth();

  return <>
    <section className="panel month-nav" aria-label="월 선택">
      <button className="btn small secondary" type="button" aria-label="이전 달" onClick={() => setMonth((m) => shiftMonth(m, -1))}>◀</button>
      <h2 style={{ margin: 0 }}>{monthLabel(month)}</h2>
      <div className="account-actions" style={{ marginTop: 0 }}>
        {!isCurrent && <button className="btn small secondary" type="button" onClick={() => setMonth(kstMonth())}>이번 달</button>}
        <button className="btn small secondary" type="button" aria-label="다음 달" onClick={() => setMonth((m) => shiftMonth(m, 1))}>▶</button>
      </div>
    </section>

    {error && <div className="message error" role="alert">{error}</div>}

    <section className="stat-grid three" aria-label={`${monthLabel(month)} 요약`}>
      <div className="stat"><div className="label">지출</div><div className="value">{report ? won(report.spendingKrw) : '…'}</div></div>
      <div className="stat"><div className="label">수입</div><div className="value">{report ? won(report.incomeKrw) : '…'}</div></div>
      <div className="stat"><div className="label" title="수입 − 지출">순수입</div><div className="value">{report ? won(report.netKrw) : '…'}</div></div>
    </section>

    <div className="columns top">
      <div>
        <section className="panel">
          <h2>항목별 지출</h2>
          {report && report.categories.length === 0 && <div className="empty">이 달의 지출이 없습니다.</div>}
          {report && <CategoryBars of="지출" total={report.spendingKrw} onPick={(c) => { setType('expense'); setQuery(c); }}
            rows={report.categories.map((c) => ({ category: c.category, amountKrw: c.spendingKrw, count: c.count }))} />}
          <div className="panel-note" style={{ marginTop: 12 }}>카드 결제는 결제한 날 지출로 잡히고, 카드값 납부·이체·선결제 충전은 지출이 아닙니다. 취소한 거래는 원래 날짜에서 상쇄됩니다.</div>
        </section>

        <section className="panel">
          <h2>항목별 수입</h2>
          {report && report.incomeCategories.length === 0 && <div className="empty">이 달의 수입이 없습니다.</div>}
          {report && <CategoryBars of="수입" total={report.incomeKrw} onPick={(c) => { setType('income'); setQuery(c); }} rows={report.incomeCategories} income />}
        </section>
      </div>

      <section className="panel">
        <h2>거래 내역</h2>
        <div className="chips" role="group" aria-label="거래 종류">
          {TYPE_FILTERS.map(([id, label]) =>
            <button key={id} type="button" className="chip" aria-pressed={type === id} onClick={() => setType(id)}>{label}</button>)}
        </div>
        <div className="field">
          <label htmlFor="month-search">메모·항목 검색</label>
          <div className="row-inline" style={{ alignItems: 'center' }}>
            <div className="field" style={{ margin: 0 }}><input id="month-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 식비, 커피" /></div>
            {query && <button className="btn small secondary" type="button" onClick={() => setQuery('')}>지우기</button>}
          </div>
        </div>
        {transactions && <div className="list-summary">
          <span>{type !== 'all' ? `${filterLabel} ` : ''}{transactions.length}건{debouncedQuery ? ` · '${debouncedQuery}' 검색` : ''}</span>
          {type === 'expense' && <span>합계 <strong className="money">{won(-listedTotal)}</strong></span>}
          {type === 'income' && <span>합계 <strong className="money">{won(listedTotal)}</strong></span>}
        </div>}
        {transactions?.length === 0 && <div className="empty">{debouncedQuery || type !== 'all' ? '조건에 맞는 거래가 없습니다.' : '이 달의 거래가 없습니다.'}</div>}
        {transactions?.map((t) => <TransactionRow key={t.id} t={t} busy={busy} onCancel={onCancel} onAmend={onAmend} />)}
      </section>
    </div>
  </>;
}
