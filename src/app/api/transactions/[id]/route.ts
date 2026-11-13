import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import type { TransactionAmendment } from '@/domain/models';
import { apiError, asObject } from '../../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Correct a transaction: reverses the original and posts a corrected copy atomically.
 * Body: any of { amountKrw, faceAmountKrw, note, category, occurredOn }.
 */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = asObject(await request.json());
    const changes: TransactionAmendment = {
      amountKrw: input.amountKrw as number | undefined,
      faceAmountKrw: input.faceAmountKrw as number | undefined,
      note: input.note as string | undefined,
      category: input.category as string | undefined,
      occurredOn: input.occurredOn as string | undefined,
    };
    const transaction = getRepository().amendTransaction(id, changes, request.headers.get('Idempotency-Key') || undefined);
    return NextResponse.json({ transaction });
  } catch (error) { return apiError(error); }
}
