export class DomainError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string) { super(message); }
}
export function badRequest(message: string): never { throw new DomainError(400, message); }
export function notFound(message: string): never { throw new DomainError(404, message); }
export function conflict(message: string): never { throw new DomainError(409, message); }
