# AGENTS.md

이 파일은 이 repository에서 작업하는 모든 AI coding agent의 기본 작업 규칙이다.

## Project Status

- 이 repository는 한국 사주/운세 기반 서비스의 Backend API다.
- 이 repository가 API 계약, 비즈니스 규칙, 데이터 무결성, 보안 경계의 source of truth다.
- 현재 주요 API consumer인 Frontend는 별도 repository `saju-platform`에서 관리하지만, Frontend의 화면 구조나 구현 방식이 Backend 구조를 결정하지 않는다.
- 현재 단계는 Backend Foundation 및 API Contract 설계 단계다.
- 서비스명은 확정되지 않았으므로 코드, 변수, 디렉터리, 문서에 특정 브랜드명을 강하게 결합하지 않는다.
- 필요한 기능을 얇은 vertical slice로 구현하고, 사용되지 않는 module이나 abstraction을 미리 만들지 않는다.

## Required Reading

코드를 작성하거나 구조를 변경하기 전에 반드시 다음을 확인한다.

1. `AGENTS.md`
2. 현재 작업과 관련된 server code와 test
3. 작업에 영향을 받는 server configuration, Prisma schema/migration, OpenAPI schema
4. 만세력 작업이라면 `../saju-platform/docs/manseoryeok_contract.md`
5. 제품 요구사항이나 전체 시스템 판단이 필요하다면 `../saju-platform/docs/product_context.md`와 `../saju-platform/docs/architecture.md`

Sibling Frontend repository 확인은 기본 선행 조건이 아니다. 다음 경우에만 관련 API 호출부와 mapper를 확인한다.

- 공개 API의 path, request, response, 인증 방식 또는 오류 계약을 변경하는 경우
- 사용자 요청이 Frontend와 Backend를 함께 다루는 경우
- server 내부 자료만으로 제품 요구사항을 확정할 수 없는 경우

Frontend 구현은 요구사항과 호환성을 이해하기 위한 참고 자료이며 Backend 계약의 source of truth가 아니다. 사용자가 명시하지 않은 Frontend 수정은 수행하지 않는다. Sibling repository나 문서가 없으면 추측으로 외부 계약을 바꾸지 말고, server 내부 계약과 사용자 요구사항을 기준으로 작업한다.

## System Boundary

이 repository를 기준으로 한 시스템 경계는 다음과 같다.

```text
External Clients
  -> HTTPS JSON API / OpenAPI
NestJS Backend (this repository)
  -> Prisma -> Supabase PostgreSQL
  -> Auth, AI, Payment, Storage Providers
```

Backend는 다음을 담당한다.

- 인증 토큰 검증과 최종 인가 판단
- 요청 데이터 검증과 정규화
- 비즈니스 규칙과 use case 실행
- Prisma를 통한 database 접근
- 만세력 계산과 불변 Snapshot 생성
- AI Provider 연동과 응답 정규화
- 결제 요청 및 webhook 검증
- Presigned URL 발급
- API 문서와 계약 제공

Backend에 다음을 넣지 않는다.

- 화면 렌더링이나 특정 client 전용 view state
- 특정 화면 route, component 또는 UI 문구에 종속된 로직
- client가 수행해야 하는 단순 presentation formatting
- source code에 포함된 credential, secret, service role key
- 특정 AI Provider의 원본 응답을 그대로 노출하는 API 계약

Client가 보낸 사용자 ID, 가격, 결제 완료 여부, 리소스 소유권은 신뢰하지 않는다. 서버가 인증 정보와 저장된 데이터로 다시 판단한다.

## Stack

- Node.js 24
- NestJS 12
- TypeScript strict mode
- ECMAScript modules (`type: module`, `NodeNext`)
- npm
- Prisma 7
- Supabase PostgreSQL
- Zod
- Vitest
- Oxlint

새 dependency를 추가하기 전에 Node.js, NestJS 또는 현재 dependency로 해결 가능한지 확인한다. NestJS 12와 peer dependency가 맞지 않는 package를 `--force` 또는 `--legacy-peer-deps`로 설치하지 않는다.

## Module Architecture

도메인 기능은 NestJS feature module 단위로 구성한다.

```text
src/
  main.ts
  app.module.ts
  modules/
    auth/
    users/
    saju-profiles/
    saju-charts/
    readings/
    payments/
    uploads/
  common/
  config/
  database/
```

위 디렉터리는 목표 구조이며 실제 기능이 생길 때만 만든다.

- `modules`: 도메인별 controller, application service, domain policy, persistence adapter
- `common`: 여러 module에서 실제로 공유하는 framework 수준 코드
- `config`: 환경변수 schema와 typed configuration
- `database`: Prisma client lifecycle과 공통 database infrastructure

Controller는 HTTP 변환과 use case 호출만 담당한다. 비즈니스 로직과 Prisma query를 controller에 작성하지 않는다.

Service가 비대해지면 책임에 따라 use case 또는 domain service로 나눈다. 단순 CRUD에 repository interface나 계층을 기계적으로 추가하지 않는다.

Module 간에는 상대 module의 내부 파일을 직접 import하지 않고 public provider 또는 명시적인 public API를 사용한다. 순환 의존성을 `forwardRef`로 습관적으로 해결하지 않는다.

## TypeScript and ESM Rules

- `strict` typing을 유지한다.
- `any`, 무분별한 type assertion, `@ts-ignore`를 사용하지 않는다.
- 외부 입력은 `unknown`에서 시작해 runtime schema로 검증한다.
- class, type, interface, enum은 `PascalCase`를 사용한다.
- 변수와 함수는 `camelCase`, 상수는 `UPPER_SNAKE_CASE`를 사용한다.
- boolean은 가능한 한 `is`, `has`, `can`, `should` prefix를 사용한다.
- source filename은 NestJS 관례에 맞는 `kebab-case`와 역할 suffix를 사용한다. 예: `saju-profile.controller.ts`, `create-saju-profile.schema.ts`.
- 로컬 ESM import는 현재 repository의 `NodeNext` 규칙에 맞춰 emitted path인 `.js` 확장자를 사용한다.

## API Contract Rules

- 공개 API는 `/v1`처럼 명시적으로 versioning한다.
- endpoint는 화면 이름이 아니라 resource와 use case를 기준으로 설계한다.
- request와 response body는 JSON 직렬화 가능한 값만 포함한다.
- ID는 opaque string으로 취급하고 client가 구조를 해석하지 않게 한다.
- 일시는 ISO 8601 UTC 문자열로 반환한다.
- 금액은 부동소수점이 아닌 최소 화폐 단위의 정수로 표현하고 통화를 함께 둔다.
- 공개 enum 값은 특별한 이유가 없으면 `lower_snake_case`를 사용한다.
- 목록 API는 초기 단계부터 pagination 확장 가능성을 고려하되 필요 없는 pagination을 억지로 추가하지 않는다.

성공 응답의 기본 envelope는 다음 형태를 사용한다.

```ts
type ApiResponse<TData> = {
  code: number;
  message: string;
  data: TData;
};
```

오류 응답의 기본 envelope는 다음 형태를 사용한다.

```ts
type ApiErrorResponse = {
  code: number;
  message: string;
  data: {
    reason: string;
    fieldErrors?: Record<string, readonly string[]>;
  } | null;
};
```

응답 body의 `code`는 실제 HTTP status와 항상 같아야 한다. Domain error code는 오류 응답의 `data.reason`에 둔다. 요청 추적 ID는 body가 아니라 `x-request-id` header로 제공한다. 내부 exception, SQL 오류, stack trace, Provider 원문을 client에 노출하지 않는다.

## Runtime Validation and OpenAPI

- API boundary의 request, response, environment variable은 Zod schema로 검증한다.
- 같은 구조의 TypeScript type을 손으로 다시 작성하지 않고 가능한 한 schema에서 추론한다.
- Zod의 세부 타입이나 Prisma model을 공개 계약으로 직접 노출하지 않는다.
- Swagger/OpenAPI 문서와 실제 runtime validation이 어긋나지 않도록 함께 변경한다.
- validation은 controller 진입 시점에 끝내고, service 내부에서는 검증된 값만 받는다.

## API Ownership and Consumer Compatibility

- Backend의 runtime schema, OpenAPI 문서, contract test를 공개 API의 source of truth로 둔다.
- 현재 특정 화면에 필요한 모양을 그대로 endpoint나 DTO로 옮기지 않고 resource와 use case 중심으로 계약을 설계한다.
- Prisma model, database column, 만세력 library 타입, Provider 원본 응답을 외부 계약으로 노출하지 않는다.
- 공개 계약 변경 시 하위 호환성을 우선하고, 의도적인 breaking change는 versioning과 migration 계획을 함께 제시한다.
- API 계약과 OpenAPI 문서는 같은 변경에서 갱신하고, 영향을 받는 consumer가 있다면 호환성 영향만 확인해 완료 보고에 남긴다.
- server source file을 다른 repository에서 직접 import하게 만들지 않는다. 여러 consumer에서 실제 필요성이 확인되기 전까지 별도 shared package를 만들지 않는다.

Sibling Frontend의 directory 구조, 상태 관리 방식, view model 규칙은 이 repository의 작업 규칙으로 가져오지 않는다. 계약 호환성을 확인할 때도 필요한 호출 경계만 읽고 Backend 내부 설계는 서버의 도메인과 운영 요구사항을 기준으로 결정한다.

## Prisma and Supabase Rules

- Supabase는 PostgreSQL hosting으로 사용하고, application의 DB 접근은 Backend의 Prisma를 통해 수행한다.
- Browser에서 Prisma, database password, Supabase service role key를 사용하지 않는다.
- Runtime connection과 migration용 direct connection을 구분한다.
- 환경별 database URL은 환경변수에서만 읽고 repository에 실제 값을 commit하지 않는다.
- schema 변경은 Prisma migration으로 기록한다.
- production schema에 `prisma db push`를 사용하지 않는다.
- 여러 쓰기가 하나의 비즈니스 결과를 이룰 때 transaction 경계를 명시한다.
- API 응답에 Prisma model을 그대로 반환하지 않고 명시적인 mapper를 둔다.
- 조회 시 필요한 column과 relation만 선택하고 N+1 query를 피한다.

## Saju Calculation Rules

- 생년월일 변환, 원국, 십성, 공망, 오행 구성, 대운 계산은 Backend 책임이다.
- `manseryeok` version은 계산 재현성을 위해 exact version으로 고정한다.
- 계산 library의 반환 객체를 API나 DB JSON에 그대로 저장하지 않는다.
- 사용자 입력을 검증·정규화한 뒤 versioned `SajuChartSnapshot`으로 변환한다.
- 기본 timezone 정책은 `Asia/Seoul`이며 정책 변경은 `policyVersion`으로 구분한다.
- 생년월일시처럼 계산 입력이 바뀌면 기존 차트를 수정하지 않고 새 Snapshot을 만든다.
- 표시 이름만 바뀌면 차트를 재계산하지 않는다.
- AI 풀이에는 전체 Snapshot을 client로부터 다시 받지 않고 server가 소유권을 확인한 `chartId`를 사용한다.
- 시간 미상, 절기 경계 등 계산 불확실성은 숨기지 않고 quality와 warning으로 표현한다.

## Auth, Payment, AI, and Upload Boundaries

- 인증 Provider는 adapter 경계 뒤에 두고 controller가 Provider SDK에 직접 의존하지 않게 한다.
- 모든 사용자 리소스 조회와 변경에서 소유권을 확인한다.
- 결제 금액과 상품 상태는 server catalog를 기준으로 계산한다.
- 결제 생성과 webhook 처리는 idempotency를 보장하고 Provider signature를 검증한다.
- AI Provider별 prompt와 response mapping은 infrastructure 내부에 두고 API에는 service domain 결과만 반환한다.
- Presigned URL은 인증, 파일 크기, MIME type, object key 정책을 검증한 뒤 짧은 만료 시간으로 발급한다.

Provider가 아직 정해지지 않은 기능은 interface와 mock implementation을 대량으로 미리 만들지 않는다.

## Configuration and Security

- application 시작 시 필수 환경변수를 검증하고 잘못된 설정이면 즉시 실패한다.
- `.env` 파일과 모든 secret은 commit하지 않는다.
- CORS는 환경별로 명시한 client origin allowlist로 제한한다.
- `helmet` 등 기본 HTTP 보안을 bootstrap에서 일관되게 적용한다.
- request body와 upload size에는 명시적인 제한을 둔다.
- 인증 endpoint, 계산 endpoint, 결제 endpoint에는 호환되는 throttling 수단을 적용한다.
- password, token, 생년월일시, 결제 원문, Provider secret을 log에 남기지 않는다.
- 사용자에게 보여줄 message와 운영 진단용 structured log를 분리한다.

## Testing Rules

- domain rule과 mapper는 빠른 unit test로 검증한다.
- controller, validation, authentication boundary, error envelope는 e2e test로 검증한다.
- Prisma query가 중요한 use case는 실제 PostgreSQL과 가까운 integration test를 우선한다.
- 만세력 계산은 대표 입력, 시간 미상, 음력/윤달, 절기 경계 사례를 fixture와 snapshot contract로 고정한다.
- 외부 Provider test는 network에 의존하지 않도록 adapter 경계에서 대체한다.
- 버그 수정에는 가능한 한 재현 test를 먼저 추가한다.

Test가 production code의 타입 오류나 실제 계약 불일치를 숨기도록 작성하지 않는다.

## Change Scope

- 사용자 요구사항과 현재 vertical slice에 필요한 코드만 추가한다.
- 사용되지 않는 generic repository, base service, helper, decorator를 미리 만들지 않는다.
- 기존 변경사항은 사용자 소유이므로 관련 없는 파일을 되돌리거나 덮어쓰지 않는다.
- 공개 API 계약을 바꾸면 consumer 호환성 영향과 migration 필요성을 명시한다.
- destructive migration, production data 변경, secret rotation은 명시적인 승인 없이 실행하지 않는다.

## Quality Gates

작업 완료 후 변경 범위에 맞게 다음을 실행한다.

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

Prisma schema를 변경한 경우 migration 상태와 generated client도 확인한다. 오류를 숨기기 위해 lint 또는 type check를 비활성화하지 않는다.

완료 보고에는 다음을 간략히 포함한다.

- 변경 파일
- 구현 내용
- 주요 설계 판단과 API 영향
- lint, test, build 결과
- 남은 migration, security 또는 consumer compatibility follow-up
