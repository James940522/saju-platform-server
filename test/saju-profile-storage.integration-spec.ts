import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { ApiErrorResponseSchema } from '../src/common/contracts/api-response.schema.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaClient, UserStatus } from '../src/generated/prisma/client.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import { SajuProfilesService } from '../src/modules/saju-profiles/index.js';
import {
  SajuChartCalculator,
  SAJU_POLICY_VERSION,
} from '../src/modules/saju-profiles/saju-chart-calculator.js';
import { SajuChartPreviewRateLimitGuard } from '../src/modules/saju-profiles/saju-chart-preview-rate-limit.guard.js';
import {
  CreateSajuProfileResponseSchema,
  GetSajuProfileResponseSchema,
  GetSajuProfilesResponseSchema,
  DeleteSajuProfileResponseSchema,
  UpdateSajuProfileResponseSchema,
  SajuChartSnapshotV1Schema,
  type CreateSajuProfileRequest,
} from '../src/modules/saju-profiles/saju-profile.contract.js';

const INPUT: CreateSajuProfileRequest = {
  displayName: '저장 테스트',
  relationType: 'self',
  birth: {
    calendarType: 'lunar',
    isLeapMonth: false,
    date: { year: 1965, month: 3, day: 10 },
    time: { precision: 'exact', hour: 7, minute: 20 },
    luckCycleGender: 'female',
  },
};

describe('Saju profile HTTP + PostgreSQL storage', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof testDatabase>;
  let failCreationOwnerId: string | null = null;
  let failUpdateProfileId: string | null = null;
  const ownedUserIds = [
    process.env.TEST_USER_ID_1,
    process.env.TEST_USER_ID_2,
  ].filter((id): id is string => Boolean(id));
  const ownerFilter = () => ({ ownerUserId: { in: ownedUserIds } });

  function testDatabase(connectionString: string, schema: string) {
    return new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    }).$extends({
      query: {
        sajuProfileCreation: {
          async create({ args, query }) {
            if (args.data.ownerUserId === failCreationOwnerId)
              throw new Error('injected test failure');
            return query(args);
          },
        },
        sajuProfile: {
          async update({ args, query }) {
            if (args.where.id === failUpdateProfileId)
              throw new Error('injected test failure');
            return query(args);
          },
        },
      },
    });
  }
  let sql: pg.Client;
  let owner: { id: string; authSubject: string };
  let other: { id: string; authSubject: string };
  const tokens = new Set<string>();

  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    const schema = process.env.TEST_DATABASE_SCHEMA;
    const isolatedSchema = schema && /^saju_test_[a-f0-9]{32}$/.test(schema);
    const explicitDevelopment =
      schema === 'public' && process.env.TEST_USE_DEVELOPMENT_DB === 'true';
    if (
      !connectionString ||
      !schema ||
      (!isolatedSchema && !explicitDevelopment) ||
      ownedUserIds.length !== 2
    ) {
      throw new Error(
        'Run via npm run test:integration; scoped test user IDs are required.',
      );
    }
    sql = new pg.Client({ connectionString });
    await sql.connect();
    const currentSchema = await sql.query<{ schema: string }>(
      'SELECT current_schema() AS schema',
    );
    if (currentSchema.rows[0]?.schema !== schema)
      throw new Error('Refusing to test outside the isolated schema.');
    prisma = testDatabase(connectionString, schema);
    await prisma.$connect();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // Real HTTP auth guard; only the external token verification is replaced.
      .overrideProvider(SupabaseAuthService)
      .useValue({
        verifyAccessToken: async (token: string) =>
          tokens.has(token) ? { subject: token, displayName: null } : null,
      })
      // Rate limits have separate e2e coverage; this suite sends a large batch.
      .overrideGuard(SajuChartPreviewRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    await app.init();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    tokens.clear();
    // Only the two UUIDs reserved for this test run are ever cleaned up.
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    const [ownerId, otherId] = ownedUserIds;
    if (!ownerId || !otherId) throw new Error('Missing test user IDs');
    owner = { id: ownerId, authSubject: randomUUID() };
    other = { id: otherId, authSubject: randomUUID() };
    await prisma.user.createMany({
      data: [owner, other].map((user) => ({
        ...user,
        status: UserStatus.ACTIVE,
      })),
    });
    tokens.add(owner.authSubject);
    tokens.add(other.authSubject);
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { id: { in: ownedUserIds } } });
    await app?.close();
    await prisma?.$disconnect();
    await sql?.end();
  });

  function create(
    input = INPUT,
    key: string = randomUUID(),
    subject = owner.authSubject,
  ) {
    return request(app.getHttpServer())
      .post('/v1/saju-profiles')
      .auth(subject, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(input);
  }
  async function saved(input = INPUT, key: string = randomUUID()) {
    return CreateSajuProfileResponseSchema.parse(
      (await create(input, key).expect(201)).body,
    ).data;
  }
  function patch(
    id: string,
    data: Record<string, unknown>,
    subject = owner.authSubject,
  ) {
    return request(app.getHttpServer())
      .patch(`/v1/saju-profiles/${id}`)
      .auth(subject, { type: 'bearer' })
      .send(data);
  }
  function get(id: string, subject = owner.authSubject) {
    return request(app.getHttpServer())
      .get(`/v1/saju-profiles/${id}`)
      .auth(subject, { type: 'bearer' });
  }
  function remove(id: string, subject = owner.authSubject) {
    return request(app.getHttpServer())
      .delete(`/v1/saju-profiles/${id}`)
      .auth(subject, { type: 'bearer' });
  }

  it('atomically stores the corrected chart and reads the same JSON without recalculation', async () => {
    const data = await saved();
    expect(data.profile).toMatchObject({
      isPrimary: true,
      currentChartId: data.chart.id,
      birth: INPUT.birth,
    });
    expect(data.chart.snapshot.pillars.hour?.hanja).toBe('己卯');
    expect(data.chart.snapshot.normalizedBirth.timeCorrection).toMatchObject({
      adjustmentMinutes: -30,
      correctedTime: { hour: 6, minute: 50 },
    });
    const stored = await prisma.sajuChart.findUniqueOrThrow({
      where: { id: data.chart.id },
    });
    expect(stored.payload).toEqual(data.chart.snapshot);
    expect(stored.policyVersion).toBe(SAJU_POLICY_VERSION);
    const calculate = vi.spyOn(app.get(SajuChartCalculator), 'calculate');
    const response = await get(data.profile.id).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(GetSajuProfileResponseSchema.parse(response.body).data).toEqual(
      data,
    );
    expect(calculate).not.toHaveBeenCalled();
  });

  it('lists only owned summaries, without snapshot payloads', async () => {
    const data = await saved();
    await create(INPUT, randomUUID(), other.authSubject).expect(201);
    const response = await request(app.getHttpServer())
      .get('/v1/saju-profiles')
      .auth(owner.authSubject, { type: 'bearer' })
      .expect(200);
    expect(
      GetSajuProfilesResponseSchema.parse(response.body).data.profiles,
    ).toEqual([data.profile]);
  });

  it('keeps the immutable chart when changing name and relation only', async () => {
    const data = await saved();
    const calculate = vi.spyOn(app.get(SajuChartCalculator), 'calculate');
    const response = await patch(data.profile.id, {
      displayName: '수정 이름',
      relationType: 'family',
    }).expect(200);
    const updated = UpdateSajuProfileResponseSchema.parse(response.body).data;
    expect(updated.profile).toMatchObject({
      displayName: '수정 이름',
      relationType: 'family',
    });
    expect(updated.chart).toEqual(data.chart);
    expect(calculate).not.toHaveBeenCalled();
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(1);
  });

  it('creates an immutable snapshot on birth change and reuses it on reversion', async () => {
    const initial = await saved();
    const birth = {
      ...INPUT.birth,
      time: { precision: 'exact', hour: 9, minute: 20 },
    };
    const response = await patch(initial.profile.id, { birth }).expect(200);
    const next = UpdateSajuProfileResponseSchema.parse(response.body).data;
    expect(next.chart?.id).not.toBe(initial.chart.id);
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(2);
    expect(
      (
        await prisma.sajuChart.findUniqueOrThrow({
          where: { id: initial.chart.id },
        })
      ).payload,
    ).toEqual(initial.chart.snapshot);
    const reverted = UpdateSajuProfileResponseSchema.parse(
      (await patch(initial.profile.id, { birth: INPUT.birth }).expect(200))
        .body,
    ).data;
    expect(reverted.chart).toEqual(initial.chart);
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(2);
  });

  it('does not recalculate or change timestamps for an unchanged update', async () => {
    const data = await saved();
    const calculate = vi.spyOn(app.get(SajuChartCalculator), 'calculate');
    const response = await patch(data.profile.id, INPUT).expect(200);
    expect(UpdateSajuProfileResponseSchema.parse(response.body).data).toEqual(
      data,
    );
    expect(calculate).not.toHaveBeenCalled();
  });

  it('retains a legacy snapshot on GET/name edit, then upgrades on explicit birth submission', async () => {
    const data = await saved();
    const legacy = structuredClone(data.chart.snapshot);
    legacy.calculation.policyVersion = 'kr-kst-midnight-v1';
    delete legacy.normalizedBirth.timeCorrection;
    delete legacy.calculation.timeZoneDatabaseVersion;
    await prisma.sajuChart.update({
      where: { id: data.chart.id },
      data: {
        payload: legacy,
        policyVersion: 'kr-kst-midnight-v1',
        inputHash: 'e'.repeat(64),
      },
    });
    expect(
      GetSajuProfileResponseSchema.parse(
        (await get(data.profile.id).expect(200)).body,
      ).data.chart?.snapshot,
    ).toEqual(legacy);
    await patch(data.profile.id, { displayName: '이름만 수정' }).expect(200);
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(1);
    const upgraded = UpdateSajuProfileResponseSchema.parse(
      (await patch(data.profile.id, { birth: INPUT.birth }).expect(200)).body,
    ).data;
    expect(upgraded.chart?.snapshot.calculation.policyVersion).toBe(
      SAJU_POLICY_VERSION,
    );
    expect(upgraded.chart?.id).not.toBe(data.chart.id);
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(2);
  });

  it('persists unknown time and transitions between six and eight symbols', async () => {
    const input: CreateSajuProfileRequest = {
      ...INPUT,
      birth: { ...INPUT.birth, time: { precision: 'unknown' } },
    };
    const data = await saved(input);
    expect(data.chart.snapshot).toMatchObject({
      quality: 'partial',
      pillars: { hour: null },
      elementDistribution: { totalSymbols: 6 },
      luckCycle: null,
    });
    expect(
      await prisma.sajuProfile.findUnique({
        where: { id: data.profile.id },
        select: { birthHour: true, birthMinute: true },
      }),
    ).toEqual({ birthHour: null, birthMinute: null });
    const exact = UpdateSajuProfileResponseSchema.parse(
      (await patch(data.profile.id, { birth: INPUT.birth }).expect(200)).body,
    ).data;
    expect(exact.chart?.snapshot.elementDistribution.totalSymbols).toBe(8);
    const unknown = UpdateSajuProfileResponseSchema.parse(
      (await patch(data.profile.id, { birth: input.birth }).expect(200)).body,
    ).data;
    expect(unknown.chart).toEqual(data.chart);
  });

  it('replays concurrent identical requests once and scopes the key by owner', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      create(INPUT, key).expect(201),
      create(INPUT, key).expect(201),
    ]);
    const first = CreateSajuProfileResponseSchema.parse(
      responses[0]?.body,
    ).data;
    expect(
      CreateSajuProfileResponseSchema.parse(responses[1]?.body).data,
    ).toEqual(first);
    expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(1);
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(1);
    expect(
      await prisma.sajuProfileCreation.count({ where: ownerFilter() }),
    ).toBe(1);
    await create(INPUT, key, other.authSubject).expect(201);
    expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(2);
  });

  it('returns the existing current resource on retry without restoring earlier edits', async () => {
    const key = randomUUID();
    const data = await saved(INPUT, key);
    await patch(data.profile.id, { displayName: '새 표시 이름' }).expect(200);
    const calculate = vi.spyOn(app.get(SajuChartCalculator), 'calculate');
    const replay = await saved(INPUT, key.toUpperCase());
    expect(replay.profile).toMatchObject({
      id: data.profile.id,
      displayName: '새 표시 이름',
    });
    expect(calculate).not.toHaveBeenCalled();
    const response = await create(
      { ...INPUT, displayName: '다른 요청' },
      key,
    ).expect(409);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('does not recreate a deleted profile when retrying its original creation key', async () => {
    const key = randomUUID();
    const data = await saved(INPUT, key);
    await remove(data.profile.id).expect(200);
    const response = await create(INPUT, key).expect(409);
    expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
      'SAJU_PROFILE_CREATION_DELETED',
    );
    expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(0);
    expect(
      await prisma.sajuProfileCreation.findFirst({
        where: ownerFilter(),
        select: { profileId: true },
      }),
    ).toEqual({ profileId: null });
  });

  it('allows distinct profiles with identical births and supports older clients without a key', async () => {
    await saved();
    await request(app.getHttpServer())
      .post('/v1/saju-profiles')
      .auth(owner.authSubject, { type: 'bearer' })
      .send(INPUT)
      .expect(201);
    expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(2);
  });

  it('hard deletes all chart history, assigns a replacement, and clears the last primary', async () => {
    const first = await saved();
    const second = await saved({ ...INPUT, displayName: '두 번째' });
    await patch(first.profile.id, {
      birth: { ...INPUT.birth, time: { precision: 'unknown' } },
    }).expect(200);
    const response = await remove(first.profile.id).expect(200);
    expect(
      DeleteSajuProfileResponseSchema.parse(response.body).data
        .primarySajuProfileId,
    ).toBe(second.profile.id);
    expect(
      await prisma.sajuChart.count({ where: { profileId: first.profile.id } }),
    ).toBe(0);
    await get(first.profile.id).expect(404);
    await patch(first.profile.id, { displayName: '삭제 후' }).expect(404);
    await remove(first.profile.id).expect(404);
    await remove(second.profile.id).expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .primarySajuProfileId,
    ).toBeNull();
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(0);
  });

  it('preserves primary ownership through concurrent creates and deletes', async () => {
    const responses = await Promise.all([
      create().expect(201),
      create().expect(201),
      create().expect(201),
    ]);
    const profiles = responses.map(
      (response) =>
        CreateSajuProfileResponseSchema.parse(response.body).data.profile,
    );
    const primary = profiles.find((profile) => profile.isPrimary);
    const others = profiles.filter((profile) => !profile.isPrimary);
    expect(profiles.filter((profile) => profile.isPrimary)).toHaveLength(1);
    if (!primary || !others[0] || !others[1])
      throw new Error('Missing test profiles');
    await Promise.all([
      remove(primary.id).expect(200),
      remove(others[0].id).expect(200),
    ]);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
        .primarySajuProfileId,
    ).toBe(others[1].id);
  });

  it('serializes concurrent birth edits without mismatching profile and current chart', async () => {
    const data = await saved();
    await Promise.all(
      [9, 11].map((hour) =>
        patch(data.profile.id, {
          birth: {
            ...INPUT.birth,
            time: { precision: 'exact', hour, minute: 20 },
          },
        }).expect(200),
      ),
    );
    const current = GetSajuProfileResponseSchema.parse(
      (await get(data.profile.id).expect(200)).body,
    ).data;
    expect(current.profile.birth.time).toEqual(
      current.chart?.snapshot.normalizedBirth.time,
    );
    expect(
      await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
    ).toBe(3);
  });

  it('rejects another owner for read, update and delete without revealing existence', async () => {
    const data = await saved();
    for (const response of [
      await get(data.profile.id, other.authSubject).expect(404),
      await patch(
        data.profile.id,
        { displayName: '침범' },
        other.authSubject,
      ).expect(404),
      await remove(data.profile.id, other.authSubject).expect(404),
    ]) {
      expect(ApiErrorResponseSchema.parse(response.body).data?.reason).toBe(
        'SAJU_PROFILE_NOT_FOUND',
      );
    }
    expect(
      (await get(data.profile.id).expect(200)).headers['cache-control'],
    ).toBe('no-store');
  });

  it.each([
    UserStatus.PENDING_REGISTRATION,
    UserStatus.SUSPENDED,
    UserStatus.WITHDRAWN,
  ])('rejects writes for %s users', async (status) => {
    const data = await saved();
    await prisma.user.update({ where: { id: owner.id }, data: { status } });
    await create().expect(403);
    await patch(data.profile.id, { displayName: '제한' }).expect(403);
    await remove(data.profile.id).expect(403);
    expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(1);
  });

  it('validates auth, IDs, keys, strict request bodies, and invalid calculations before storing', async () => {
    await request(app.getHttpServer())
      .post('/v1/saju-profiles')
      .send(INPUT)
      .expect(401);
    await create(INPUT, 'bad-key').expect(400);
    await get('bad-id').expect(400);
    await request(app.getHttpServer())
      .post('/v1/saju-profiles')
      .auth(owner.authSubject, { type: 'bearer' })
      .send({ ...INPUT, chart: {} })
      .expect(400);
    await create({
      ...INPUT,
      birth: {
        ...INPUT.birth,
        calendarType: 'solar',
        date: { year: 2000, month: 2, day: 30 },
      },
    }).expect(400);
    expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(0);
    expect(
      await prisma.sajuProfileCreation.count({ where: ownerFilter() }),
    ).toBe(0);
  });

  it('rolls back profile, chart, primary assignment and key if the final DB write fails', async () => {
    failCreationOwnerId = owner.id;
    const errorLog = vi.spyOn(Logger.prototype, 'error');
    const key = randomUUID();
    try {
      const response = await create(INPUT, key).expect(500);
      expect(ApiErrorResponseSchema.parse(response.body).data).toBeNull();
      expect(errorLog).toHaveBeenCalled();
      const loggedText = JSON.stringify(errorLog.mock.calls);
      expect(loggedText).not.toContain('injected test failure');
      expect(loggedText).not.toContain(INPUT.displayName);
      expect(loggedText).toContain('requestId=');
      expect(await prisma.sajuProfile.count({ where: ownerFilter() })).toBe(0);
      expect(
        await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
      ).toBe(0);
      expect(
        await prisma.sajuProfileCreation.count({ where: ownerFilter() }),
      ).toBe(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .primarySajuProfileId,
      ).toBeNull();
    } finally {
      failCreationOwnerId = null;
    }
    await saved(INPUT, key);
  });

  it('rolls back a new chart if updating its profile fails', async () => {
    const data = await saved();
    failUpdateProfileId = data.profile.id;
    try {
      await patch(data.profile.id, {
        birth: { ...INPUT.birth, time: { precision: 'unknown' } },
      }).expect(500);
      expect(
        await prisma.sajuChart.count({ where: { profile: ownerFilter() } }),
      ).toBe(1);
      expect(
        GetSajuProfileResponseSchema.parse(
          (await get(data.profile.id).expect(200)).body,
        ).data,
      ).toEqual(data);
    } finally {
      failUpdateProfileId = null;
    }
  });

  it('enforces exact time NOT NULL and unknown time NULL in PostgreSQL itself', async () => {
    const data = await saved();
    for (const column of ['birth_hour', 'birth_minute']) {
      await expect(
        sql.query(`UPDATE saju_profiles SET ${column} = NULL WHERE id = $1`, [
          data.profile.id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
    }
    await expect(
      sql.query(
        "UPDATE saju_profiles SET birth_time_precision = 'unknown' WHERE id = $1",
        [data.profile.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    SajuChartSnapshotV1Schema.parse(
      (
        await prisma.sajuChart.findUniqueOrThrow({
          where: { id: data.chart.id },
        })
      ).payload,
    );
  });

  it('loads only active owned chart batches for readings using PostgreSQL relations', async () => {
    const first = await saved();
    const second = await saved({ ...INPUT, displayName: '두 번째 참여자', relationType: 'friend' });
    const service = app.get(SajuProfilesService);
    const chartIds = [first.chart.id, second.chart.id];
    const batch = await service.getOwnedReadingCharts(owner.authSubject, chartIds);
    expect(new Set(batch.map((entry) => entry.chartId))).toEqual(new Set(chartIds));
    expect(batch.find((entry) => entry.chartId === first.chart.id)?.snapshot).toEqual(first.chart.snapshot);
    await expect(service.getOwnedReadingCharts(other.authSubject, chartIds)).rejects.toMatchObject({ status: 404 });
    await remove(second.profile.id).expect(200);
    await expect(service.getOwnedReadingCharts(owner.authSubject, chartIds)).rejects.toMatchObject({ status: 404 });
    await prisma.user.update({ where: { id: owner.id }, data: { status: UserStatus.WITHDRAWN } });
    await expect(service.getOwnedReadingCharts(owner.authSubject, [first.chart.id])).rejects.toMatchObject({ status: 403 });
  });

  it('reproduces RLS and denies direct client-role access on all three storage tables', async () => {
    const result = await sql.query<{ table: string; enabled: boolean }>(
      'SELECT relname AS table, relrowsecurity AS enabled FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname = ANY($1)',
      [['saju_profiles', 'saju_charts', 'saju_profile_creations']],
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((row) => row.enabled)).toBe(true);
    const roles = await sql.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
    );
    for (const role of roles.rows) {
      for (const table of result.rows) {
        const access = await sql.query<{ allowed: boolean }>(
          "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') AS allowed",
          [role.rolname, table.table],
        );
        expect(access.rows[0]?.allowed).toBe(false);
      }
    }
  });
});
