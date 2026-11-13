import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import { kstMonth } from '@/domain/money';
import { apiError } from '../../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Query: month=YYYY-MM (default: current month in Korea). */
export function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get('month') || kstMonth();
    return NextResponse.json({ report: getRepository().getMonthlyReport(month) });
  } catch (error) { return apiError(error); }
}
