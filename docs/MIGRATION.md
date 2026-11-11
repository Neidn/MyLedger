# SQLite → PostgreSQL 전환 런북

## 1. 전환 트리거

다음 중 하나라도 지속되면 PostgreSQL 도입을 검토한다.
- 동시 쓰기 요청 증가로 SQLite `SQLITE_BUSY` 대기가 반복되는 경우
- 컨테이너 여러 대에서 쓰기 처리가 필요해지는 경우
- DB를 애플리케이션과 다른 서버에서 운영해야 하는 경우
- HA/복제/세밀한 권한 제어/온라인 마이그레이션/다수 사용자 접속이 필요한 경우

단순 데이터 파일 크기만으로 반드시 이전해야 하는 것은 아니다.

## 2. 준비

1. PostgreSQL용 `PostgresLedgerRepository` 및 전용 SQL migrations 작성.
2. UUID/문자열 ID 유지, 금액은 signed `BIGINT`, 날짜 문자열은 ISO 규칙 유지 또는 date 타입 변환 정책 결정.
3. `transactions`, `entries`, `accounts`, `prepaid_lots`, `prepaid_allocations`, `replenishments`, `replenishment_payments`의 FK와 Unique/Check 보존.
4. 동일한 Port contract tests를 SQLite/PG 양쪽에 실행.
5. 테스트 DB에서 샘플 데이터 검증 후 실제 이관 실시.

## 3. 이관 순서(단일 writer, 정지 이관)

1. 사용자 공지 및 새 거래 입력 차단(유지보수 모드).
2. `docker compose exec app node scripts/backup.mjs`로 온라인 SQLite 백업 생성.
3. 백업 파일을 별도 장소로 복사하고 무결성 검사 (`PRAGMA integrity_check`).
4. PostgreSQL 신규 빈 스키마 생성.
5. 부모 테이블→자식 테이블 순서로 데이터 추출/입력, FK 및 원장 균형 검증.
6. 다음 항목을 SQLite/PG 양쪽에서 비교:
   - 전체 사용자 계좌 수 및 계좌별 잔액
   - 거래 수·원장 항목 수·보충 의무/지급 건수
   - 거래별 `SUM(entries.amount_krw)=0`인 불일치 건수(0이어야 함)
   - lot별 `remaining_face` 및 `remaining_paid`, 미보충액
7. `DB_DRIVER=postgres`, 연결 문자열 교체 후 앱 재기동.
8. 읽기 검증→시험 거래→감사 로그 확인 후 쓰기 개방.
9. 구 SQLite 원본·백업을 보존하고 복구 절차 확인.

## 4. 롤백

쓰기 개방 **전**에 검증 실패하면 구 컨테이너 및 SQLite DB를 다시 연결한다. PostgreSQL에서 실사용 신규 거래가 발생한 **후**에는 단순히 SQLite로 되돌리면 데이터가 유실될 수 있으므로 재이관/역이관 계획이 필요하다.

## 5. 주의사항

- SQLite WAL DB를 파일 복사만으로 백업하면 일관성에 문제가 생길 수 있다. SQLite Online Backup API 사용.
- SQLite는 동적 타입, PostgreSQL은 엄격한 타입이므로 값 검증과 NULL/날짜/boolean 변환이 필요하다.
- 순서 의존적인 FK를 전환 도중 임의로 제거하지 말고 별도 staging/정렬 이관을 검증한다.
- 실제 자동 이관 툴과 PostgreSQL 어댑터는 이 스캐폴드의 구현 범위 밖이다.
