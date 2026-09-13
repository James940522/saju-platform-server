import { randomUUID } from 'node:crypto';
import {
  type INestApplication,
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { ApiErrorResponseSchema } from '../src/common/contracts/api-response.schema.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserStatus } from '../src/generated/prisma/client.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import { KieWealthRankingProvider } from '../src/modules/readings/infrastructure/kie-wealth-ranking.provider.js';
import { KasiCalendarProvider } from '../src/modules/readings/infrastructure/kasi-calendar.provider.js';
import { WealthRankingResponseSchema } from '../src/modules/readings/wealth-ranking.contract.js';
import {
  wealthCharts,
  wealthModelOutput,
  WEALTH_CHART_IDS,
} from './fixtures/wealth-ranking.fixture.js';

const path = '/v1/readings/wealth-ranking';
const USER_ID = '53195553-c632-4f09-8c0e-9f5a1cdaf876';

describe('Wealth ranking API (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const database = {
    user: { findUnique: vi.fn() },
    sajuChart: { findMany: vi.fn() },
  };
  const provider = { assertAvailable: vi.fn(), generate: vi.fn() };
  const calendar = { verify: vi.fn() };
  const records = () =>
    wealthCharts().map((chart, index) => ({
      id: chart.chartId,
      profileId: `profile-${index}`,
      payload: chart.snapshot,
      profile: { displayName: chart.displayName },
    }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(SupabaseAuthService)
      .useValue({
        verifyAccessToken: (value: string) =>
          value === token ? { subject: token, displayName: null } : null,
      })
      .overrideProvider(KieWealthRankingProvider)
      .useValue(provider)
      .overrideProvider(KasiCalendarProvider)
      .useValue(calendar)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    await app.init();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    token = randomUUID();
    database.user.findUnique.mockResolvedValue({
      id: USER_ID,
      status: UserStatus.ACTIVE,
      primarySajuProfileId: null,
    });
    database.sajuChart.findMany.mockResolvedValue(records());
    provider.generate.mockResolvedValue(wealthModelOutput());
    calendar.verify.mockResolvedValue('matched');
  });
  afterAll(async () => {
    await app.close();
  });
  const post = (body: object = { chartIds: WEALTH_CHART_IDS }) =>
    request(app.getHttpServer())
      .post(path)
      .auth(token, { type: 'bearer' })
      .send(body);

  it('returns all three outputs and rechecks ownership after generation', async () => {
    const response = await post().expect(200);
    const result = WealthRankingResponseSchema.parse(response.body);
    expect(result.data.ranking).toHaveLength(2);
    expect(result.data.ranking.map(({ rank }) => rank)).toEqual([1, 2]);
    expect(result.data.ranking[0]).toMatchObject({
      chartId: WEALTH_CHART_IDS[1],
      quality: 'partial',
    });
    expect(result.data.rationale).toContain('1위 참여자');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(calendar.verify).toHaveBeenCalledTimes(2);
    expect(result.data.notice).toContain('한국천문연구원');
    expect(database.sajuChart.findMany).toHaveBeenCalledTimes(2);
    expect(database.sajuChart.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: WEALTH_CHART_IDS },
        profile: {
          ownerUserId: USER_ID,
          deletedAt: null,
          owner: { status: UserStatus.ACTIVE },
        },
      },
      select: {
        id: true,
        profileId: true,
        payload: true,
        profile: { select: { displayName: true } },
      },
    });
    expect(JSON.stringify(provider.generate.mock.calls)).not.toContain(
      '동명이인',
    );
  });

  it.each([undefined, 'invalid-token'])(
    'requires valid authentication (%s)',
    async (authorization) => {
      const operation = request(app.getHttpServer()).post(path);
      if (authorization) operation.auth(authorization, { type: 'bearer' });
      const response = await operation
        .send({ chartIds: WEALTH_CHART_IDS })
        .expect(401);
      expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
        'AUTHENTICATION_REQUIRED',
      );
      expect(response.headers['cache-control']).toBe('no-store');
      expect(provider.generate).not.toHaveBeenCalled();
      expect(database.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { chartIds: [] },
    { chartIds: [WEALTH_CHART_IDS[0], WEALTH_CHART_IDS[0]] },
    { chartIds: WEALTH_CHART_IDS, snapshot: {} },
  ])('rejects invalid input before provider access', async (body) => {
    const response = await post(body).expect(400);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'VALIDATION_ERROR',
    );
    expect(provider.generate).not.toHaveBeenCalled();
    expect(database.user.findUnique).not.toHaveBeenCalled();
  });

  it.each([null, UserStatus.PENDING_REGISTRATION, UserStatus.WITHDRAWN])(
    'rejects unavailable user %s',
    async (status) => {
      database.user.findUnique.mockResolvedValue(
        status ? { id: USER_ID, status } : null,
      );
      await post().expect(403);
      expect(database.sajuChart.findMany).not.toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
    },
  );

  it('does not disclose missing, foreign, or deleted charts', async () => {
    database.sajuChart.findMany.mockResolvedValue(records().slice(0, 1));
    const response = await post().expect(404);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'SAJU_CHART_NOT_FOUND',
    );
    expect(provider.generate).not.toHaveBeenCalled();
    expect(calendar.verify).not.toHaveBeenCalled();
  });

  it('stops before the AI call on an official calendar mismatch', async () => {
    calendar.verify.mockRejectedValueOnce(
      new ConflictException({
        message: '음양력 정보가 일치하지 않습니다.',
        reason: 'SAJU_CALENDAR_MISMATCH',
      }),
    );
    const response = await post().expect(409);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'SAJU_CALENDAR_MISMATCH',
    );
    expect(provider.generate).not.toHaveBeenCalled();
    // The failure also releases the account's in-flight slot.
    await post().expect(200);
  });

  it('includes reference unavailability in the prompt and notice without inventing a match', async () => {
    calendar.verify.mockResolvedValue('unavailable');
    const response = await post().expect(200);
    expect(
      WealthRankingResponseSchema.parse(response.body).data.notice,
    ).toContain('대조를 일부 완료하지 못해');
    expect(provider.generate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          calendarVerification: expect.objectContaining({
            status: 'unavailable',
          }),
        }),
      ]),
    );
  });

  it('rejects multiple historical charts belonging to one profile', async () => {
    database.sajuChart.findMany.mockResolvedValue(
      records().map((row) => ({ ...row, profileId: 'same-profile' })),
    );
    const response = await post().expect(409);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'DUPLICATE_READING_PARTICIPANT',
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('rejects deletion during the AI call', async () => {
    database.sajuChart.findMany
      .mockResolvedValueOnce(records())
      .mockResolvedValueOnce([]);
    await post().expect(404);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects withdrawal during the AI call', async () => {
    database.user.findUnique
      .mockResolvedValueOnce({ id: USER_ID, status: UserStatus.ACTIVE })
      .mockResolvedValueOnce(null);
    await post().expect(403);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid model output instead of returning a fallback ranking', async () => {
    provider.generate.mockResolvedValue({ ranking: [], rationale: 'fake' });
    const response = await post().expect(502);
    expect(ApiErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 502,
      data: null,
    });
    expect(response.text).not.toContain('fake');
  });

  it.each([
    [502, new BadGatewayException('private provider response')],
    [504, new GatewayTimeoutException('private timeout')],
  ])(
    'normalizes %s failures and releases the in-flight slot',
    async (status, failure) => {
      provider.generate.mockRejectedValueOnce(failure);
      const response = await post().expect(status);
      expect(response.text).not.toContain('private');
      expect(response.headers['cache-control']).toBe('no-store');
      await post().expect(200);
    },
  );

  it('returns 503 before loading charts when not configured', async () => {
    provider.assertAvailable.mockImplementationOnce(() => {
      throw new ServiceUnavailableException();
    });
    await post().expect(503);
    expect(database.user.findUnique).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('limits a user to three attempts regardless of forwarded IP', async () => {
    for (let index = 0; index < 3; index++) await post().expect(200);
    const response = await post()
      .set('X-Forwarded-For', '203.0.113.1')
      .expect(429);
    expect(response.headers['retry-after']).toBeDefined();
    expect(provider.generate).toHaveBeenCalledTimes(3);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    try {
      await post().expect(200);
    } finally {
      now.mockRestore();
    }
  });

  it('prevents overlapping calls for the same account', async () => {
    let resolveStarted: (() => void) | undefined;
    let resolveCompletion: ((value: unknown) => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const completion = new Promise<unknown>((resolve) => {
      resolveCompletion = resolve;
    });
    provider.generate.mockImplementationOnce(() => {
      resolveStarted?.();
      return completion;
    });
    const first = post()
      .expect(200)
      .then((response) => response);
    await started;
    try {
      const response = await post().expect(409);
      expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
        'READING_IN_PROGRESS',
      );
    } finally {
      resolveCompletion?.(wealthModelOutput());
      await first;
    }
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('publishes matching OpenAPI request, response and authentication contracts', async () => {
    const response = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);
    expect(response.body).toMatchObject({
      paths: {
        [path]: {
          post: {
            security: [{ supabaseBearer: [] }],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/CreateWealthRankingRequest',
                  },
                },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/WealthRankingResponse',
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          CreateWealthRankingRequest: {
            additionalProperties: false,
            properties: { chartIds: { minItems: 2, maxItems: 5 } },
          },
        },
      },
    });
  });
});
