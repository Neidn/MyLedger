import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError } from '../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Categories in use, most used first. Query: kind=income|expense (optional). */
export function GET(request: NextRequest) {
  try {
    const kind = request.nextUrl.searchParams.get('kind');
    if (kind !== null && kind !== 'income' && kind !== 'expense') {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'kind는 income 또는 expense여야 합니다.' } }, { status: 400 });
    }
    return NextResponse.json({ categories: getRepository().listCategories(kind ?? undefined) });
  } catch (error) { return apiError(error); }
}
