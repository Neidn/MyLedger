# HTTP API 설계 (API)

- 베이스 경로: `/api`
- 통화: KRW, 정수 원
- Content-Type: `application/json`
- 날짜: `YYYY-MM-DD` (한국 기준)
- ID: UUID 문자열
- 초기 배포: 로컬 전용 / 인증 미구현. 외부 서비스 전 인증 및 `user_id` 권한 필요.

## 1. 초기 스캐폴드에 포함된 API

### `GET /api/health`

정상 응답: `{ "status": "ok", "db": "sqlite" }`

### `GET /api/accounts`

```json
{ "accounts": [{ "id": "uuid", "name": "생활비", "type": "bank", "balanceKrw": 600000, "createdAt": "…", "archivedAt": null, "deletable": false }] }
```

보관된 계좌도 포함한다(`archivedAt` 값 존재). `GET /api/dashboard`는 `accounts`(활성)와 `archivedAccounts`(보관)로 나눠 반환한다. `deletable`은 초기 잔액 외 거래와 보충 연결이 없을 때 `true`.

### `POST /api/accounts`

```json
{ "name": "여행비", "type": "savings", "openingBalanceKrw": 1000000 }
```

허용 type: `bank`, `savings`, `cash`, `prepaid`, `card`. `card`의 `openingBalanceKrw`는 **현재 결제 예정액**(빚)이며 잔액은 음수로 시작한다. 선결제 시작 잔액이 있으면 100% 실결제된 기존 충전 잔액 lot으로 해석한다. 보너스가 포함된 실제 충전 내역을 복원하려면 초기 잔액 대신 개별 충전 데이터 마이그레이션이 필요하다.

### `PATCH /api/accounts/{id}`

```json
{ "name": "월급 통장" }
{ "archived": true }
{ "archived": false }
```

- `name`: 이름만 변경(1~50자). 잔액·원장에는 영향 없음.
- `archived: true`: 잔액 0원이고 이 계좌로 갚아야 할 보충 의무가 없을 때만 보관(아니면 409). 보관된 계좌로의 새 거래는 409.
- `archived: false`: 복원.
- 응답: `{ "account": { … } }`. 둘 다 없으면 400.

### `DELETE /api/accounts/{id}`

잘못 만든 계좌 삭제. `deletable`(초기 잔액 외 거래·보충 연결 없음)일 때만 허용하며, 해당 개시 거래와 개시 lot도 함께 삭제한다. 거래가 있으면 409 — 대신 보관한다. 응답: `{ "deletedId": "uuid" }`.

### `GET /api/transactions?limit=50`

최신 거래와 계좌 이동을 반환한다.

### `POST /api/transactions`

요청 헤더 `Idempotency-Key: <클라이언트 생성 UUID>`를 권장한다.

**수입**

```json
{ "kind": "income", "accountId": "uuid", "amountKrw": 3000000, "category": "급여", "note": "월 급여", "occurredOn": "2026-11-11" }
```

**지출**

```json
{ "kind": "expense", "accountId": "uuid", "amountKrw": 30000, "category": "식비", "note": "점심" }
```

**계좌 이체**

```json
{ "kind": "transfer", "fromAccountId": "uuid", "toAccountId": "uuid", "amountKrw": 200000, "note": "여행비 임시 사용", "replenishment": { "dueOn": "2026-11-25" } }
```

보충 의무를 만들지 않는 이체는 `replenishment` 속성을 생략한다.

**할인 선결제 충전**

```json
{ "kind": "prepaid_topup", "fromAccountId": "bank-uuid", "prepaidAccountId": "prepaid-uuid", "paidAmountKrw": 90000, "faceAmountKrw": 100000, "expiresOn": "2027-01-31" }
```

**충전금 소비**: 일반 expense와 같지만 `accountId`에 `prepaid` 계좌를 지정한다. 서버가 FIFO 원가 배분 및 사용 혜택을 계산한다.

성공 응답(201 또는 동일 Idempotency-Key 중복 처리 시 200):

```json
{ "transaction": { "id": "uuid", "kind": "prepaid_topup", "occurredOn": "2026-11-11" } }
```

### `GET /api/replenishments`

```json
{ "replenishments": [{ "id": "uuid", "protectedAccountName": "여행비", "principalKrw": 200000, "repaidKrw": 50000, "remainingKrw": 150000, "dueOn": "2026-11-25" }] }
```

### `POST /api/transactions/{id}/cancel`

거래 취소 = 역거래 기록(같은 유형, 원장 부호 반전, 원거래 날짜). 응답 201 `{ "transaction": <역거래> }`. 거래 목록의 각 항목은 `reversesTransactionId`(역거래일 때 원거래 id)와 `reversedByTransactionId`(취소된 거래일 때 역거래 id)를 가진다. 거부 조건은 DOMAIN_RULES §7. `Idempotency-Key` 지원.

### `PATCH /api/transactions/{id}`

```json
{ "amountKrw": 5000, "note": "점심", "category": "식비", "occurredOn": "2026-11-10" }
```

거래 수정 = 원거래 취소 + 정정 거래 재등록(원자적). 생략한 값은 원거래 값을 유지한다. `prepaid_topup`은 `amountKrw`=실결제액, `faceAmountKrw`=액면. 계좌·유형은 바꿀 수 없다. 보충 거래와 초기 잔액은 400. 응답 `{ "transaction": <정정 거래> }`.

### `POST /api/replenishments/:id/repay`

```json
{ "fromAccountId": "생활비계좌-uuid", "amountKrw": 50000, "occurredOn": "2026-11-11" }
```

서버가 출금 계좌→보호 계좌 이체를 확정하고, 해당 보충 의무 잔액을 감소시킨다.

### `GET /api/dashboard`

```json
{
  "accounts": [],
  "transactions": [],
  "replenishments": [],
  "totals": { "assetBalanceKrw": 0, "liquidBalanceKrw": 0, "prepaidBalanceKrw": 0, "outstandingReplenishmentKrw": 0 }
}
```

`assetBalanceKrw`에는 사용자의 은행·현금·저축·충전 자산이 합산되며, 적립 혜택도 액면으로 포함된다. 현금화할 수 있는 자산만을 의미하지는 않는다. `liquidBalanceKrw`는 은행+현금만 포함하고 보호된 저축과 선결제 잔액은 별도다.

## 2. 오류 계약

| HTTP 상태 | 코드 | 의미 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 금액/날짜/계좌 유형 오류 |
| 404 | `NOT_FOUND` | 존재하지 않는 계좌/의무 |
| 409 | `CONFLICT` | 잔액 부족/충전 잔여 부족/중복 등 업무 충돌 |
| 500 | `INTERNAL_ERROR` | 처리되지 않은 내부 오류. 스택 노출 금지 |

```json
{ "error": { "code": "CONFLICT", "message": "잔액이 부족합니다." } }
```

## 3. 추가 예정 API (아직 구현되지 않음)

| 메서드 | URL | 목적 |
|---|---|---|
| GET/POST | `/api/budgets` | 카테고리별 예산 |
| GET/POST | `/api/budget-cycles` | 급여 주기 설정 |
| GET/POST | `/api/recurring-rules` | 정기 수입/지출 |
| GET/POST | `/api/scheduled-transactions` | 미확정 예정 거래 |
| GET | `/api/forecast?until=YYYY-MM-DD` | 날짜별 미래 현금흐름 |
| GET/POST | `/api/funding-goals` | 목적자금 관리 |
| POST | `/api/transactions/:id/reverse` | 거래 취소/역분개 |
| POST | `/api/prepaid/:id/refund` | 충전금 환불 |
| POST | `/api/prepaid/:id/expire` | 충전금 소멸 |
| POST | `/api/import/csv` | 외부 거래 데이터 가져오기 |

## 4. 향후 API 진화 원칙

- 기존 필드 의미를 바꾸지 않는다. breaking change가 필요하면 `/api/v2`를 도입한다.
- 현재 응답 포맷은 스캐폴드 수준이며, 프로덕션 전 OpenAPI와 인증/리소스 소유 관계를 확정한다.
- `Idempotency-Key`는 같은 payload에만 재사용하도록 요청 본문 해시 검증을 추가한다.
