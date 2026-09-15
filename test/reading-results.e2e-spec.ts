import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { UserStatus } from '../src/generated/prisma/client.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import { KieWealthRankingProvider } from '../src/modules/readings/infrastructure/kie-wealth-ranking.provider.js';
import { ReadingResultResponseSchema } from '../src/modules/readings/reading-result.contract.js';
import { WealthRankingDataSchema } from '../src/modules/readings/wealth-ranking.contract.js';

const JOB_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHART_IDS = [
  '11111111-1111-4111-a111-111111111111',
  '22222222-2222-4222-a222-222222222222',
];
const path = `/v1/reading-results/${JOB_ID}`;
function fixture() {
  return {
    id: JOB_ID,
    productCode: 'wealth-ranking',
    status: 'succeeded',
    stage: 'finished',
    result: WealthRankingDataSchema.parse({
      productCode: 'wealth-ranking',
      schemaVersion: 1,
      promptVersion: 'wealth-ranking-v5',
      generatedAt: '2026-09-12T00:00:00.000Z',
      ranking: [...CHART_IDS].reverse().map((chartId, index) => ({
        rank: index + 1,
        chartId,
        displayName: '이전이름',
        fortune: '소비 계획을 세우면 재물 관리에 도움이 돼요.',
        quality: 'partial',
        warnings: [
          {
            code: 'birth_time_unknown',
            message: '비공개 입력 1992-10-24 05:30',
          },
        ],
      })),
      rationale: '돈을 관리하는 성향을 비교한 상대 순위예요.',
      notice: '비공개 계산 경고와 출생시간 보정 05:30',
    }),
    participants: CHART_IDS.map((chartId, index) => ({
      chartId,
      chart: { profile: { displayName: `현재이름${index}` } },
    })),
    // Mock also contains unselected fields to catch accidental object spreads.
    ownerUserId: 'private-owner',
    requestId: 'private-request',
    leaseId: 'private-lease',
    errorReason: null,
  };
}

describe('Public reading result boundary (e2e)', () => {
  let app: INestApplication<App>;
  const database = {
    readingJob: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  const auth = { verifyAccessToken: vi.fn() };
  const provider = { assertAvailable: vi.fn(), generate: vi.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(database)
      .overrideProvider(SupabaseAuthService)
      .useValue(auth)
      .overrideProvider(KieWealthRankingProvider)
      .useValue(provider)
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
    database.readingJob.findFirst.mockResolvedValue(fixture());
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([undefined, 'expired-token'])(
    'opens historical results without login (authorization=%s)',
    async (token) => {
      const get = request(app.getHttpServer()).get(path);
      if (token) get.auth(token, { type: 'bearer' });
      const response = await get.expect(200);
      const { data } = ReadingResultResponseSchema.parse(response.body);
      expect(Object.keys(data).sort()).toEqual([
        'error',
        'id',
        'productCode',
        'result',
        'stage',
        'status',
      ]);
      expect(data.result?.comparisonTitle).toBe('함께 살펴보는 재물의 흐름');
      expect(data.result?.ranking).toEqual([
        {
          rank: 1,
          displayName: '현재이름1',
          fortune: '소비 계획을 세우면 재물 관리에 도움이 돼요.',
        },
        {
          rank: 2,
          displayName: '현재이름0',
          fortune: '소비 계획을 세우면 재물 관리에 도움이 돼요.',
        },
      ]);
      for (const privateText of [
        ...CHART_IDS,
        '이전이름',
        '비공개',
        '1992',
        '05:30',
        'chartId',
        'quality',
        'warnings',
        'generatedAt',
        'promptVersion',
        'ownerUserId',
        'private-',
      ]) {
        expect(response.text).not.toContain(privateText);
      }
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
      expect(auth.verifyAccessToken).not.toHaveBeenCalled();
      expect(provider.assertAvailable).not.toHaveBeenCalled();
      expect(provider.generate).not.toHaveBeenCalled();
      expect(database.readingJob.findFirst).toHaveBeenCalledWith({
        where: {
          id: JOB_ID,
          productCode: 'wealth-ranking',
          owner: { status: UserStatus.ACTIVE },
          participants: { every: { chart: { profile: { deletedAt: null } } } },
        },
        select: {
          id: true,
          productCode: true,
          status: true,
          stage: true,
          result: true,
          participants: {
            select: {
              chartId: true,
              chart: { select: { profile: { select: { displayName: true } } } },
            },
          },
        },
      });
    },
  );

  it('returns the generated title and current names while keeping stored references private to the reading source', async () => {
    const job = fixture();
    job.result.promptVersion = 'wealth-ranking-v7';
    job.result.comparisonTitle = '기회를 넓히는 감각과 돈을 지키는 습관';
    job.result.rationale =
      '1위 참여자님은 기회를 살리고 2위 참여자님은 지출을 기록하면 좋아요.';
    database.readingJob.findFirst.mockResolvedValue(job);
    const response = await request(app.getHttpServer()).get(path).expect(200);
    const { data } = ReadingResultResponseSchema.parse(response.body);
    expect(data.result?.comparisonTitle).toBe(job.result.comparisonTitle);
    expect(data.result?.rationale).toBe(
      '현재이름1님은 기회를 살리고 현재이름0님은 지출을 기록하면 좋아요.',
    );
    expect(response.text).not.toContain('위 참여자');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', 'queued'],
    ['running', 'preparing'],
    ['running', 'interpreting'],
    ['running', 'saving'],
    ['failed', 'finished'],
  ])(
    'allows public polling of %s/%s without private payloads',
    async (status, stage) => {
      database.readingJob.findFirst.mockResolvedValue({
        ...fixture(),
        status,
        stage,
        errorReason: 'SAJU_REFERENCE_CONFLICT',
      });
      const response = await request(app.getHttpServer()).get(path).expect(200);
      const { data } = ReadingResultResponseSchema.parse(response.body);
      expect(data).toEqual({
        id: JOB_ID,
        productCode: 'wealth-ranking',
        status,
        stage,
        result: null,
        error:
          status === 'failed' ? { message: '풀이를 완료하지 못했어요.' } : null,
      });
      expect(response.text).not.toContain('SAJU_REFERENCE_CONFLICT');
      expect(response.text).not.toContain('현재이름');
    },
  );

  it('returns 404 for absent, withdrawn or deleted results and prevents fallback to old names', async () => {
    database.readingJob.findFirst.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get(path).expect(404);
    database.readingJob.findFirst.mockResolvedValueOnce({
      ...fixture(),
      participants: [],
    });
    const response = await request(app.getHttpServer()).get(path).expect(404);
    expect(response.text).not.toContain('이전이름');
  });

  it('validates UUIDs before storage access and hides corrupt stored results', async () => {
    await request(app.getHttpServer())
      .get('/v1/reading-results/not-a-uuid')
      .expect(400);
    expect(database.readingJob.findFirst).not.toHaveBeenCalled();
    database.readingJob.findFirst.mockResolvedValueOnce({
      ...fixture(),
      result: { secret: 'private-payload' },
    });
    const response = await request(app.getHttpServer()).get(path).expect(500);
    expect(response.text).not.toContain('private-payload');
  });

  it('keeps creation, personal history and owner details authenticated', async () => {
    await request(app.getHttpServer())
      .post('/v1/reading-jobs')
      .send({ productCode: 'wealth-ranking', chartIds: CHART_IDS })
      .expect(401);
    await request(app.getHttpServer()).get('/v1/reading-jobs').expect(401);
    await request(app.getHttpServer())
      .get(`/v1/reading-jobs/${JOB_ID}`)
      .expect(401);
    expect(database.readingJob.findFirst).not.toHaveBeenCalled();
    expect(database.user.findUnique).not.toHaveBeenCalled();
  });

  it('keeps private details scoped to the authenticated owner', async () => {
    auth.verifyAccessToken.mockResolvedValue({
      subject: 'another-user',
      displayName: null,
    });
    database.user.findUnique.mockResolvedValue({
      id: 'another-owner',
      status: UserStatus.ACTIVE,
    });
    database.readingJob.findFirst.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get(`/v1/reading-jobs/${JOB_ID}`)
      .auth('valid-token', { type: 'bearer' })
      .expect(404);
    expect(database.readingJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: JOB_ID,
          ownerUserId: 'another-owner',
          owner: { status: UserStatus.ACTIVE },
        },
      }),
    );
  });
});
