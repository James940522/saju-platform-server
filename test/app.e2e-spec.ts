import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { AppModule } from './../src/app.module.js';
import { configureApplication } from './../src/app.setup.js';
import { ApiErrorResponseSchema } from './../src/common/contracts/api-response.schema.js';
import type { EnvironmentVariables } from './../src/config/environment.schema.js';
import { HealthResponseSchema } from './../src/modules/health/health.contract.js';
import {
  GetReadingProductResponseSchema,
  GetReadingProductsResponseSchema,
} from './../src/modules/reading-products/reading-product.contract.js';

const OpenApiDocumentSchema = z.object({
  openapi: z.string(),
  paths: z.object({
    '/health': z.unknown(),
    '/v1/reading-products': z.unknown(),
    '/v1/reading-products/{productCode}': z.unknown(),
    '/v1/users/me': z.unknown(),
    '/v1/users/me/registration': z.unknown(),
    '/v1/saju-profiles': z.unknown(),
    '/v1/saju-profiles/{profileId}': z.object({
      delete: z.unknown(),
      get: z.unknown(),
      patch: z.unknown(),
    }),
  }),
});

describe('Application (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const configService =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    configureApplication(app, configService);
    await app.init();
  });

  it('GET /health returns the standard response envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    const body = HealthResponseSchema.parse(response.body);

    expect(body.code).toBe(200);
    expect(body.message).toBe('서비스가 정상적으로 동작 중입니다.');
    expect(body.data.status).toBe('ok');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('GET /v1/reading-products returns the server catalog', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/reading-products')
      .expect(200);
    const body = GetReadingProductsResponseSchema.parse(response.body);

    expect(body.code).toBe(200);
    expect(body.message).toBe('풀이 상품 목록을 조회했습니다.');
    expect(body.data.products.map((product) => product.code)).toEqual([
      'wealth-ranking',
      'past-life-relationship',
      'detailed-saju',
      'daily-fortune',
      'monthly-fortune',
      'three-month-fortune',
    ]);
    expect(body.data.products[0]).not.toHaveProperty('subjectRequirement');
    expect(body.data.products[0]).not.toHaveProperty('resultType');
    expect(body.data.products[0]).not.toHaveProperty('highlights');
  });

  it('GET /v1/reading-products/:code returns one product', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/reading-products/past-life-relationship')
      .expect(200);
    const body = GetReadingProductResponseSchema.parse(response.body);

    expect(body.data.product).toMatchObject({
      code: 'past-life-relationship',
      availability: 'active',
      subjectRequirement: { type: 'pair' },
    });
  });

  it('returns the standard error envelope for an unknown product', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/reading-products/unknown-product')
      .expect(404);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.code).toBe(404);
    expect(body.data?.reason).toBe('READING_PRODUCT_NOT_FOUND');
  });

  it('does not expose a hidden product', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/reading-products/love-fortune')
      .expect(404);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.data?.reason).toBe('READING_PRODUCT_NOT_FOUND');
  });

  it('validates path parameters with Zod', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/reading-products/INVALID_CODE')
      .expect(400);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.code).toBe(400);
    expect(body.data?.reason).toBe('VALIDATION_ERROR');
    expect(body.data?.fieldErrors?.productCode).toBeDefined();
  });

  it('serves the OpenAPI contract', async () => {
    const response = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);

    OpenApiDocumentSchema.parse(response.body);
  });

  it('requires a Supabase access token for the current user API', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/users/me')
      .expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.data?.reason).toBe('AUTHENTICATION_REQUIRED');
  });

  it('requires a Supabase access token for the saju profile API', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/saju-profiles')
      .expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.data?.reason).toBe('AUTHENTICATION_REQUIRED');
  });

  it('requires a Supabase access token to update a saju profile', async () => {
    const response = await request(app.getHttpServer())
      .patch('/v1/saju-profiles/827b4a76-b8c5-462f-afd4-af6415ca9f71')
      .send({ displayName: '수정 이름' })
      .expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.data?.reason).toBe('AUTHENTICATION_REQUIRED');
  });

  it('requires a Supabase access token to delete a saju profile', async () => {
    const response = await request(app.getHttpServer())
      .delete('/v1/saju-profiles/827b4a76-b8c5-462f-afd4-af6415ca9f71')
      .expect(401);
    const body = ApiErrorResponseSchema.parse(response.body);

    expect(body.data?.reason).toBe('AUTHENTICATION_REQUIRED');
  });

  afterAll(async () => {
    await app.close();
  });
});
