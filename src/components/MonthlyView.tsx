'use client';

import { useEffect, useState } from 'react';
import type { MonthlyReport, Transaction } from '@/domain/models';
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

/** Month at a glance: totals, spending by category, and the month's transactions with search. */
export default function MonthlyView({ busy, refreshKey, onCancel, onAmend }: Props) {
  const [month, setMonth] = useState(kstMonth);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
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
  }, [month, debouncedQuery, refreshKey]);

  const isCurrent = month === kstMonth();
  const top = report?.categories[0]?.spendingKrw || 0;

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
      <section className="panel">
        <h2>항목별 지출</h2>
        {report && report.categories.length === 0 && <div className="empty">이 달의 지출이 없습니다.</div>}
        {report?.categories.map((c) => {
          const name = c.category ?? UNCATEGORISED;
          const share = report.spendingKrw > 0 ? Math.round((c.spendingKrw / report.spendingKrw) * 100) : 0;
          const width = top > 0 ? Math.max(2, (c.spendingKrw / top) * 100) : 0;
          const body = <>
            <div className="cat-head">
              <span>{name} <span className="list-sub">· {c.count}건 · {share}%</span></span>
              <span className="money">{won(c.spendingKrw)}</span>
            </div>
            <div className="cat-track" aria-hidden="true"><div className="cat-fill" style={{ width: `${width}%` }} /></div>
          </>;
          const title = `${name} · ${won(c.spendingKrw)} · ${c.count}건 · 지출의 ${share}%`;
          return c.category
            ? <button key={name} type="button" className="cat-row" title={`${title} — 눌러서 이 항목만 보기`} onClick={() => setQuery(c.category!)}>{body}</button>
            : <div key={name} className="cat-row" title={title}>{body}</div>;
        })}
        <div className="panel-note" style={{ marginTop: 12 }}>카드 결제는 결제한 날 지출로 잡히고, 카드값 납부·이체·선결제 충전은 지출이 아닙니다. 취소한 거래는 원래 날짜에서 상쇄됩니다.</div>
      </section>

      <section className="panel">
        <h2>거래 내역</h2>
        <div className="field">
          <label htmlFor="month-search">메모·항목 검색</label>
          <div className="row-inline" style={{ alignItems: 'center' }}>
            <div className="field" style={{ margin: 0 }}><input id="month-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="예: 식비, 커피" /></div>
            {query && <button className="btn small secondary" type="button" onClick={() => setQuery('')}>지우기</button>}
          </div>
        </div>
        {transactions && <div className="panel-note">{transactions.length}건{debouncedQuery ? ` · '${debouncedQuery}' 검색 결과` : ''}</div>}
        {transactions?.length === 0 && <div className="empty">{debouncedQuery ? '검색 결과가 없습니다.' : '이 달의 거래가 없습니다.'}</div>}
        {transactions?.map((t) => <TransactionRow key={t.id} t={t} busy={busy} onCancel={onCancel} onAmend={onAmend} />)}
      </section>
    </div>
  </>;
}
