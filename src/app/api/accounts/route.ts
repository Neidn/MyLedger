import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError, asObject } from '../_shared/http';
import type { AccountType } from '@/domain/models';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try { return NextResponse.json({ accounts: getRepository().listAccounts() }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const input = asObject(await request.json());
    const account = getRepository().createAccount({
      name: input.name as string,
      type: input.type as AccountType,
      openingBalanceKrw: (input.openingBalanceKrw ?? 0) as number,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) { return apiError(error); }
}
