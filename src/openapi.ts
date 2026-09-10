import type { INestApplication } from '@nestjs/common';
import { type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import { createDocument } from 'zod-openapi';
import { createApiErrorResponseSchema } from './common/contracts/api-response.schema.js';
import { HealthResponseSchema } from './modules/health/health.contract.js';
import {
  GetReadingProductResponseSchema,
  GetReadingProductsResponseSchema,
  ReadingProductCodeSchema,
} from './modules/reading-products/reading-product.contract.js';
import {
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

const SERVICE_NAME = '선녀 사주';

const BadRequestResponseSchema = createApiErrorResponseSchema(
  'BadRequestResponse',
  400,
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
    { name: 'Users', description: '인증된 사용자' },
    { name: 'Saju Profiles', description: '사용자 소유 사주 프로필과 만세력' },
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
      get: {
        operationId: 'getCurrentUser',
        summary: '현재 사용자 조회',
        tags: ['Users'],
        security: [{ supabaseBearer: [] }],
        responses: {
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
        tags: ['Saju Profiles'],
        security: [{ supabaseBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: CreateSajuProfileRequestSchema },
          },
        },
        responses: {
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
          '표시 정보만 바뀌면 현재 만세력을 유지하고, 계산 입력이 바뀌면 불변 만세력 스냅샷을 생성하거나 동일 계산본을 재사용합니다.',
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
