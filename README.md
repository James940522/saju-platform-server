# Saju Platform Server

한국 사주/운세 기반 서비스의 NestJS Backend API다. Frontend는 별도 `saju-platform` repository에서 관리한다.

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

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | 실행 환경 |
| `PORT` | `8080` | HTTP server port |
| `CORS_ORIGINS` | `http://localhost:3000` | 쉼표로 구분한 허용 frontend origin |
| `DATABASE_URL` | - | 애플리케이션 runtime용 Supabase PostgreSQL pooled URL |
| `DIRECT_URL` | - | Prisma migration용 Supabase PostgreSQL direct URL |
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | - | access token 검증 요청에 사용할 publishable key |

`DIRECT_URL`은 migration에만 사용하고, 실행 중인 API는 connection pooler가 적용된 `DATABASE_URL`을 사용한다. 실제 credential과 key는 `.env`에만 두고 commit하지 않는다.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | 서비스 상태 확인 |
| `GET` | `/v1/reading-products` | 풀이 상품 목록 |
| `GET` | `/v1/reading-products/:productCode` | 풀이 상품 상세 |
| `PUT` | `/v1/users/me` | Supabase 인증 주체의 앱 User 생성 또는 조회 |
| `GET` | `/v1/users/me` | 현재 앱 User 조회 |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | OpenAPI 3.1 JSON |

일반 API 응답은 HTTP status와 동일한 `code`, 사용자용 `message`, 결과 또는 오류 상세를 담는 `data` envelope를 사용한다. 요청 추적 ID는 `x-request-id` header로 제공하며 CORS에서도 노출한다.

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
