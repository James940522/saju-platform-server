# 선녀 사주 Backend API

`선녀 사주` 서비스의 NestJS Backend API다. Frontend는 별도 `saju-platform` repository에서 관리한다.

## Stack

- Node.js 24
- NestJS 12
- TypeScript with ESM and NodeNext
- Zod and OpenAPI 3.1
- Prisma 7
- Supabase PostgreSQL
- Vitest and Oxlint
- npm

## Setup

```bash
npm install
cp .env.example .env
npm run start:dev
```

기본 로컬 주소는 `http://localhost:8080`이다.

재물 분석은 저장소에 고정한 [fortuneteller 로컬 npm 패키지](./vendor/fortuneteller/UPSTREAM.md)를 사용한다. `npm run build`가 vendor도 컴파일하며 운영 이미지에는 `vendor/fortuneteller`와 그 `dist`를 함께 포함해야 한다. [전체·부분 분석 흐름](./docs/fortuneteller-analysis.md)을 참고한다.

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | 실행 환경 |
| `LOG_LEVEL` | 개발 `debug`, 운영 `info` | `debug`, `info`, `warn`, `error`. 운영은 JSON 로그, 개발은 단계별 로그 |
| `PORT` | `8080` | HTTP server port |
| `CORS_ORIGINS` | `http://localhost:3000` | 쉼표로 구분한 허용 frontend origin |
| `DATABASE_URL` | - | 애플리케이션 runtime용 Supabase PostgreSQL pooled URL |
| `DIRECT_URL` | - | Prisma migration용 Supabase PostgreSQL direct URL |
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | - | access token 검증 요청에 사용할 publishable key |
| `ACCOUNT_WITHDRAWAL_ENABLED` | `false` | 회원 탈퇴 API와 재시도 worker 활성화 |
| `SUPABASE_SERVICE_ROLE_KEY` | - | 탈퇴 활성화 시 필수. 서버 전용 Auth 관리 키 |
| `KAKAO_ADMIN_KEY` | - | 탈퇴 활성화 시 필수. 로그인에 사용하는 카카오 앱의 어드민 키 |
| `KIE_API_KEY` | - | 서버 루트 `.env`에서 직접 입력하는 AI Provider 인증키. 재물운 랭킹 활성화 시 필수 |
| `WEALTH_RANKING_ENABLED` | `false` | 재물운 랭킹 활성화 |
| `WEALTH_RANKING_TIMEOUT_MS` | `300000` | AI 요청 제한 시간(ms). 기본/최대 300초. 작업 전체 예산은 300초 |

`DIRECT_URL`은 migration에만 사용하고, 실행 중인 API는 connection pooler가 적용된 `DATABASE_URL`을 사용한다. 실제 credential과 key는 `.env`에만 두고 commit하지 않는다.

요청 ID로 HTTP 요청, 공공 API 대조, AI 생성·검증 단계를 연결한다. 요청·응답 원문과 개인정보는 기록하지 않는다. 로그 설정과 재물운 502 수정 내용은 [연결 및 진단 문서](./docs/wealth-ranking-kasi.md#요청과-처리-단계-로그)를 참고한다.

프롬프트는 `src/config/reading-prompts.config.ts`의 상품 키로 관리한다. 재물운은 `readingPrompts['wealth-ranking']`이며, [편집 위치·5분 시간 예산·실제 호출 결과](./docs/wealth-ranking-prompt-v8.md)를 참고한다.

API 인증키는 서버 루트 `.env`에서 직접 관리한다. `KIE_API_KEY`를 입력하고
`WEALTH_RANKING_ENABLED=true`로 변경한 뒤 서버를 재시작하면 적용된다.
기능이 비활성화된 동안 키는 비워 둘 수 있다. `.env.example`에는 실제 키를 넣지 않는다.

모델은 [src/config/ai-model.config.ts](./src/config/ai-model.config.ts)의
`wealthRanking` 설정에서 직접 변경한다. 기본값은 **Gemini 3.8 Flash**이며
`model`은 Kie chat completions 경로 식별자, `responseFormat`은 JSON 요청 방식,
`reasoningEffort`는 추론 강도(null이면 Provider 기본값)다. 변경 후 개발 서버를 재시작하거나,
운영 서버는 `npm run build` 후 재시작한다. API 키는 계속 `.env`에서 관리한다.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | 서비스 상태 확인 |
| `GET` | `/v1/reading-products` | 풀이 상품 목록 |
| `GET` | `/v1/reading-products/:productCode` | 풀이 상품 상세 |
| `PUT` | `/v1/users/me/registration` | 본인 인증과 동의를 확인하고 가입 완료 |
| `GET` | `/v1/users/me` | 현재 앱 User 조회 |
| `DELETE` | `/v1/users/me` | 본인 계정 탈퇴와 관련 데이터 삭제, 카카오 연결 해제 |
| `POST` | `/v1/saju-profiles` | 사주 프로필과 최초 만세력 생성 |
| `GET` | `/v1/saju-profiles` | 내 사주 프로필 목록 조회 |
| `GET` | `/v1/saju-profiles/:profileId` | 내 사주 프로필과 현재 만세력 조회 |
| `PATCH` | `/v1/saju-profiles/:profileId` | 내 사주 프로필 수정 |
| `DELETE` | `/v1/saju-profiles/:profileId` | 프로필과 종속 만세력 데이터 영구 삭제 |
| `POST` | `/v1/readings/wealth-ranking` | 소유한 차트 2~5명의 무료 재물운 랭킹 생성 |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI 3.1 JSON |

일반 API 응답은 HTTP status와 동일한 `code`, 사용자용 `message`, 결과 또는 오류 상세를 담는 `data` envelope를 사용한다. 요청 추적 ID는 `x-request-id` header로 제공하며 CORS에서도 노출한다.

회원 탈퇴의 삭제 범위, migration 적용 순서와 활성화·장애 복구 절차는 [회원 탈퇴 구현 문서](./docs/account-withdrawal.md)를 참고한다.

재물운 랭킹의 전용 프롬프트, 세 가지 출력, API 사용 예와 Kie 활성화 설정은
[재물운 랭킹 구현 문서](./docs/wealth-ranking.md)를 참고한다. 기능은 기본 비활성화이며
`WEALTH_RANKING_ENABLED=true`와 서버 전용 `KIE_API_KEY`가 필요하다.

성공 응답 예시:

```json
{
  "code": 200,
  "message": "풀이 상품 목록을 조회했습니다.",
  "data": {
    "products": []
  }
}
```

오류 응답 예시:

```json
{
  "code": 404,
  "message": "요청한 풀이 상품을 찾을 수 없습니다.",
  "data": {
    "reason": "READING_PRODUCT_NOT_FOUND"
  }
}
```

Controller는 `data`에 들어갈 값만 반환한다. 전역 interceptor가 `ResponseContract`에 선언된 메시지와 실제 HTTP status를 사용해 성공 응답을 만들고, 전역 exception filter가 모든 오류를 같은 형식으로 변환한다.

## Commands

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

구현 규칙과 repository 경계는 `AGENTS.md`를 따른다.

만세력·KASI 공식 달력·명리 보조 자료의 조합과 키 설정은 [사주 풀이 데이터 조합 문서](./docs/saju-reading-data-combination.md)를 참고한다. KASI는 기본 비활성화이며 승인된 키 등록 후 활성화한다.

재물운의 음양력·절기 대조, 서버 분석 근거, 환경변수와 실제 연결 확인은 [KASI 재물운 연결](./docs/wealth-ranking-kasi.md)을 참고하세요.

## 백그라운드 풀이

새 풀이 요청은 로그인 후 `POST /v1/reading-jobs`로 접수합니다. 기존/신규 결과는 같은 UUID로 `GET /v1/reading-results/{jobId}`에서 로그인 없이 조회하며 이름·순위·운세·비교 설명만 공개합니다. 내 풀이 목록과 소유자 상세 API는 인증을 유지합니다. 실행·마이그레이션·복구 정책은 [reading-jobs.md](docs/reading-jobs.md)를 참고하세요.
