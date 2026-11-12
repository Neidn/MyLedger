'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Account, AccountType, Dashboard, TransactionKind } from '@/domain/models';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const typeLabel: Record<AccountType, string> = { bank: '은행', cash: '현금', savings: '저축', prepaid: '선결제' };
const kindLabel: Record<TransactionKind, string> = {
  opening: '초기 잔액', income: '수입', expense: '지출', transfer: '이체',
  prepaid_topup: '할인 충전', replenishment_repayment: '계좌 보충',
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `요청 오류 (${response.status})`);
  return payload as T;
}

export default function DashboardApp() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState<AccountType>('bank');
  const [openingBalance, setOpeningBalance] = useState('0');

  const [kind, setKind] = useState<'income' | 'expense' | 'transfer' | 'prepaid_topup'>('expense');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [faceAmount, setFaceAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [markReplenishment, setMarkReplenishment] = useState(false);
  const [dueOn, setDueOn] = useState('');

  const [repaySourceId, setRepaySourceId] = useState('');
  const [repayAmount, setRepayAmount] = useState('');

  const [editingId, setEditingId] = useState('');
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    const data = await jsonRequest<Dashboard>('/api/dashboard');
    setDashboard(data);
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  async function apply<T>(action: () => Promise<T>, onSuccess: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await load();
      setMessage(onSuccess);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const accounts = dashboard?.accounts || [];
  const archivedAccounts = dashboard?.archivedAccounts || [];
  const owesReplenishment = (id: string) => !!dashboard?.replenishments.some((r) => r.protectedAccountId === id && r.remainingKrw > 0);
  const nonPrepaid = accounts.filter((a) => a.type !== 'prepaid');
  const prepaid = accounts.filter((a) => a.type === 'prepaid');
  const fromOptions = kind === 'income' ? nonPrepaid : kind === 'expense' ? accounts : nonPrepaid;
  const toOptions = kind === 'prepaid_topup' ? prepaid : nonPrepaid;

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    await apply(() => jsonRequest('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newAccountName, type: newAccountType, openingBalanceKrw: Number(openingBalance) }),
    }), '계좌가 생성되었습니다.');
    setNewAccountName('');
    setOpeningBalance('0');
  }

  async function createTransaction(event: FormEvent) {
    event.preventDefault();
    const amountKrw = Number(amount);
    const common = { note: note.trim() || undefined };
    let body: Record<string, unknown>;
    if (kind === 'income' || kind === 'expense') {
      body = { kind, accountId: fromAccountId, amountKrw, category: category.trim() || undefined, ...common };
    } else if (kind === 'transfer') {
      body = {
        kind, fromAccountId, toAccountId, amountKrw, ...common,
        ...(markReplenishment ? { replenishment: dueOn ? { dueOn } : {} } : {}),
      };
    } else {
      body = { kind, fromAccountId, prepaidAccountId: toAccountId, paidAmountKrw: amountKrw, faceAmountKrw: Number(faceAmount), ...common };
    }
    await apply(() => jsonRequest('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }), '거래가 등록되었습니다.');
    setAmount(''); setFaceAmount(''); setNote('');
  }

  async function repay(id: string) {
    await apply(() => jsonRequest(`/api/replenishments/${encodeURIComponent(id)}/repay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ fromAccountId: repaySourceId, amountKrw: Number(repayAmount) }),
    }), '보충 이체가 등록되었습니다.');
    setRepayAmount('');
  }

  const accountUrl = (id: string) => `/api/accounts/${encodeURIComponent(id)}`;

  async function renameAccount(event: FormEvent, id: string) {
    event.preventDefault();
    const ok = await apply(() => jsonRequest(accountUrl(id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: editName }),
    }), '계좌 이름을 변경했습니다.');
    if (ok) setEditingId('');
  }

  async function setArchived(account: Account, archived: boolean) {
    await apply(() => jsonRequest(accountUrl(account.id), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived }),
    }), archived ? `'${account.name}' 계좌를 보관했습니다.` : `'${account.name}' 계좌를 복원했습니다.`);
  }

  async function deleteAccount(account: Account) {
    if (!window.confirm(`'${account.name}' 계좌를 삭제할까요?\n초기 잔액 기록도 함께 지워지며 되돌릴 수 없습니다.`)) return;
    await apply(() => jsonRequest(accountUrl(account.id), { method: 'DELETE' }), `'${account.name}' 계좌를 삭제했습니다.`);
  }

  const archiveBlockedReason = (a: Account) =>
    a.balanceKrw !== 0 ? '잔액이 0원이어야 보관할 수 있습니다' : owesReplenishment(a.id) ? '보충이 남아 있어 보관할 수 없습니다' : '';

  const entryText = (entry: { accountName: string; amountKrw: number }) => `${entry.accountName} ${entry.amountKrw > 0 ? '+' : ''}${won(entry.amountKrw)}`;

  return <div className="container">
    <header className="header">
      <div><div className="logo">내 가계부 <span style={{ fontSize: 18, color: '#e4be65' }}>✦</span></div><div className="subtitle">나의 돈 흐름을 한눈에</div></div>
      <div className="header-note">SQLite · 로컬 전용 MVP · 급여 주기 예측은 다음 단계</div>
    </header>

    <section className="hero">
      <div className="hero-title">내 전체 자산 · 충전금 액면 포함</div>
      <div className="hero-amount">{dashboard ? won(dashboard.totals.assetBalanceKrw) : '불러오는 중...'}</div>
      <div className="panel-note">입출금 원장의 실제 계좌 잔액 합계입니다. 선결제 혜택이 포함될 수 있으며 현금과는 구분됩니다.</div>
    </section>

    <section className="stat-grid" aria-label="자금 요약">
      <div className="stat"><div className="label">은행·현금 잔액</div><div className="value">{won(dashboard?.totals.liquidBalanceKrw || 0)}</div></div>
      <div className="stat"><div className="label">저축·목적 계좌</div><div className="value">{won(accounts.filter((a) => a.type === 'savings').reduce((sum, a) => sum + a.balanceKrw, 0))}</div></div>
      <div className="stat"><div className="label">선결제 충전금</div><div className="value">{won(dashboard?.totals.prepaidBalanceKrw || 0)}</div></div>
      <div className="stat warning"><div className="label">다시 채워야 할 돈</div><div className="value">{won(dashboard?.totals.outstandingReplenishmentKrw || 0)}</div></div>
    </section>

    {message && <div className="message" role="status">{message}</div>}
    {error && <div className="message error" role="alert">{error}</div>}

    <div className="columns">
      <div>
        <section className="panel">
          <h2>계좌 잔액</h2>
          {accounts.length === 0 ? <div className="empty">먼저 계좌를 생성해 주세요.</div> : accounts.map((a: Account) =>
            <div className="list-row" key={a.id}>
              <div style={{ minWidth: 0 }}>
                {editingId === a.id
                  ? <form className="row-inline" onSubmit={(e) => renameAccount(e, a.id)}>
                    <div className="field"><input aria-label="새 계좌 이름" required maxLength={50} autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
                    <button className="btn small" type="submit" disabled={busy || !editName.trim()}>저장</button>
                    <button className="btn small secondary" type="button" onClick={() => setEditingId('')}>취소</button>
                  </form>
                  : <>
                    <div className="list-name">{a.name}</div>
                    <div className="list-sub"><span className={`badge ${a.type === 'prepaid' ? 'prepaid' : ''}`}>{typeLabel[a.type]}</span></div>
                    <div className="account-actions">
                      <button className="btn small secondary" type="button" disabled={busy} onClick={() => { setEditingId(a.id); setEditName(a.name); }}>이름 변경</button>
                      <button className="btn small secondary" type="button" disabled={busy || !!archiveBlockedReason(a)} title={archiveBlockedReason(a) || '목록에서 숨기고 거래 등록을 막습니다'} onClick={() => setArchived(a, true)}>보관</button>
                      {a.deletable && <button className="btn small danger" type="button" disabled={busy} title="초기 잔액 외 거래가 없는 계좌만 삭제할 수 있습니다" onClick={() => deleteAccount(a)}>삭제</button>}
                    </div>
                  </>}
              </div>
              <div className="money">{won(a.balanceKrw)}</div>
            </div>)}
          {archivedAccounts.length > 0 && <details className="archived">
            <summary>보관된 계좌 {archivedAccounts.length}개</summary>
            {archivedAccounts.map((a) => <div className="list-row" key={a.id}>
              <div style={{ minWidth: 0 }}>
                <div className="list-name">{a.name}</div>
                <div className="list-sub"><span className="badge">{typeLabel[a.type]}</span> 보관됨 · 거래 기록은 유지됩니다</div>
                <div className="account-actions">
                  <button className="btn small secondary" type="button" disabled={busy} onClick={() => setArchived(a, false)}>복원</button>
                  {a.deletable && <button className="btn small danger" type="button" disabled={busy} onClick={() => deleteAccount(a)}>삭제</button>}
                </div>
              </div>
              <div className="money">{won(a.balanceKrw)}</div>
            </div>)}
          </details>}
          <div className="panel-note" style={{ marginTop: 12 }}>삭제는 초기 잔액 외 거래가 없는 계좌(잘못 만든 계좌)만 가능합니다. 거래가 있는 계좌는 잔액을 0원으로 옮긴 뒤 보관하세요.</div>
        </section>

        <section className="panel">
          <h2>보충이 필요한 계좌</h2>
          {dashboard?.replenishments.filter((r) => r.remainingKrw > 0).length === 0 && <div className="empty">현재 미보충 의무가 없습니다.</div>}
          {dashboard?.replenishments.filter((r) => r.remainingKrw > 0).map((r) =>
            <div key={r.id} style={{ paddingBottom: 16, borderTop: '1px solid #f0eee7', paddingTop: 14 }}>
              <div className="list-row" style={{ borderTop: 0, padding: '0 0 6px' }}>
                <div><div className="list-name">{r.protectedAccountName}</div><div className="list-sub">{r.destinationAccountName}로 임시 인출 · 기한 {r.dueOn || '미지정'}</div></div>
                <div className="money" style={{ color: '#a36b25' }}>{won(r.remainingKrw)}</div>
              </div>
              <div className="panel-note">처음 {won(r.principalKrw)} / 보충 완료 {won(r.repaidKrw)}</div>
              <div className="row-inline">
                <div className="field"><label htmlFor={`source-${r.id}`}>보충 출금 계좌</label>
                  <select id={`source-${r.id}`} value={repaySourceId} onChange={(e) => setRepaySourceId(e.target.value)}>
                    <option value="">계좌 선택</option>
                    {nonPrepaid.filter((a) => a.id !== r.protectedAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="field"><label htmlFor={`repay-${r.id}`}>보충 금액</label><input id={`repay-${r.id}`} type="number" min="1" step="1" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} placeholder="50000" /></div>
                <button className="btn" type="button" onClick={() => repay(r.id)} disabled={busy || !repaySourceId || !repayAmount}>보충</button>
              </div>
            </div>)}
        </section>

        <section className="panel">
          <h2>최근 거래</h2>
          {dashboard?.transactions.length === 0 && <div className="empty">등록된 거래가 없습니다.</div>}
          {dashboard?.transactions.map((t) => <div className="list-row" key={t.id}>
            <div style={{ minWidth: 0 }}><div className="list-name">{t.note || t.category || kindLabel[t.kind]}</div>
              <div className="list-sub">{t.occurredOn} · {kindLabel[t.kind]}</div>
              <div className="list-sub">{t.entries?.map(entryText).join(' / ')}</div>
              {t.kind === 'expense' && t.realCostKrw !== null && t.realCostKrw !== undefined && <div className="list-sub">실질 부담액 {won(t.realCostKrw)}</div>}
            </div>
          </div>)}
        </section>
      </div>

      <div>
        <section className="panel">
          <h2>수입 · 지출 · 이체</h2>
          <form onSubmit={createTransaction}>
            <div className="field"><label htmlFor="kind">거래 유형</label>
              <select id="kind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setFromAccountId(''); setToAccountId(''); }}>
                <option value="expense">지출</option><option value="income">수입</option><option value="transfer">계좌 간 이체</option><option value="prepaid_topup">할인 선결제 충전</option>
              </select>
            </div>
            <div className="form-grid">
              <div className="field"><label htmlFor="source">{kind === 'income' ? '입금 계좌' : kind === 'expense' ? '결제 계좌' : '출금 계좌'}</label>
                <select id="source" required value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
                  <option value="">계좌 선택</option>
                  {fromOptions.map((a) => <option key={a.id} value={a.id}>{a.name} ({won(a.balanceKrw)})</option>)}
                </select>
              </div>
              {(kind === 'transfer' || kind === 'prepaid_topup') && <div className="field"><label htmlFor="dest">{kind === 'transfer' ? '입금 계좌' : '충전 플랫폼'}</label>
                <select id="dest" required value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  <option value="">계좌 선택</option>
                  {toOptions.filter((a) => a.id !== fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>}
              <div className="field"><label htmlFor="amount">{kind === 'prepaid_topup' ? '실제 결제 금액 (원)' : '금액 (원)'}</label>
                <input id="amount" type="number" min="1" step="1" required placeholder="30000" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              {kind === 'prepaid_topup' && <div className="field"><label htmlFor="face">충전 액면 금액 (원)</label>
                <input id="face" type="number" min="1" step="1" required placeholder="100000" value={faceAmount} onChange={(e) => setFaceAmount(e.target.value)} /></div>}
              {(kind === 'expense' || kind === 'income') && <div className="field"><label htmlFor="category">항목 (선택)</label>
                <input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="식비, 급여..." /></div>}
              <div className="field full"><label htmlFor="note">메모 (선택)</label>
                <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="거래 내용" /></div>
            </div>
            {kind === 'transfer' && <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={markReplenishment} onChange={(e) => setMarkReplenishment(e.target.checked)} /> 나중에 다시 채워야 하는 임시 인출</label>
              {markReplenishment && <div className="field"><label htmlFor="due">보충 예정일 (선택)</label><input id="due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></div>}
            </div>}
            {kind === 'prepaid_topup' && <div className="notice">예: 실제 90,000원 결제 / 충전금 100,000원. 충전 시 소비 지출은 0원이며 혜택 10,000원은 별도 추적됩니다.</div>}
            <button type="submit" className="btn" disabled={busy || accounts.length === 0}>거래 등록</button>
          </form>
        </section>

        <section className="panel">
          <h2>새 계좌 만들기</h2>
          <form onSubmit={createAccount}>
            <div className="form-grid">
              <div className="field"><label htmlFor="name">계좌 이름</label><input id="name" required maxLength={50} value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="여행비 통장" /></div>
              <div className="field"><label htmlFor="accountType">유형</label><select id="accountType" value={newAccountType} onChange={(e) => setNewAccountType(e.target.value as AccountType)}>
                <option value="bank">은행</option><option value="cash">현금</option><option value="savings">저축</option><option value="prepaid">선결제 충전금</option>
              </select></div>
              <div className="field full"><label htmlFor="opening">초기 잔액 (원)</label><input id="opening" required min="0" type="number" step="1" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} /></div>
            </div>
            <button type="submit" className="btn secondary" disabled={busy}>계좌 생성</button>
          </form>
          <div className="panel-note" style={{ marginTop: 12 }}>선결제 계좌의 기존 잔액은 할인 혜택이 없는 1:1 충전금으로 취급합니다.</div>
        </section>

        <section className="panel">
          <h2>예산과 미래 자금 흐름</h2>
          <div className="notice">다음 개발 단계: 급여 주기, 고정비, 예정 계좌 보충, 날짜별 잔액 예측 및 통계를 구현할 예정입니다. 현재 화면에는 아직 예측값을 표시하지 않습니다.</div>
        </section>
      </div>
    </div>
    <footer className="footer">초기 개인용 스캐폴드입니다. 인증을 구현하기 전에는 인터넷에 공개하지 마세요. 거래 수정·취소, 환불·만료 및 자동 예측은 아직 지원되지 않습니다.</footer>
  </div>;
}
