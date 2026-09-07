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

const BadRequestResponseSchema = createApiErrorResponseSchema(
  'BadRequestResponse',
  400,
);
const NotFoundResponseSchema = createApiErrorResponseSchema(
  'NotFoundResponse',
  404,
);

const generatedOpenApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'Saju Platform API',
    version: '1.0.0',
    description: '사주 플랫폼 Backend API 계약',
  },
  tags: [
    { name: 'System', description: '서비스 상태 확인' },
    { name: 'Reading Products', description: '풀이 상품 카탈로그' },
  ],
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
    customSiteTitle: 'Saju Platform API Docs',
    jsonDocumentUrl: '/openapi.json',
    yamlDocumentUrl: '/openapi.yaml',
  });
}
