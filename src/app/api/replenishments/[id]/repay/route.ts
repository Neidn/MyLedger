import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError, asObject } from '../../../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = asObject(await request.json());
    const transaction = getRepository().repayReplenishment(id, {
      fromAccountId: input.fromAccountId as string,
      amountKrw: input.amountKrw as number,
      occurredOn: input.occurredOn as string | undefined,
    }, request.headers.get('Idempotency-Key') || undefined);
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) { return apiError(error); }
}
