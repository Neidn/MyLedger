import { NextResponse, type NextRequest } from 'next/server';
import { getRepository } from '@/lib/repository';
import { apiError, asObject } from '../../_shared/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** Body: { name: string } to rename, or { archived: boolean } to archive/restore. */
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const input = asObject(await request.json());
    const repo = getRepository();
    let account;
    if (input.name !== undefined) account = repo.renameAccount(id, input.name as string);
    if (input.archived === true) account = repo.archiveAccount(id);
    else if (input.archived === false) account = repo.unarchiveAccount(id);
    if (!account) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'name 또는 archived 값이 필요합니다.' } }, { status: 400 });
    }
    return NextResponse.json({ account });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    getRepository().deleteAccount(id);
    return NextResponse.json({ deletedId: id });
  } catch (error) { return apiError(error); }
}
