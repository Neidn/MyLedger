import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError } from '../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try { return NextResponse.json(getRepository().getDashboard(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return apiError(error); }
}
