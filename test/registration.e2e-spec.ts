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
import { ApiErrorResponseSchema } from '../src/common/contracts/api-response.schema.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import { CurrentUserResponseSchema } from '../src/modules/users/user.contract.js';
import { UsersService } from '../src/modules/users/users.service.js';

const subject = 'dc3fd0fd-588d-4c71-a15f-d6b0bc58f257';
const confirmation = {
  termsAccepted: true,
  privacyPolicyAccepted: true,
  isAtLeast14: true,
};

describe('Registration HTTP contract', () => {
  let app: INestApplication<App>;
  const completeRegistration = vi.fn();
  const path = '/v1/users/me/registration';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseAuthService)
      .useValue({
        verifyAccessToken: async (token: string) =>
          token === 'valid' ? { subject, displayName: '테스트 이용자' } : null,
      })
      .overrideProvider(UsersService)
      .useValue({ completeRegistration })
      .compile();
    app = module.createNestApplication();
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    await app.init();
  });
  beforeEach(() => {
    completeRegistration.mockReset();
  });
  afterAll(async () => app.close());

  it('requires authentication before accepting confirmation', async () => {
    const response = await request(app.getHttpServer())
      .put(path)
      .send(confirmation)
      .expect(401);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'AUTHENTICATION_REQUIRED',
    );
    expect(completeRegistration).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...confirmation, termsAccepted: false },
    { ...confirmation, privacyPolicyAccepted: false },
    { ...confirmation, isAtLeast14: false },
    { ...confirmation, isAtLeast14: 'true' },
    { ...confirmation, userId: 'another-user' },
    { termsAccepted: true, privacyPolicyAccepted: true },
  ])('rejects missing, false or forged confirmation: %j', async (body) => {
    const response = await request(app.getHttpServer())
      .put(path)
      .auth('valid', { type: 'bearer' })
      .send(body)
      .expect(400);
    const error = ApiErrorResponseSchema.parse(response.body);
    expect(error.data?.reason).toBe('VALIDATION_ERROR');
    expect(error.data?.fieldErrors).toBeDefined();
    expect(completeRegistration).not.toHaveBeenCalled();
  });

  it('passes all confirmations and the authenticated identity to registration', async () => {
    completeRegistration.mockResolvedValue({
      user: {
        id: '53195553-c632-4f09-8c0e-9f5a1cdaf876',
        displayName: '테스트 이용자',
        status: 'active',
        createdAt: '2026-09-10T01:00:00.000Z',
        updatedAt: '2026-09-10T01:00:00.000Z',
        withdrawnAt: null,
      },
    });
    const response = await request(app.getHttpServer())
      .put(path)
      .auth('valid', { type: 'bearer' })
      .send(confirmation)
      .expect(200);
    expect(
      CurrentUserResponseSchema.parse(response.body).data.user.status,
    ).toBe('active');
    expect(completeRegistration).toHaveBeenCalledExactlyOnceWith(
      subject,
      '테스트 이용자',
      confirmation,
      'valid',
    );
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('does not turn a save failure into registration success', async () => {
    completeRegistration.mockRejectedValue(new ServiceUnavailableException());
    const response = await request(app.getHttpServer())
      .put(path)
      .auth('valid', { type: 'bearer' })
      .send(confirmation)
      .expect(503);
    expect(ApiErrorResponseSchema.parse(response.body).code).toBe(503);
  });
});
