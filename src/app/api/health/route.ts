import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError } from '../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const ready = getRepository().checkHealth();
    return NextResponse.json({ status: ready ? 'ok' : 'error', db: 'sqlite' }, { status: ready ? 200 : 503 });
  } catch (error) { return apiError(error); }
}
