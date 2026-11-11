import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import type { TransactionCommand } from '@/domain/models';
import { apiError, asObject } from '../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  try {
    const parsed = Number(request.nextUrl.searchParams.get('limit') || 50);
    return NextResponse.json({ transactions: getRepository().listTransactions(parsed) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const input = asObject(await request.json());
    const kind = input.kind;
    if (!['income', 'expense', 'transfer', 'prepaid_topup'].includes(String(kind))) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: '지원하지 않는 거래 유형입니다.' } }, { status: 400 });
    }
    const key = request.headers.get('Idempotency-Key') || undefined;
    const transaction = getRepository().postTransaction(input as unknown as TransactionCommand, key);
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) { return apiError(error); }
}
