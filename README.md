# 내 가계부 (my-ledger) — SQLite + Docker Compose 시작 프로젝트

개인 사용을 위해 새로 만드는 가계부 **초기 스캐폴드**입니다. 다중 계좌·입출금·이체·할인 선결제 충전·임시 인출 후 보충을 관리합니다. 제공받은 예시 앱의 이름과 브랜딩은 사용하지 않고 기능만 요구사항 참고로 삼았습니다. Next.js + TypeScript + `better-sqlite3`를 사용하며, Repository Port / SQLite Adapter로 DB 종속성을 분리합니다.

> **주의**: 아직 **인증·권한·거래 취소/수정·환불·충전 만료 처리·예산·정기지출·미래 현금흐름 예측**은 구현되지 않았습니다. 인터넷 공개 또는 실거래 운영용이 아닙니다. 개발 환경에 Docker 실행기와 npm 레지스트리 접근이 없어 이미지 빌드 및 실제 npm 의존성 기반 E2E 실행을 직접 검증하지 못했습니다. 다만 TypeScript 구문, SQLite DDL, 순수 계산 테스트 및 Node 기본 SQLite 호환 계층을 이용한 거래 시나리오를 검사했습니다.

## 1. 실행

압축파일을 해제한 뒤 `my-ledger` 디렉터리에서 명령을 실행합니다. 별도의 저장소가 아직 없다면 `git init`으로 초기화할 수 있습니다.

```bash
cd my-ledger
git init
```


### Docker Compose 권장

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

브라우저: http://127.0.0.1:3000

> 기본값은 **로컬호스트에만** 포트를 노출합니다. 원격 PC에서 접근하려면 인증/TLS를 준비한 후 역방향 프록시를 배치하세요. 인증이 없는 상태로 Compose 포트를 `0.0.0.0`으로 변경하지 마세요.

### 로컬 개발 (Node.js 22+)

```bash
npm install
npm run db:migrate
npm run dev
```

Linux/macOS에서 경로를 지정하는 예시:

```bash
SQLITE_PATH=./data/ledger.sqlite npm run db:migrate
SQLITE_PATH=./data/ledger.sqlite npm run dev
```

기본 로컬 DB 경로는 `./data/ledger.sqlite`입니다. Docker DB 경로는 `/app/data/ledger.sqlite`입니다.

## 2. 빠른 사용 시나리오

1. 은행 계좌 `생활비`를 초기 잔액 300,000원으로 생성.
2. `여행비` 저축 계좌를 초기 잔액 1,000,000원으로 생성.
3. 저축 계좌에서 생활비로 200,000원 이체하면서 '임시 인출' 체크.
4. 홈에 여행비 보충 의무 200,000원이 나타나는지 확인.
5. 생활비 계좌에서 여행비 계좌로 50,000원 보충 실행 → 미보충 150,000원.
6. `선결제` 계좌를 초기 잔액 0원으로 생성.
7. 생활비에서 90,000원 결제하여 선결제 100,000원 충전.
8. 선결제 계좌에서 30,000원 지출 → 충전금 잔액 70,000원, 실질 부담 27,000원 표시.

## 3. 자주 쓰는 명령

```bash
# 상태 점검
curl -fsS http://127.0.0.1:3000/api/health

# 데이터 백업 (WAL 일관성 유지 온라인 백업)
docker compose exec app node scripts/backup.mjs

# 백업 파일은 Docker Compose 프로젝트 'my-ledger'의 백업 named volume에 저장됩니다.
# 별도 저장소로 복제해야 진짜 장애 복구용 백업이 됩니다.

# 개발 테스트 (npm install 이후)
npm run typecheck
npm test
```

**백업 주의:** `docker compose down --volumes`는 DB와 백업 볼륨을 함께 삭제합니다. 실제 데이터가 있으면 사용하지 마세요.

## 4. 코드 아키텍처

```text
src/app/                 화면 및 HTTP API
src/domain/models.ts     도메인 데이터 계약
src/domain/ports.ts      LedgerRepository Port
src/domain/money.ts      DB 독립 원화 계산/날짜 검증
src/domain/postings.ts   DB 독립 이중기입 원장 항목 생성
src/adapters/sqlite/     better-sqlite3 구현체
src/adapters/postgres/   나중에 연결할 어댑터 지점
src/lib/repository.ts    DB_DRIVER 기반 구체 어댑터 주입
sql/NNN_*.sql            DB 스키마 (순서대로 적용)
scripts/migrations.mjs   user_version 기반 마이그레이션 목록/실행
scripts/migrate.mjs      스키마 설치/업그레이드 CLI
scripts/backup.mjs       온라인 백업
```

`DB_DRIVER=postgres`는 아직 구현되지 않았으며 **변수만 변경해서 바로 PostgreSQL로 전환되는 것은 아닙니다**. `LedgerRepository` 계약을 그대로 구현한 PG Adapter/DDL을 추가하면 UI/도메인/API는 변경하지 않고 교체할 수 있도록 설계했습니다.

## 5. 계획 문서

- [PLAN.md](docs/PLAN.md) — 전체 개발 로드맵/구현 단계
- [PRD.md](docs/PRD.md) — 제품 요구사항과 인수 기준
- [DOMAIN_RULES.md](docs/DOMAIN_RULES.md) — 거래 원장, 선결제, 임시 인출 규칙
- [DATABASE.md](docs/DATABASE.md) — ERD, SQLite 테이블과 검증 쿼리
- [API.md](docs/API.md) — 구현 API 및 확장 예정 계약
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — Port/Adapter 및 배포 구조
- [MIGRATION.md](docs/MIGRATION.md) — SQLite→PostgreSQL 이관 계획

## 6. 운영 제약

- SQLite WAL 파일은 NFS/SMB 같은 네트워크 파일시스템이 아니라 **로컬 Docker 영속 볼륨**에 저장하세요.
- 단일 컨테이너만 SQLite DB를 쓰는 구성을 유지하세요.
- 재시작 시 자동으로 v1 스키마를 생성/확인합니다. 추후에는 순서가 보존되는 마이그레이션 파일을 추가하세요.
- PostgreSQL로 전환하기 전에 사용자 인증/소유권, 감사/역거래, 선결제 환불/만료, CSV 백업과 복원 기능을 점검하세요.
