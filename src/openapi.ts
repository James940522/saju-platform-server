import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { createApiErrorResponseSchema } from './common/contracts/api-response.schema.js';
import { HealthResponseSchema } from './modules/health/health.contract.js';
import { CreateWealthRankingRequestSchema, WealthRankingResponseSchema } from './modules/readings/wealth-ranking.contract.js';
import {
  PreviewSajuChartRequestSchema,
  PreviewSajuChartResponseSchema,
} from './modules/saju-profiles/saju-chart-preview.contract.js';
import {
  GetReadingProductResponseSchema,
  GetReadingProductsResponseSchema,
  ReadingProductCodeSchema,
} from './modules/reading-products/reading-product.contract.js';
import {
  SajuProfileCreationKeySchema,
  CreateSajuProfileRequestSchema,
  CreateSajuProfileResponseSchema,
  DeleteSajuProfileResponseSchema,
  GetSajuProfileResponseSchema,
  GetSajuProfilesResponseSchema,
  UpdateSajuProfileRequestSchema,
  UpdateSajuProfileResponseSchema,
} from './modules/saju-profiles/saju-profile.contract.js';
import {
  CompleteRegistrationRequestSchema,
  CurrentUserResponseSchema,
} from './modules/users/user.contract.js';
import { AccountWithdrawalRequestSchema, AccountWithdrawalCompletedResponseSchema, AccountWithdrawalProcessingResponseSchema } from './modules/users/account-withdrawal.contract.js';

const SERVICE_NAME = '선녀 사주';

const BadRequestResponseSchema = createApiErrorResponseSchema(
  'BadRequestResponse',
  400,
);
const ConflictResponseSchema = createApiErrorResponseSchema(
  'ConflictResponse',
  409,
);
const NotFoundResponseSchema = createApiErrorResponseSchema(
  'NotFoundResponse',
  404,
);
const UnauthorizedResponseSchema = createApiErrorResponseSchema(
  'UnauthorizedResponse',
  401,
);
const ForbiddenResponseSchema = createApiErrorResponseSchema(
  'ForbiddenResponse',
  403,
);
const ServiceUnavailableResponseSchema = createApiErrorResponseSchema(
  'ServiceUnavailableResponse',
  503,
);
const TooManyRequestsResponseSchema = createApiErrorResponseSchema(
  'TooManyRequestsResponse',
  429,
);

const generatedOpenApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: `${SERVICE_NAME} API`,
    version: '1.0.0',
    description: `${SERVICE_NAME} Backend API 계약`,
  },
  tags: [
    { name: 'System', description: '서비스 상태 확인' },
    { name: 'Reading Products', description: '풀이 상품 카탈로그' },
    { name: 'Readings', description: '상품별 사주 풀이 생성' },
    { name: 'Users', description: '인증된 사용자' },
    { name: 'Saju Profiles', description: '사용자 소유 사주 프로필과 만세력' },
    { name: 'Saju Charts', description: '만세력 입력과 계산 결과' },
  ],
  components: {
    securitySchemes: {
      supabaseBearer: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/v1/readings/wealth-ranking': {
      post: {
        operationId: 'createWealthRanking',
        summary: '무료 재물운 랭킹 생성',
        description: '활성 사용자 소유의 서로 다른 프로필 차트 2~5개를 비교합니다. 이름·생년월일시는 기존 POST /v1/saju-profiles로 등록하고 반환된 chart.id를 사용합니다. ranking의 순서와 rank는 1~n, fortune은 개인별 한 문장(140자), rationale은 한 단락(600자)이며 참여자를 순위로 지칭합니다. 원국 기준의 오락용 상대 해석이며 특정 연도 예측이 아닙니다. AI에 실명·생년월일 원문은 보내지 않습니다. 동기 생성이며 결과를 저장하지 않습니다. 자동 재시도·멱등 재조회는 지원하지 않습니다. 프로세스별 사용자당 분당 3회, 동시 1회, 전체 동시 4회 제한입니다. 지장간·십성과 완전 삼합 구성을 보조 근거로 사용합니다. 선택적 KASI 음양력 대조는 KASI_CALENDAR_VERIFICATION_ENABLED와 KASI_SERVICE_KEY로 활성화하며, 불일치 시 AI 호출 전에 409 SAJU_CALENDAR_MISMATCH로 중단합니다. 공식 대조의 성공·비활성·조회 실패 여부는 notice에 표시합니다. 활성화에는 서버의 WEALTH_RANKING_ENABLED와 KIE_API_KEY 설정이 필요합니다.',
        tags: ['Readings'],
        security: [{ supabaseBearer: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: CreateWealthRankingRequestSchema } } },
        responses: {
          200: { description: '전체 순위, 개인별 한 문장 풀이, 한 단락 비교 근거와 계산 한계', content: { 'application/json': { schema: WealthRankingResponseSchema } } },
          400: { description: 'VALIDATION_ERROR: 인원 범위, 중복 chartId, 잘못된 UUID 또는 추가 입력', content: { 'application/json': { schema: BadRequestResponseSchema } } },
          401: { description: 'AUTHENTICATION_REQUIRED', content: { 'application/json': { schema: UnauthorizedResponseSchema } } },
          403: { description: 'USER_REGISTRATION_REQUIRED 또는 USER_ACCESS_DENIED', content: { 'application/json': { schema: ForbiddenResponseSchema } } },
          404: { description: 'SAJU_CHART_NOT_FOUND: 미존재·타인 소유·삭제된 차트를 구분하지 않음', content: { 'application/json': { schema: NotFoundResponseSchema } } },
          409: { description: 'DUPLICATE_READING_PARTICIPANT, READING_IN_PROGRESS 또는 SAJU_CALENDAR_MISMATCH', content: { 'application/json': { schema: ConflictResponseSchema } } },
          429: {
            description: 'RATE_LIMITED',
            headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } },
            content: { 'application/json': { schema: TooManyRequestsResponseSchema } },
          },
          502: { description: 'AI 통신 또는 출력 검증 실패. Provider 상세는 비노출(data=null).', content: { 'application/json': { schema: createApiErrorResponseSchema('ReadingBadGatewayResponse', 502) } } },
          503: { description: '기능 미설정 또는 전체 동시 요청 한도 초과(data=null).', content: { 'application/json': { schema: ServiceUnavailableResponseSchema } } },
          504: { description: 'AI 응답 시간 초과(data=null). 자동 재시도하지 않습니다.', content: { 'application/json': { schema: createApiErrorResponseSchema('ReadingTimeoutResponse', 504) } } },
        },
      },
    },
    '/v1/saju-charts/preview': {
      post: {
        operationId: 'previewSajuChart',
        summary: '출생 정보로 만세력 미리보기 계산',
        description:
          '출생 입력을 검증하고 저장 API와 동일한 계산기로 SajuChartSnapshotV1을 반환합니다. 한국시 보정(동경 127.5도, 균시차 제외, 과거 한국 표준시·서머타임 반영)과 보정 시각의 자정 일 경계를 적용합니다. normalizedBirth.time은 입력 시각이며 timeCorrection은 보정된 양력 날짜·시각과 보정 분입니다. 시간 미상은 입력 날짜 기준 일주를 포함한 부분 명식이며 시주·대운은 없고 일 경계 불확실성을 안내합니다. 시간 미상의 절입일 및 역사적 중복·존재하지 않는 시각은 400입니다. 이름과 관계는 받지 않으며 DB 저장·외부 API 호출을 하지 않습니다. 인증이 필요 없는 무상태 API이며 프로세스별 IP당 60초에 60회로 제한합니다.',
        tags: ['Saju Charts'],
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: PreviewSajuChartRequestSchema },
          },
        },
        responses: {
          200: {
            description:
              'status=calculated, snapshot=SajuChartSnapshotV1. 저장된 chartId는 생성하지 않습니다.',
            content: {
              'application/json': { schema: PreviewSajuChartResponseSchema },
            },
          },
          400: {
            description:
              '입력 검증 또는 계산 실패. reason: VALIDATION_ERROR, INVALID_SOLAR_DATE, INVALID_LUNAR_DATE, INVALID_LEAP_MONTH, UNSUPPORTED_BIRTH_YEAR, FUTURE_BIRTH_DATE, BIRTH_TIME_REQUIRED_ON_BOUNDARY_DATE, NONEXISTENT_BIRTH_TIME, AMBIGUOUS_BIRTH_TIME, CALCULATION_FAILED.',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          429: {
            description:
              '요청 횟수 초과. Retry-After 헤더의 초 단위 대기 시간 후 재시도합니다.',
            headers: {
              'Retry-After': { schema: { type: 'integer', minimum: 1 } },
            },
            content: {
              'application/json': { schema: TooManyRequestsResponseSchema },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'getHealth',
        summary: '서비스 상태 조회',
        tags: ['System'],
        responses: {
          200: {
            description: '서비스가 요청을 받을 수 있음',
            content: {
              'application/json': { schema: HealthResponseSchema },
            },
          },
        },
      },
    },
    '/v1/reading-products': {
      get: {
        operationId: 'getReadingProducts',
        summary: '풀이 상품 목록 조회',
        tags: ['Reading Products'],
        responses: {
          200: {
            description: '풀이 상품 목록',
            content: {
              'application/json': {
                schema: GetReadingProductsResponseSchema,
              },
            },
          },
        },
      },
    },
    '/v1/reading-products/{productCode}': {
      get: {
        operationId: 'getReadingProduct',
        summary: '풀이 상품 상세 조회',
        tags: ['Reading Products'],
        requestParams: {
          path: z.strictObject({
            productCode: ReadingProductCodeSchema,
          }),
        },
        responses: {
          200: {
            description: '풀이 상품 상세',
            content: {
              'application/json': {
                schema: GetReadingProductResponseSchema,
              },
            },
          },
          400: {
            description: '잘못된 상품 코드',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          404: {
            description: '상품을 찾을 수 없음',
            content: {
              'application/json': { schema: NotFoundResponseSchema },
            },
          },
        },
      },
    },
    '/v1/users/me': {
      delete: {
        operationId: 'withdrawCurrentUser',
        tags: ['Users'],
        summary: '본인 계정과 모든 사주 데이터 영구 삭제',
        description: '확인 후 앱 데이터를 삭제하고 카카오 연결과 인증 계정을 정리합니다. 202는 정리 중이며 서버가 재시도합니다. 모든 응답은 Cache-Control: no-store입니다.',
        security: [{ supabaseBearer: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: AccountWithdrawalRequestSchema } } },
        responses: {
          '200': { description: '탈퇴 완료', content: { 'application/json': { schema: AccountWithdrawalCompletedResponseSchema } } },
          '202': { description: '데이터 삭제 및 작업 접수, 외부 정리 중', content: { 'application/json': { schema: AccountWithdrawalProcessingResponseSchema } } },
          '400': { description: '삭제 확인값 오류', content: { 'application/json': { schema: BadRequestResponseSchema } } },
          '401': { description: '인증 필요', content: { 'application/json': { schema: UnauthorizedResponseSchema } } },
          '429': { description: '요청 제한', headers: { 'Retry-After': { schema: { type: 'integer' }, description: '재시도까지 남은 초' } }, content: { 'application/json': { schema: TooManyRequestsResponseSchema } } },
          '503': { description: '접수 전 탈퇴 처리 불가 (ACCOUNT_WITHDRAWAL_UNAVAILABLE). 인증 Provider 등 그 외 서버 오류는 상세를 노출하지 않습니다.', content: { 'application/json': { schema: ServiceUnavailableResponseSchema } } },
        },
      },
      get: {
        operationId: 'getCurrentUser',
        summary: '현재 사용자 조회',
        tags: ['Users'],
        security: [{ supabaseBearer: [] }],
        responses: {
          403: { description: '회원 탈퇴 처리 중 (ACCOUNT_WITHDRAWAL_IN_PROGRESS)', content: { 'application/json': { schema: ForbiddenResponseSchema } } },
          200: {
            description: '현재 사용자',
            content: {
              'application/json': { schema: CurrentUserResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          404: {
            description: '앱 사용자 정보가 아직 없음',
            content: {
              'application/json': { schema: NotFoundResponseSchema },
            },
          },
          503: {
            description: '인증 공급자 연결 실패',
            content: {
              'application/json': { schema: ServiceUnavailableResponseSchema },
            },
          },
        },
      },
    },
    '/v1/users/me/registration': {
      put: {
        operationId: 'completeCurrentUserRegistration',
        summary: '현재 사용자 가입 확인 완료',
        tags: ['Users'],
        security: [{ supabaseBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CompleteRegistrationRequestSchema },
          },
        },
        responses: {
          200: {
            description: '가입 확인을 완료한 현재 사용자',
            content: {
              'application/json': { schema: CurrentUserResponseSchema },
            },
          },
          400: {
            description: '필수 동의 또는 연령 확인 누락',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: '현재 사용자 상태에서 가입할 수 없음',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
        },
      },
    },
    '/v1/saju-profiles': {
      post: {
        operationId: 'createSajuProfile',
        summary: '사주 프로필과 최초 만세력 생성',
        description:
          '프로필·계산본·대표 지정·요청 기록을 원자적으로 저장합니다. 선택적 Idempotency-Key(UUID)는 사용자별로 구분합니다. 동일 키·입력은 기존 프로필과 현재 차트를 201로 반환하며 재계산하지 않습니다. 다른 입력의 키 재사용은 IDEMPOTENCY_KEY_REUSED, 삭제된 등록 재시도는 SAJU_PROFILE_CREATION_DELETED, 차트 유실은 SAJU_PROFILE_CHART_UNAVAILABLE(모두 409)입니다. 키 기록은 사용자 삭제까지 유지합니다. 키 생략 시 각 POST는 별도 등록입니다. preview와 POST/PATCH는 프로세스별 IP당 60초 60회를 공유합니다.',
        requestParams: {
          header: z.object({ 'Idempotency-Key': SajuProfileCreationKeySchema }),
        },
        tags: ['Saju Profiles'],
        security: [{ supabaseBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateSajuProfileRequestSchema },
          },
        },
        responses: {
          409: {
            description:
              '등록 요청 키 충돌 또는 이전 등록 리소스 삭제/차트 유실',
            content: { 'application/json': { schema: ConflictResponseSchema } },
          },
          429: {
            description: '계산 요청 제한 초과',
            content: {
              'application/json': { schema: TooManyRequestsResponseSchema },
            },
          },
          201: {
            description: '생성한 사주 프로필과 현재 만세력',
            content: {
              'application/json': { schema: CreateSajuProfileResponseSchema },
            },
          },
          400: {
            description: '입력 검증 또는 만세력 계산 실패',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: '가입 미완료 또는 이용할 수 없는 사용자 상태',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
        },
      },
      get: {
        operationId: 'getSajuProfiles',
        summary: '내 사주 프로필 목록 조회',
        tags: ['Saju Profiles'],
        security: [{ supabaseBearer: [] }],
        responses: {
          200: {
            description: '현재 사용자가 소유한 사주 프로필 목록',
            content: {
              'application/json': { schema: GetSajuProfilesResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: '가입 미완료 또는 이용할 수 없는 사용자 상태',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
        },
      },
    },
    '/v1/saju-profiles/{profileId}': {
      get: {
        operationId: 'getSajuProfile',
        summary: '내 사주 프로필과 현재 만세력 조회',
        tags: ['Saju Profiles'],
        security: [{ supabaseBearer: [] }],
        requestParams: {
          path: z.strictObject({ profileId: z.uuid() }),
        },
        responses: {
          200: {
            description: '사주 프로필과 현재 만세력',
            content: {
              'application/json': { schema: GetSajuProfileResponseSchema },
            },
          },
          400: {
            description: '잘못된 프로필 ID',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: '가입 미완료 또는 이용할 수 없는 사용자 상태',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description: '소유한 프로필을 찾을 수 없음',
            content: {
              'application/json': { schema: NotFoundResponseSchema },
            },
          },
        },
      },
      patch: {
        operationId: 'updateSajuProfile',
        summary: '내 사주 프로필 수정',
        description:
          'birth를 제출하면 출생 정보 또는 계산 정책·시간대 데이터 버전이 바뀐 경우 새 불변 차트를 생성하거나 재사용합니다. birth 없이 이름·관계만 수정하면 기존 차트를 유지합니다. GET은 저장된 차트를 재계산하지 않습니다.',
        tags: ['Saju Profiles'],
        security: [{ supabaseBearer: [] }],
        requestParams: {
          path: z.strictObject({ profileId: z.uuid() }),
        },
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: UpdateSajuProfileRequestSchema },
          },
        },
        responses: {
          429: {
            description: '계산 요청 제한 초과',
            content: {
              'application/json': { schema: TooManyRequestsResponseSchema },
            },
          },
          200: {
            description: '수정한 사주 프로필과 현재 만세력',
            content: {
              'application/json': { schema: UpdateSajuProfileResponseSchema },
            },
          },
          400: {
            description: '잘못된 프로필 ID, 입력 검증 또는 만세력 계산 실패',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: '가입 미완료 또는 이용할 수 없는 사용자 상태',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description: '소유한 프로필을 찾을 수 없음',
            content: {
              'application/json': { schema: NotFoundResponseSchema },
            },
          },
        },
      },
      delete: {
        operationId: 'deleteSajuProfile',
        summary: '내 사주 프로필과 종속 데이터 영구 삭제',
        description:
          '프로필을 영구 삭제하고 해당 프로필의 모든 만세력 스냅샷을 함께 삭제합니다. 향후 저장 풀이 결과는 동일한 삭제 트랜잭션에서 명시적으로 삭제하며 결제·정산 기록은 보존합니다.',
        tags: ['Saju Profiles'],
        security: [{ supabaseBearer: [] }],
        requestParams: {
          path: z.strictObject({ profileId: z.uuid() }),
        },
        responses: {
          200: {
            description: '삭제한 프로필 ID와 새 대표 프로필 ID',
            content: {
              'application/json': { schema: DeleteSajuProfileResponseSchema },
            },
          },
          400: {
            description: '잘못된 프로필 ID',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: '유효한 인증 토큰이 없음',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: '가입 미완료 또는 이용할 수 없는 사용자 상태',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description: '소유한 프로필을 찾을 수 없음',
            content: {
              'application/json': { schema: NotFoundResponseSchema },
            },
          },
        },
      },
    },
  },
});

if (!generatedOpenApiDocument.paths) {
  throw new Error('The generated OpenAPI document must define paths.');
}

// zod-openapi and Nest Swagger ship structurally compatible OpenAPI types from
// different packages. Keep the assertion at this integration boundary only.
export const OPEN_API_DOCUMENT =
  generatedOpenApiDocument as unknown as OpenAPIObject;

export function setupOpenApi(app: INestApplication) {
  SwaggerModule.setup('docs', app, OPEN_API_DOCUMENT, {
    customSiteTitle: `${SERVICE_NAME} API Docs`,
    jsonDocumentUrl: '/openapi.json',
    yamlDocumentUrl: '/openapi.yaml',
  });
}
