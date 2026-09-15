import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { createApiErrorResponseSchema } from './common/contracts/api-response.schema.js';
import { HealthResponseSchema } from './modules/health/health.contract.js';
import {
  CreateWealthRankingRequestSchema,
  WealthRankingResponseSchema,
} from './modules/readings/wealth-ranking.contract.js';
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
import {
  AccountWithdrawalRequestSchema,
  AccountWithdrawalCompletedResponseSchema,
  AccountWithdrawalProcessingResponseSchema,
} from './modules/users/account-withdrawal.contract.js';

import {
  CreateReadingJobSchema,
  ReadingJobAcceptedSchema,
  ReadingJobResponseSchema,
  ReadingJobsResponseSchema,
  ReadingJobsQuerySchema,
  ReadingRequestKeySchema,
} from './modules/readings/reading-job.contract.js';
import { ReadingResultResponseSchema } from './modules/readings/reading-result.contract.js';

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
    '/v1/reading-results/{jobId}': {
      get: {
        operationId: 'getPublicReadingResult',
        summary: '로그인 없이 풀이 결과 조회',
        tags: ['Readings'],
        security: [],
        description:
          '기존 및 신규 풀이 UUID로 누구나 조회할 수 있습니다. 공유 토큰이나 별도 공개 설정은 필요하지 않습니다. 상태·진행 단계와 완료된 순위·이름·운세·비교 설명·comparisonTitle만 반환합니다. v7부터 AI가 1위와 마지막 순위 두 사람만 비교하는 제목(60자)과 본문을 작성합니다. rationale은 현재 이름+님으로 치환한 일반 텍스트이며 이름 길이를 고려해 최대 3600자입니다(AI 원문은 한 단락 600자 제한). 동명이인은 이름 옆 순위로 구분합니다. 과거 결과는 기존 본문과 기본 제목을 사용하고 재생성하지 않습니다. chartId, 생년월일시, 원국, quality, 개별 계산 warning, 소유자 정보, 내부 진단은 노출하지 않습니다. 대기/진행 상태는 result=null이며 3초 간격 재조회가 가능합니다. 없는 작업, 삭제된 참여자의 작업, 비활성 소유자의 작업은 404입니다. 작업 생성과 내 풀이 목록, 소유자 상세 API는 로그인이 필요합니다.',
        requestParams: { path: z.object({ jobId: z.uuid() }) },
        responses: {
          200: {
            description: '최소한의 공개 진행 상태와 최종 결과',
            content: {
              'application/json': { schema: ReadingResultResponseSchema },
            },
          },
          400: {
            description: 'VALIDATION_ERROR',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          404: {
            description: 'READING_JOB_NOT_FOUND',
            content: { 'application/json': { schema: NotFoundResponseSchema } },
          },
        },
      },
    },
    '/v1/reading-jobs': {
      post: {
        operationId: 'createReadingJob',
        summary: '백그라운드 풀이 접수',
        tags: ['Readings'],
        security: [{ supabaseBearer: [] }],
        description:
          'DB에 작업을 저장한 뒤 즉시 202를 반환합니다. 현재 wealth-ranking만 지원합니다. Idempotency-Key는 사용자별 UUID이며 같은 키·같은 입력은 기존 작업을 반환하고, 다른 입력은 409, 참여자 삭제로 지워진 작업은 410입니다. 사용자당 미완료 작업 1개, 신규 접수 분당 3개. 새로고침이나 브라우저 연결 종료는 작업을 취소하지 않습니다. 결과는 GET /v1/reading-jobs/{jobId}에서 조회합니다. 기존 동기 API의 대체 경로입니다.',
        requestParams: {
          header: z.object({ 'Idempotency-Key': ReadingRequestKeySchema }),
        },
        requestBody: {
          required: true,
          content: { 'application/json': { schema: CreateReadingJobSchema } },
        },
        responses: {
          202: {
            description: '접수 완료 또는 기존 작업 재조회',
            content: {
              'application/json': { schema: ReadingJobAcceptedSchema },
            },
          },
          400: {
            description: 'VALIDATION_ERROR',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: 'AUTHENTICATION_REQUIRED',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: 'USER_REGISTRATION_REQUIRED / USER_ACCESS_DENIED',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description: 'SAJU_CHART_NOT_FOUND',
            content: { 'application/json': { schema: NotFoundResponseSchema } },
          },
          409: {
            description:
              'IDEMPOTENCY_KEY_REUSED / READING_IN_PROGRESS / DUPLICATE_READING_PARTICIPANT',
            content: { 'application/json': { schema: ConflictResponseSchema } },
          },
          410: {
            description: 'READING_DELETED',
            content: {
              'application/json': {
                schema: createApiErrorResponseSchema(
                  'ReadingDeletedResponse',
                  410,
                ),
              },
            },
          },
          429: {
            description: 'RATE_LIMITED: 1분 뒤 재시도',
            content: {
              'application/json': { schema: TooManyRequestsResponseSchema },
            },
          },
          503: {
            description: 'READING_UNAVAILABLE',
            content: {
              'application/json': { schema: ServiceUnavailableResponseSchema },
            },
          },
        },
      },
      get: {
        operationId: 'listReadingJobs',
        summary: '내 풀이 목록',
        tags: ['Readings'],
        security: [{ supabaseBearer: [] }],
        description:
          '최신순 목록. 작업 상태, 참여자 이름과 chartId를 반환하며 결과 본문은 상세 조회에서 제공합니다. 프로필 삭제 시 해당 프로필이 참여한 풀이를 삭제합니다. 처리 중에는 약 3초 간격으로 재조회할 수 있습니다.',
        requestParams: { query: ReadingJobsQuerySchema },
        responses: {
          200: {
            description: '내 풀이 목록과 nextCursor',
            content: {
              'application/json': { schema: ReadingJobsResponseSchema },
            },
          },
          400: {
            description: 'VALIDATION_ERROR',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: 'AUTHENTICATION_REQUIRED',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: 'USER_ACCESS_DENIED / USER_REGISTRATION_REQUIRED',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description: 'READING_JOB_NOT_FOUND: 잘못된 cursor',
            content: { 'application/json': { schema: NotFoundResponseSchema } },
          },
        },
      },
    },
    '/v1/reading-jobs/{jobId}': {
      get: {
        operationId: 'getReadingJob',
        summary: '풀이 상태와 저장된 결과',
        tags: ['Readings'],
        security: [{ supabaseBearer: [] }],
        description:
          'queued/running/succeeded/failed 상태. succeeded일 때만 result, failed일 때만 안전한 error를 제공합니다. KASI → 설치된 fortuneteller의 개인별 전체/부분 분석 → AI 순서를 유지합니다. 시간 미상자는 시주가 필요한 분석을 제외하고 notice에 한계를 표시합니다. 서버 중단으로 AI 결과가 불명확한 작업은 READING_INTERRUPTED로 종료하며 자동으로 재과금하지 않습니다. 타인 소유와 없는 작업은 모두 404입니다.',
        requestParams: { path: z.object({ jobId: z.uuid() }) },
        responses: {
          200: {
            description: '작업 상태와 결과',
            content: {
              'application/json': { schema: ReadingJobResponseSchema },
            },
          },
          400: {
            description: 'VALIDATION_ERROR',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: 'AUTHENTICATION_REQUIRED',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: 'USER_ACCESS_DENIED / USER_REGISTRATION_REQUIRED',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description: 'READING_JOB_NOT_FOUND',
            content: { 'application/json': { schema: NotFoundResponseSchema } },
          },
        },
      },
    },
    '/v1/readings/wealth-ranking': {
      post: {
        operationId: 'createWealthRanking',
        deprecated: true,
        summary: '무료 재물운 랭킹 생성',
        description:
          '활성 사용자 소유의 서로 다른 프로필 차트 2~5개를 비교합니다. 이름·생년월일시는 기존 POST /v1/saju-profiles로 등록하고 반환된 chart.id를 사용합니다. ranking의 순서와 rank는 1~n, fortune은 개인별 한 문장(140자), rationale은 한 단락(600자)이며 참여자 참조를 순위로 정규화한 저장용 본문입니다. v7부터 1위·마지막 순위 두 사람만 비교하고 AI가 comparisonTitle(60자)을 함께 작성합니다. 공개 결과 조회 API에서는 본문의 순위 참조를 현재 이름으로 바꿉니다. 이전 결과에는 comparisonTitle이 없을 수 있습니다. 원국 기준의 오락용 상대 해석이며 특정 연도 예측이 아닙니다. AI에 실명·생년월일 원문은 보내지 않습니다. 동기 생성이며 결과를 저장하지 않습니다. 자동 재시도·멱등 재조회는 지원하지 않습니다. 프로세스별 사용자당 분당 3회, 동시 1회, 전체 동시 4회 제한입니다. 저장된 만세력 조회와 KASI 대조가 끝난 뒤 설치된 fortuneteller 원본 함수로 월령·가중 십성 분포·강약·격국·용신·신살·재물을 개인별 분석합니다. 기존 만세력을 재계산하지 않습니다. 완성된 분석을 Kie에 전달하여 상대 비교와 최종 문장 작성을 수행합니다. 시간 미상자는 3주로 가능한 재물 분석만 실행하고 강약·격국·용신·신살과 원본 점수는 제외합니다. 다른 참여자의 전체 분석은 유지합니다. 지장간·십성·관계와 원본 재물 분석을 근거로 활용하되 원본 점수로 순위를 정렬하지 않습니다. 시간 미상에 따른 해석·순위의 불확실성은 notice에 표시합니다. 선택적 KASI 음양력 대조는 KASI_CALENDAR_VERIFICATION_ENABLED와 KASI_SERVICE_KEY로 활성화하며, 불일치 시 AI 호출 전에 409 SAJU_CALENDAR_MISMATCH로 중단합니다. 특일정보의 KASI_SPECIAL_SERVICE_KEY와 KASI_SOLAR_TERMS_VERIFICATION_ENABLED로 연주·월주 절기 대조를 활성화합니다. 연주·월주 불일치는 409 SAJU_SOLAR_TERM_MISMATCH, 절입 경계의 분 단위 불확실성은 409 SAJU_SOLAR_TERM_BOUNDARY_UNCERTAIN으로 AI 전에 중단합니다. 자료 미제공·조회 실패·비활성·이전 계산 정책은 공식 대조 성공으로 간주하지 않으며 상태를 notice에 표시합니다. 활성화에는 서버의 WEALTH_RANKING_ENABLED와 KIE_API_KEY 설정이 필요합니다.',
        tags: ['Readings'],
        security: [{ supabaseBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateWealthRankingRequestSchema },
          },
        },
        responses: {
          200: {
            description:
              '전체 순위, 개인별 한 문장 풀이, 한 단락 비교 근거와 계산 한계',
            content: {
              'application/json': { schema: WealthRankingResponseSchema },
            },
          },
          400: {
            description:
              'VALIDATION_ERROR: 인원 범위, 중복 chartId, 잘못된 UUID 또는 추가 입력',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          401: {
            description: 'AUTHENTICATION_REQUIRED',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          403: {
            description: 'USER_REGISTRATION_REQUIRED 또는 USER_ACCESS_DENIED',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
          404: {
            description:
              'SAJU_CHART_NOT_FOUND: 미존재·타인 소유·삭제된 차트를 구분하지 않음',
            content: { 'application/json': { schema: NotFoundResponseSchema } },
          },
          409: {
            description:
              'DUPLICATE_READING_PARTICIPANT, READING_IN_PROGRESS, SAJU_CALENDAR_MISMATCH, SAJU_SOLAR_TERM_MISMATCH 또는 SAJU_SOLAR_TERM_BOUNDARY_UNCERTAIN',
            content: { 'application/json': { schema: ConflictResponseSchema } },
          },
          429: {
            description: 'RATE_LIMITED',
            headers: {
              'Retry-After': { schema: { type: 'integer', minimum: 1 } },
            },
            content: {
              'application/json': { schema: TooManyRequestsResponseSchema },
            },
          },
          502: {
            description:
              'AI 통신 또는 출력 검증 실패. Provider 상세는 비노출(data=null).',
            content: {
              'application/json': {
                schema: createApiErrorResponseSchema(
                  'ReadingBadGatewayResponse',
                  502,
                ),
              },
            },
          },
          503: {
            description:
              '기능 미설정 또는 전체 동시 요청 한도 초과(data=null).',
            content: {
              'application/json': { schema: ServiceUnavailableResponseSchema },
            },
          },
          504: {
            description:
              '풀이 시간 초과(data=null). AI 요청은 WEALTH_RANKING_TIMEOUT_MS(기본/최대 300초)와 남은 작업 시간 중 작은 값을 사용하며 저장 여유 5초를 남깁니다. 작업 전체는 최대 300초이며 자동 재시도하지 않습니다.',
            content: {
              'application/json': {
                schema: createApiErrorResponseSchema(
                  'ReadingTimeoutResponse',
                  504,
                ),
              },
            },
          },
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
        description:
          '확인 후 앱 데이터를 삭제하고 카카오 연결과 인증 계정을 정리합니다. 202는 정리 중이며 서버가 재시도합니다. 모든 응답은 Cache-Control: no-store입니다.',
        security: [{ supabaseBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: AccountWithdrawalRequestSchema },
          },
        },
        responses: {
          '200': {
            description: '탈퇴 완료',
            content: {
              'application/json': {
                schema: AccountWithdrawalCompletedResponseSchema,
              },
            },
          },
          '202': {
            description: '데이터 삭제 및 작업 접수, 외부 정리 중',
            content: {
              'application/json': {
                schema: AccountWithdrawalProcessingResponseSchema,
              },
            },
          },
          '400': {
            description: '삭제 확인값 오류',
            content: {
              'application/json': { schema: BadRequestResponseSchema },
            },
          },
          '401': {
            description: '인증 필요',
            content: {
              'application/json': { schema: UnauthorizedResponseSchema },
            },
          },
          '429': {
            description: '요청 제한',
            headers: {
              'Retry-After': {
                schema: { type: 'integer' },
                description: '재시도까지 남은 초',
              },
            },
            content: {
              'application/json': { schema: TooManyRequestsResponseSchema },
            },
          },
          '503': {
            description:
              '접수 전 탈퇴 처리 불가 (ACCOUNT_WITHDRAWAL_UNAVAILABLE). 인증 Provider 등 그 외 서버 오류는 상세를 노출하지 않습니다.',
            content: {
              'application/json': { schema: ServiceUnavailableResponseSchema },
            },
          },
        },
      },
      get: {
        operationId: 'getCurrentUser',
        summary: '현재 사용자 조회',
        tags: ['Users'],
        security: [{ supabaseBearer: [] }],
        responses: {
          403: {
            description: '회원 탈퇴 처리 중 (ACCOUNT_WITHDRAWAL_IN_PROGRESS)',
            content: {
              'application/json': { schema: ForbiddenResponseSchema },
            },
          },
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
