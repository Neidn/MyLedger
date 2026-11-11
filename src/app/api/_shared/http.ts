import { NextResponse } from 'next/server';
import { DomainValidationError } from '@/domain/money';
import { DomainError } from '@/lib/errors';

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainValidationError('JSON 객체가 필요합니다.');
  return value as Record<string, unknown>;
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return NextResponse.json({ error: { code: error.status === 404 ? 'NOT_FOUND' : error.status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', message: error.message } }, { status: error.status });
  }
  if (error instanceof DomainValidationError || error instanceof SyntaxError) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: error.message } }, { status: 400 });
  }
  console.error('Unhandled API error', error);
  return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: '내부 처리 중 오류가 발생했습니다.' } }, { status: 500 });
}
