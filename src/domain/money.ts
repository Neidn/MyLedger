export class DomainValidationError extends Error {}

/** Strict integer-KRW arithmetic (no floating point decimals). */
export function positiveKrw(value: unknown, name = 'amount'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new DomainValidationError(`${name}: 양의 정수 원화 금액이 필요합니다.`);
  }
  return value;
}

export function nonnegativeKrw(value: unknown, name = 'amount'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new DomainValidationError(`${name}: 0 이상의 정수 원화 금액이 필요합니다.`);
  }
  return value;
}

/** FIFO lot: allocate cost proportionally; the final spend consumes rounding remainder. */
export function allocatePrepaidCost(usedFace: number, remainingFace: number, remainingPaid: number): number {
  positiveKrw(usedFace, 'usedFace');
  positiveKrw(remainingFace, 'remainingFace');
  nonnegativeKrw(remainingPaid, 'remainingPaid');
  if (usedFace > remainingFace || remainingPaid > remainingFace) {
    throw new DomainValidationError('충전금 잔량이 유효하지 않습니다.');
  }
  if (usedFace === remainingFace) return remainingPaid;
  return Number((BigInt(usedFace) * BigInt(remainingPaid)) / BigInt(remainingFace));
}

export function kstToday(): string {
  const pieces = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => pieces.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Current month in Korea, 'YYYY-MM'. */
export function kstMonth(): string {
  return kstToday().slice(0, 7);
}

/** 'YYYY-MM' -> [first day, first day of next month) as YYYY-MM-DD, for occurred_on range queries. */
export function monthRange(month: unknown): [string, string] {
  const match = typeof month === 'string' ? /^(\d{4})-(\d{2})$/.exec(month) : null;
  const year = match ? Number(match[1]) : NaN;
  const mon = match ? Number(match[2]) : NaN;
  if (!match || mon < 1 || mon > 12) throw new DomainValidationError('month: YYYY-MM 형식이 필요합니다.');
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`];
}

export function validateDate(date: unknown, name = 'date'): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainValidationError(`${name}: YYYY-MM-DD 형식이 필요합니다.`);
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new DomainValidationError(`${name}: 올바른 날짜가 아닙니다.`);
  return date;
}

export function shortText(value: unknown, max: number, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) throw new DomainValidationError(`${name}: 길이 제한을 확인하세요.`);
  return value.trim() || undefined;
}
