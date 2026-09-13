import {
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import { AccountWithdrawalService } from '../src/modules/users/account-withdrawal.service.js';
import {
  AccountWithdrawalCompletedResponseSchema,
  AccountWithdrawalProcessingResponseSchema,
} from '../src/modules/users/account-withdrawal.contract.js';

describe('Account withdrawal HTTP contract', () => {
  let app: INestApplication<App>;
  const withdraw = vi.fn();
  const path = '/v1/users/me';
  beforeEach(async () => {
    withdraw.mockReset();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseAuthService)
      .useValue({
        verifyAccessToken: async (token: string) =>
          token === 'valid'
            ? {
                subject: 'dc3fd0fd-588d-4c71-a15f-d6b0bc58f257',
                displayName: null,
              }
            : null,
      })
      .overrideProvider(AccountWithdrawalService)
      .useValue({ withdraw })
      .compile();
    app = module.createNestApplication();
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    await app.init();
  });
  afterEach(async () => app.close());
  afterEach(() => vi.useRealTimers());
  it('requires authentication even when confirmation is present', async () => {
    const response = await request(app.getHttpServer())
      .delete(path)
      .send({ confirmDataDeletion: true })
      .expect(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(withdraw).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { confirmDataDeletion: false },
    { confirmDataDeletion: true, userId: 'someone-else' },
  ])('rejects invalid confirmation %j', async (body) => {
    await request(app.getHttpServer())
      .delete(path)
      .auth('valid', { type: 'bearer' })
      .send(body)
      .expect(400);
    expect(withdraw).not.toHaveBeenCalled();
  });
  it('returns a matching 200 or 202 envelope', async () => {
    for (const [status, code] of [
      ['completed', 200],
      ['processing', 202],
    ] as const) {
      withdraw.mockResolvedValue({ status });
      const response = await request(app.getHttpServer())
        .delete(path)
        .auth('valid', { type: 'bearer' })
        .send({ confirmDataDeletion: true })
        .expect(code);
      expect(response.headers['cache-control']).toBe('no-store');
      const schema =
        status === 'completed'
          ? AccountWithdrawalCompletedResponseSchema
          : AccountWithdrawalProcessingResponseSchema;
      expect(schema.parse(response.body).data.status).toBe(status);
    }
  });
  it('limits repeated requests by the authenticated subject', async () => {
    withdraw.mockResolvedValue({ status: 'processing' });
    for (let index = 0; index < 5; index++)
      await request(app.getHttpServer())
        .delete(path)
        .auth('valid', { type: 'bearer' })
        .send({ confirmDataDeletion: true })
        .expect(202);
    const response = await request(app.getHttpServer())
      .delete(path)
      .auth('valid', { type: 'bearer' })
      .send({ confirmDataDeletion: true })
      .expect(429);
    expect(response.headers['retry-after']).toBeDefined();
  });
  it('documents the delete request and both successful states', async () => {
    const response = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain('withdrawCurrentUser');
    expect(serialized).toContain('AccountWithdrawalCompletedResponse');
    expect(serialized).toContain('AccountWithdrawalProcessingResponse');
  });
  it('identifies a rejected withdrawal without exposing internal error details', async () => {
    withdraw.mockRejectedValue(
      new ServiceUnavailableException({
        reason: 'ACCOUNT_WITHDRAWAL_UNAVAILABLE',
        message: 'private provider details',
        fieldErrors: { secret: ['private key'] },
      }),
    );
    const response = await request(app.getHttpServer())
      .delete(path)
      .auth('valid', { type: 'bearer' })
      .send({ confirmDataDeletion: true })
      .expect(503);
    expect(response.body).toEqual({
      code: 503,
      message: '탈퇴 요청을 접수하지 못했어요. 잠시 후 다시 시도해주세요.',
      data: { reason: 'ACCOUNT_WITHDRAWAL_UNAVAILABLE' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('keeps unrecognized provider errors private', async () => {
    withdraw.mockRejectedValue(
      new ServiceUnavailableException({
        reason: 'private provider reason',
        message: 'private provider details',
      }),
    );
    const response = await request(app.getHttpServer())
      .delete(path)
      .auth('valid', { type: 'bearer' })
      .send({ confirmDataDeletion: true })
      .expect(503);
    expect(response.body).toEqual({
      code: 503,
      message: '서버 오류가 발생했습니다.',
      data: null,
    });
  });
});
