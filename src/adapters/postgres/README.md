# PostgreSQL Adapter 도입 지점

`src/domain/ports.ts`의 `LedgerRepository`를 동일한 형태로 구현하고 `src/lib/repository.ts`의 composition root에서 드라이버별로 주입한다. PostgreSQL 별도 DDL과 계약 테스트가 필요하다. **아직 구현된 어댑터가 아니므로 `DB_DRIVER=postgres` 설정만으로 전환되지 않는다.**

참고: `docs/MIGRATION.md`.
