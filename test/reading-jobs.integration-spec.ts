import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaClient, UserStatus } from '../src/generated/prisma/client.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import { AuthAccountAdminService } from '../src/modules/auth/auth-account-admin.service.js';
import { AccountWithdrawalService } from '../src/modules/users/account-withdrawal.service.js';
import { SajuProfilesService } from '../src/modules/saju-profiles/index.js';
import { KieWealthRankingProvider } from '../src/modules/readings/infrastructure/kie-wealth-ranking.provider.js';
import { KasiCalendarProvider } from '../src/modules/readings/infrastructure/kasi-calendar.provider.js';
import { KasiSolarTermsProvider } from '../src/modules/readings/infrastructure/kasi-solar-terms.provider.js';
import { ReadingJobsWorker } from '../src/modules/readings/reading-jobs.worker.js';
import { ReadingJobsService } from '../src/modules/readings/reading-jobs.service.js';
import {
  ReadingJobAcceptedSchema,
  ReadingJobResponseSchema,
  ReadingJobsResponseSchema,
} from '../src/modules/readings/reading-job.contract.js';
import { solarTermVerification } from '../src/modules/readings/saju-solar-term-verification.js';
import { wealthModelOutput } from './fixtures/wealth-ranking.fixture.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Reading jobs: HTTP + durable PostgreSQL worker', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let profiles: SajuProfilesService;
  let worker: ReadingJobsWorker;
  let service: ReadingJobsService;
  let chartIds: string[];
  let profileIds: string[];
  const subjects = [
    process.env.TEST_USER_ID_1,
    process.env.TEST_USER_ID_2,
  ].filter((id): id is string => Boolean(id));
  const owner = () => subjects[0]!;
  const provider = { assertAvailable: vi.fn(), generate: vi.fn() };
  const calendar = { verify: vi.fn() };
  const terms = { verify: vi.fn() };

  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    const schema = process.env.TEST_DATABASE_SCHEMA;
    if (
      !connectionString ||
      !schema ||
      subjects.length !== 2 ||
      !(
        /^saju_test_[a-f0-9]{32}$/.test(schema) ||
        (schema === 'public' && process.env.TEST_USE_DEVELOPMENT_DB === 'true')
      )
    )
      throw new Error('Use the isolated storage test runner.');
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SupabaseAuthService)
      .useValue({
        verifyAccessToken: async (token: string) =>
          subjects.includes(token)
            ? { subject: token, displayName: null }
            : null,
      })
      .overrideProvider(KieWealthRankingProvider)
      .useValue(provider)
      .overrideProvider(KasiCalendarProvider)
      .useValue(calendar)
      .overrideProvider(KasiSolarTermsProvider)
      .useValue(terms)
      .overrideProvider(AuthAccountAdminService)
      .useValue({
        requireEnabled: vi.fn(),
        getKakaoIdentity: vi.fn().mockResolvedValue('123'),
        unlinkKakao: vi.fn(),
        deleteAuthUser: vi.fn(),
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    // Keep one listener open for concurrent HTTP requests; avoid Supertest's
    // per-request ephemeral listener lifecycle during parallel replay.
    await app.listen(0, '127.0.0.1');
    profiles = app.get(SajuProfilesService);
    worker = app.get(ReadingJobsWorker);
    service = app.get(ReadingJobsService);
  });
  async function clean() {
    await prisma.readingJob.deleteMany({
      where: { ownerUserId: { in: subjects } },
    });
    await prisma.accountWithdrawal.deleteMany({
      where: { authSubject: { in: subjects } },
    });
    await prisma.user.deleteMany({ where: { id: { in: subjects } } });
  }
  beforeEach(async () => {
    vi.clearAllMocks();
    await clean();
    for (const id of subjects)
      await prisma.user.create({
        data: { id, authSubject: id, status: UserStatus.ACTIVE },
      });
    chartIds = [];
    profileIds = [];
    for (let index = 0; index < 2; index++) {
      const data = await profiles.create(
        owner(),
        {
          displayName: `작업 테스트 ${index + 1}`,
          relationType: 'friend',
          birth: {
            calendarType: 'solar',
            isLeapMonth: false,
            date: { year: 1992 + index, month: 10, day: 24 },
            time:
              index === 0
                ? { precision: 'exact', hour: 5, minute: 30 }
                : { precision: 'unknown' },
            luckCycleGender: 'male',
          },
        },
        randomUUID(),
      );
      chartIds.push(data.chart.id);
      profileIds.push(data.profile.id);
    }
    provider.generate.mockResolvedValue(wealthModelOutput());
    calendar.verify.mockResolvedValue('matched');
    terms.verify.mockResolvedValue(solarTermVerification('matched'));
  });
  afterAll(async () => {
    if (prisma) await clean();
    await app?.close();
    await prisma?.$disconnect();
  });
  const post = (key = randomUUID(), ids = chartIds, token = owner()) =>
    request(app.getHttpServer())
      .post('/v1/reading-jobs')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({ productCode: 'wealth-ranking', chartIds: ids });
  const get = (id: string, token = owner()) =>
    request(app.getHttpServer())
      .get(`/v1/reading-jobs/${id}`)
      .auth(token, { type: 'bearer' });
  const accept = async (key = randomUUID()) =>
    ReadingJobAcceptedSchema.parse((await post(key).expect(202)).body).data;

  it('expires a queued job at its original submission deadline without generating a reading', async () => {
    const job = await accept();
    await prisma.readingJob.update({
      where: { id: job.id },
      data: { createdAt: new Date(Date.now() - 301_000) },
    });
    await worker.recoverExpired();
    expect(
      await prisma.readingJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'failed',
      stage: 'finished',
      errorReason: 'READING_TIMEOUT',
      result: null,
      leaseId: null,
    });
    expect(await worker.claimNext()).toBeNull();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('does not overwrite timeout with a late model completion from an expired lease', async () => {
    const job = await accept();
    const entered = deferred<void>();
    const output = deferred<ReturnType<typeof wealthModelOutput>>();
    provider.generate.mockImplementation(() => {
      entered.resolve();
      return output.promise;
    });
    const claim = await worker.claimNext();
    const processing = worker.process(job.id, claim!.leaseId);
    await entered.promise;
    try {
      await prisma.readingJob.update({
        where: { id: job.id },
        data: { createdAt: new Date(Date.now() - 301_000) },
      });
      await worker.recoverExpired();
    } finally {
      output.resolve(wealthModelOutput());
      await processing;
    }
    expect(
      await prisma.readingJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'failed',
      errorReason: 'READING_TIMEOUT',
      result: null,
      leaseId: null,
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it('accepts without AI, exposes progress after navigation, persists output, and never runs GET/replay as AI', async () => {
    const key = randomUUID();
    const job = await accept(key);
    expect(job).toMatchObject({ status: 'queued', result: null });
    expect(provider.generate).not.toHaveBeenCalled();
    const entered = deferred<void>();
    const output = deferred<ReturnType<typeof wealthModelOutput>>();
    provider.generate.mockImplementation(() => {
      entered.resolve();
      return output.promise;
    });
    const claim = await worker.claimNext();
    expect(claim?.jobId).toBe(job.id);
    const processing = worker.process(job.id, claim!.leaseId);
    await entered.promise;
    try {
      expect(calendar.verify).toHaveBeenCalledTimes(2);
      expect(terms.verify).toHaveBeenCalledTimes(2);
      const progress = await get(job.id).expect(200);
      expect(ReadingJobResponseSchema.parse(progress.body).data).toMatchObject({
        status: 'running',
        stage: 'interpreting',
      });
      expect(progress.headers['cache-control']).toBe('no-store');
      expect(progress.headers['x-request-id']).toBeDefined();
      expect((await accept(key)).id).toBe(job.id);
      expect(await worker.claimNext()).toBeNull();
    } finally {
      output.resolve(wealthModelOutput());
      await processing;
    }
    expect(
      ReadingJobResponseSchema.parse((await get(job.id).expect(200)).body).data
        .result?.ranking,
    ).toHaveLength(2);
    // A fresh service instance has no page/process memory and still reads the saved result.
    const reloaded = new ReadingJobsService(
      app.get(PrismaService),
      app.get(KieWealthRankingProvider),
    );
    expect((await reloaded.findOne(owner(), job.id)).status).toBe('succeeded');
    await post(key).expect(202);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    await get(job.id, subjects[1]).expect(404);
    const listing = ReadingJobsResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .get('/v1/reading-jobs')
          .auth(owner(), { type: 'bearer' })
          .expect(200)
      ).body,
    );
    expect(listing.data.jobs[0]?.status).toBe('succeeded');
    expect(listing.data.jobs[0]).not.toHaveProperty('result');
  });

  it('serializes parallel replay and active admission across DB connections', async () => {
    const key = randomUUID();
    const accepted = await Promise.all(
      Array.from({ length: 4 }, () => post(key).expect(202)),
    );
    const ids = accepted.map(
      (response) => ReadingJobAcceptedSchema.parse(response.body).data.id,
    );
    expect(new Set(ids).size).toBe(1);
    expect(
      await prisma.readingJob.count({ where: { ownerUserId: owner() } }),
    ).toBe(1);
    expect(
      await prisma.readingRequest.count({ where: { ownerUserId: owner() } }),
    ).toBe(1);
    await post().expect(409);
    await post(key, [...chartIds].reverse()).expect(409);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('atomically claims a queued job once, recovers preparation, and never replays uncertain AI', async () => {
    const job = await accept();
    const claims = await Promise.all([worker.claimNext(), worker.claimNext()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const old = claims.find((claim) => claim !== null)!;
    await prisma.readingJob.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(Date.now() - 1) },
    });
    await worker.recoverExpired();
    expect((await service.findOne(owner(), job.id)).status).toBe('queued');
    await worker.process(job.id, old.leaseId);
    expect(provider.generate).not.toHaveBeenCalled();
    const next = await worker.claimNext();
    await prisma.readingJob.update({
      where: { id: job.id },
      data: { stage: 'interpreting', leaseUntil: new Date(Date.now() - 1) },
    });
    await worker.recoverExpired();
    expect(await service.findOne(owner(), job.id)).toMatchObject({
      status: 'failed',
      error: { reason: 'READING_INTERRUPTED' },
    });
    await worker.process(job.id, next!.leaseId);
    expect(await worker.claimNext()).toBeNull();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('deletes a running result with its participant and prevents replay or late resurrection', async () => {
    const key = randomUUID();
    const job = await accept(key);
    const entered = deferred<void>();
    const output = deferred<ReturnType<typeof wealthModelOutput>>();
    provider.generate.mockImplementation(() => {
      entered.resolve();
      return output.promise;
    });
    const claim = await worker.claimNext();
    const processing = worker.process(job.id, claim!.leaseId);
    await entered.promise;
    try {
      await profiles.remove(owner(), profileIds[0]!);
    } finally {
      output.resolve(wealthModelOutput());
      await processing;
    }
    await get(job.id).expect(404);
    await post(key).expect(410);
    expect(await prisma.readingJob.count({ where: { id: job.id } })).toBe(0);
    const tombstone = await prisma.readingRequest.findUniqueOrThrow({
      where: {
        ownerUserId_requestKey: { ownerUserId: owner(), requestKey: key },
      },
    });
    expect(tombstone.jobId).toBeNull();
  });

  it('cleans job content and replay hashes during actual withdrawal', async () => {
    const job = await accept();
    const claim = await worker.claimNext();
    await worker.process(job.id, claim!.leaseId);
    await app.get(AccountWithdrawalService).withdraw(owner(), owner());
    expect(
      await prisma.readingJob.count({ where: { ownerUserId: owner() } }),
    ).toBe(0);
    expect(
      await prisma.readingRequest.count({ where: { ownerUserId: owner() } }),
    ).toBe(0);
  });

  it('stores only safe failures, paginates history and applies the durable quota without charging replays', async () => {
    provider.generate.mockRejectedValue(
      new Error('private-provider-payload-and-secret'),
    );
    const keys = [randomUUID(), randomUUID(), randomUUID()];
    const ids: string[] = [];
    for (const key of keys) {
      const job = await accept(key);
      ids.push(job.id);
      const claim = await worker.claimNext();
      await worker.process(job.id, claim!.leaseId);
      const detail = await service.findOne(owner(), job.id);
      expect(detail).toMatchObject({
        status: 'failed',
        result: null,
        error: { reason: 'READING_FAILED' },
      });
      expect(JSON.stringify(detail)).not.toContain('private-provider');
    }
    await post().expect(429);
    await post(keys[0]).expect(202);
    expect(provider.generate).toHaveBeenCalledTimes(3);
    const first = await service.findAll(owner(), { limit: 1 });
    const second = await service.findAll(owner(), {
      limit: 1,
      cursor: first.nextCursor!,
    });
    const third = await service.findAll(owner(), {
      limit: 1,
      cursor: second.nextCursor!,
    });
    expect(
      [...first.jobs, ...second.jobs, ...third.jobs].map((job) => job.id),
    ).toEqual(ids.reverse());
    expect(third.nextCursor).toBeNull();
    await expect(
      service.findAll(subjects[1]!, { limit: 1, cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('validates auth, product, IDs, pagination and ownership before creating work', async () => {
    await post(randomUUID(), chartIds, 'invalid').expect(401);
    await post(randomUUID(), chartIds, subjects[1]).expect(404);
    await post(randomUUID(), [chartIds[0]!, chartIds[0]!]).expect(400);
    await request(app.getHttpServer())
      .post('/v1/reading-jobs')
      .auth(owner(), { type: 'bearer' })
      .send({ productCode: 'wealth-ranking', chartIds })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/reading-jobs')
      .auth(owner(), { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ productCode: 'paid-future-product', chartIds })
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/reading-jobs?limit=999')
      .auth(owner(), { type: 'bearer' })
      .expect(400);
    await get('invalid').expect(400);
    expect(
      await prisma.readingJob.count({
        where: { ownerUserId: { in: subjects } },
      }),
    ).toBe(0);
  });
});
