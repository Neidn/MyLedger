import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError } from '../../../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cancels a transaction by recording its reversal. Returns the reversal. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const transaction = getRepository().cancelTransaction(id, request.headers.get('Idempotency-Key') || undefined);
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (error) { return apiError(error); }
}
