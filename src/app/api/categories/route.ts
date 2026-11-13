import { NextResponse } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError } from '../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Categories in use, most used first. */
export function GET() {
  try { return NextResponse.json({ categories: getRepository().listCategories() }); }
  catch (error) { return apiError(error); }
}
