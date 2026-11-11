# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal household ledger (가계부): multiple accounts, income/expense, transfers, discounted prepaid top-ups, and "temporary withdrawal → replenishment" obligations. Next.js 16 (App Router) + React 19 + TypeScript + `better-sqlite3`. Local-only, **no authentication** — Compose binds to `127.0.0.1`; never expose it on `0.0.0.0`. Docs and user-facing/error messages are in Korean; keep that convention.

Not yet implemented (don't assume they exist): auth, transaction edit/cancel/reversal, refunds, prepaid expiry, budgets, recurring expenses, cash-flow forecasting, PostgreSQL adapter.

## Commands

Node.js 22+.

```bash
npm install
npm run db:migrate          # create/verify schema (SQLITE_PATH, default ./data/ledger.sqlite)
npm run dev                 # next dev on 0.0.0.0:3000
npm run typecheck           # tsc --noEmit
npm test                    # tsx --test tests/*.test.ts (node:test runner)
npx tsx --test tests/money.test.ts                       # single test file
npx tsx --test --test-name-pattern="SQLite contract" tests/*.test.ts  # single test by name
npm run db:backup           # online WAL-safe backup (scripts/backup.mjs)

docker compose up -d --build   # app at http://127.0.0.1:3000, health: /api/health
```

`docker compose down --volumes` deletes both the DB and backup volumes.

## Architecture (Ports & Adapters)

- `src/domain/` — DB-independent. `models.ts` (types), `ports.ts` (`LedgerRepository` interface), `money.ts` (integer-KRW validation, prepaid cost allocation, KST date helpers, `DomainValidationError`), `postings.ts` (`createPostings` — pure double-entry posting generation, asserts every transaction sums to 0).
- `src/adapters/sqlite/repository.ts` — the only `LedgerRepository` implementation. Each command runs inside `db.transaction(...).immediate()`; it checks the `Idempotency-Key` for duplicates, validates balances, writes `transactions`/`entries`, and updates `prepaid_lots`/`prepaid_allocations`/`replenishments` atomically.
- `src/adapters/postgres/` — placeholder only. `src/lib/repository.ts` selects the adapter from `DB_DRIVER` (only `sqlite` works; anything else throws) and caches a singleton.
- `src/app/api/*/route.ts` — thin HTTP layer: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `try { ... } catch (e) { return apiError(e) }`. `_shared/http.ts` maps `DomainError` (400/404/409 from `src/lib/errors.ts`) and `DomainValidationError` to `{ error: { code, message } }`. Routes and domain must never import SQLite directly — go through `getRepository()`.
- `src/components/DashboardApp.tsx` — the single client UI, calling the JSON API.
- `sql/001_init.sql` — the schema. `scripts/migrate.mjs` applies it when `PRAGMA user_version = 0` and sets it to 1; any other version throws. Adding a schema change means adding a new numbered SQL file **and** extending the version handling in `migrate.mjs`. The Docker container runs the migration on every start.

## Domain invariants (see docs/DOMAIN_RULES.md)

- Money is always **integer KRW** (`Number.isSafeInteger`); no floats. Input amounts are positive; only ledger entries carry a sign.
- Double entry: the entries of each transaction sum to 0. Balances are derived from entries. The system accounts `SYS:income`, `SYS:expense`, `SYS:benefit`, and `SYS:opening` balance the books and are excluded from user asset totals.
- Prepaid top-up: `face >= paid`, `bonus = face - paid` is posted to `SYS:benefit`. Spends consume lots FIFO. Cost is allocated as `floor(used_face * remaining_paid / remaining_face)`, and the final spend of a lot takes the whole remainder (`allocatePrepaidCost`). Allocation-order changes belong in domain policy, not the adapter.
- A replenishment obligation is created only within the same DB transaction as the flagged withdrawal transfer. `0 <= repaid <= principal`. Deposits never reduce an obligation automatically.
- Confirmed transactions are never physically deleted; corrections are meant to be reversal entries (future work).
- `occurred_on` is a KST `YYYY-MM-DD` date; `created_at` is a UTC ISO string. Never rely on the server's local timezone.

## Testing notes

- `tests/money.test.ts` and `tests/postings.test.ts` are pure unit tests. `tests/sqlite.integration.test.ts` builds a temp DB from `sql/001_init.sql` and exercises `SqliteLedgerRepository` end to end.
- Imports use the `@/*` → `src/*` path alias.

## Ops constraints

- Keep SQLite (WAL) on a local volume, not NFS/SMB, with a single writer container.
- `next.config.ts` uses `output: "standalone"` and `serverExternalPackages: ["better-sqlite3"]`, which the Dockerfile runtime stage depends on.

## Further docs

`docs/` holds PRD, PLAN (roadmap), DOMAIN_RULES, DATABASE (ERD + verification queries), API (implemented and planned contracts), ARCHITECTURE, and MIGRATION (SQLite→PostgreSQL plan).
