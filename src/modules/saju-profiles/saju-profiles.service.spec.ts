import { PrismaService } from '../../database/prisma.service.js';
import {
  BirthTimePrecision,
  LuckCycleGender,
  SajuCalendarType,
  SajuRelationType,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { SajuChartSnapshotV1 } from './saju-profile.contract.js';
import {
  SAJU_POLICY_VERSION,
  SajuChartCalculator,
} from './saju-chart-calculator.js';
import { SajuProfilesService } from './saju-profiles.service.js';

const AUTH_SUBJECT = 'd952b765-7b9a-44fc-9d94-632036ac0934';
const USER_ID = '53195553-c632-4f09-8c0e-9f5a1cdaf876';
const PROFILE_ID = '827b4a76-b8c5-462f-afd4-af6415ca9f71';
const CHART_ID = '067410a4-7bed-4901-ab62-faf700827f4a';
const CREATED_AT = new Date('2026-09-09T01:00:00.000Z');
const UPDATED_AT = new Date('2026-09-09T01:01:00.000Z');
const REQUEST = {
  displayName: '제임스',
  relationType: 'self',
  birth: {
    calendarType: 'solar',
    isLeapMonth: false,
    date: { year: 1992, month: 10, day: 24 },
    time: { precision: 'exact', hour: 5, minute: 30 },
    luckCycleGender: 'male',
  },
} as const;

const profileRecord = {
  id: PROFILE_ID,
  ownerUserId: USER_ID,
  displayName: REQUEST.displayName,
  relationType: SajuRelationType.SELF,
  calendarType: SajuCalendarType.SOLAR,
  birthYear: 1992,
  birthMonth: 10,
  birthDay: 24,
  isLeapMonth: false,
  birthTimePrecision: BirthTimePrecision.EXACT,
  birthHour: 5,
  birthMinute: 30,
  luckCycleGender: LuckCycleGender.MALE,
  timezone: 'Asia/Seoul',
  currentChartId: CHART_ID,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  deletedAt: null,
};

function createSnapshot(): SajuChartSnapshotV1 {
  return new SajuChartCalculator().calculate(REQUEST.birth, CREATED_AT)
    .snapshot;
}

function createLegacySnapshot(): SajuChartSnapshotV1 {
  const snapshot = createSnapshot();
  snapshot.calculation.policyVersion = 'kr-kst-midnight-v1';
  delete snapshot.calculation.timeZoneDatabaseVersion;
  delete snapshot.normalizedBirth.timeCorrection;
  return snapshot;
}

function fixture(
  snapshot = createSnapshot(),
  primaryId: string | null = PROFILE_ID,
) {
  const chart = { id: CHART_ID, profileId: PROFILE_ID, payload: snapshot };
  const profile = { ...profileRecord, currentChart: chart };
  const database = {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: primaryId,
        }),
      update: vi.fn().mockResolvedValue({ id: USER_ID }),
      updateMany: vi.fn().mockResolvedValue({ count: primaryId ? 0 : 1 }),
    },
    sajuProfile: {
      create: vi.fn().mockResolvedValue(profileRecord),
      findFirst: vi.fn().mockResolvedValue(profile),
      findMany: vi.fn().mockResolvedValue([profile]),
      update: vi.fn().mockResolvedValue(profileRecord),
      delete: vi.fn().mockResolvedValue({ id: PROFILE_ID }),
    },
    sajuChart: {
      create: vi.fn().mockResolvedValue(chart),
      upsert: vi.fn().mockResolvedValue(chart),
    },
    readingJob: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    sajuProfileCreation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: USER_ID }]),
  };
  const prisma = {
    ...database,
    $transaction: vi.fn(
      async (work: (client: typeof database) => Promise<unknown>) =>
        work(database),
    ),
  };
  const calculator = new SajuChartCalculator();
  const calculate = vi.spyOn(calculator, 'calculate');
  const service = new SajuProfilesService(
    prisma as unknown as PrismaService,
    calculator,
  );
  return { database, service, calculate, chart, profile, prisma };
}

describe('SajuProfilesService', () => {
  it('maps stored profiles and snapshots without calculation', async () => {
    const { service, chart, calculate } = fixture();
    const result = await service.findOne(AUTH_SUBJECT, PROFILE_ID);
    expect(result.profile).toMatchObject({
      birth: REQUEST.birth,
      relationType: 'self',
      isPrimary: true,
    });
    expect(result.chart).toEqual({
      id: CHART_ID,
      profileId: PROFILE_ID,
      snapshot: chart.payload,
    });
    expect(calculate).not.toHaveBeenCalled();
  });

  it('lists only owned profiles with deterministic ordering', async () => {
    const { service, database } = fixture();
    await service.findAll(AUTH_SUBJECT);
    expect(database.sajuProfile.findMany).toHaveBeenCalledWith({
      where: { ownerUserId: USER_ID, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: expect.any(Object),
    });
  });

  it('does not reveal another owner profile', async () => {
    const { service, database } = fixture();
    database.sajuProfile.findFirst.mockResolvedValue(null);
    await expect(
      service.findOne(AUTH_SUBJECT, PROFILE_ID),
    ).rejects.toMatchObject({
      status: 404,
      response: { reason: 'SAJU_PROFILE_NOT_FOUND' },
    });
  });

  it('creates a profile, chart and request record inside the owner transaction', async () => {
    const { service, database, prisma } = fixture(createSnapshot(), null);
    const result = await service.create(AUTH_SUBJECT, REQUEST, PROFILE_ID);
    expect(result.profile.isPrimary).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(database.$queryRaw).toHaveBeenCalledOnce();
    expect(database.sajuProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ownerUserId: USER_ID, birthHour: 5 }),
      select: expect.any(Object),
    });
    expect(database.sajuChart.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId: PROFILE_ID,
        policyVersion: SAJU_POLICY_VERSION,
      }),
      select: expect.any(Object),
    });
    expect(database.sajuProfileCreation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestKey: PROFILE_ID,
        ownerUserId: USER_ID,
        profileId: PROFILE_ID,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: expect.any(Object),
    });
  });

  it('keeps an old policy chart on name/relation-only edit', async () => {
    const { service, database, chart, calculate } = fixture(
      createLegacySnapshot(),
    );
    database.sajuProfile.update.mockResolvedValue({
      ...profileRecord,
      displayName: '수정',
      relationType: SajuRelationType.FAMILY,
    });
    const result = await service.update(AUTH_SUBJECT, PROFILE_ID, {
      displayName: '수정',
      relationType: 'family',
    });
    expect(result.profile.displayName).toBe('수정');
    expect(result.chart?.snapshot).toEqual(chart.payload);
    expect(calculate).not.toHaveBeenCalled();
  });

  it.each([
    { day: 25, legacy: false },
    { day: 24, legacy: true },
  ])(
    'activates a chart for day $day, old policy $legacy',
    async ({ day, legacy }) => {
      const { service, database, calculate } = fixture(
        legacy ? createLegacySnapshot() : createSnapshot(),
      );
      const birth = { ...REQUEST.birth, date: { ...REQUEST.birth.date, day } };
      await service.update(AUTH_SUBJECT, PROFILE_ID, { birth });
      expect(calculate).toHaveBeenCalledWith(birth, expect.any(Date));
      expect(database.sajuChart.upsert).toHaveBeenCalledWith({
        where: expect.any(Object),
        update: {},
        create: expect.objectContaining({
          profileId: PROFILE_ID,
          policyVersion: SAJU_POLICY_VERSION,
        }),
        select: expect.any(Object),
      });
    },
  );

  it('does not calculate or write unchanged input', async () => {
    const { service, database, calculate } = fixture();
    await service.update(AUTH_SUBJECT, PROFILE_ID, REQUEST);
    expect(calculate).not.toHaveBeenCalled();
    expect(database.sajuProfile.update).not.toHaveBeenCalled();
  });

  it('deletes the chart history through profile cascade and assigns the oldest remaining profile', async () => {
    const { service, database, profile } = fixture();
    const replacement = 'e9d83fc8-9886-47ca-b00d-d735b75044f4';
    database.sajuProfile.findFirst
      .mockResolvedValueOnce(profile)
      .mockResolvedValueOnce({ id: replacement });
    await expect(service.remove(AUTH_SUBJECT, PROFILE_ID)).resolves.toEqual({
      deletedProfileId: PROFILE_ID,
      primarySajuProfileId: replacement,
    });
    expect(database.sajuProfile.delete).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      select: { id: true },
    });
    expect(database.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { primarySajuProfileId: replacement },
      select: { id: true },
    });
  });

  it('clears the primary when deleting the final profile', async () => {
    const { service, database, profile } = fixture();
    database.sajuProfile.findFirst
      .mockResolvedValueOnce(profile)
      .mockResolvedValueOnce(null);
    expect(
      (await service.remove(AUTH_SUBJECT, PROFILE_ID)).primarySajuProfileId,
    ).toBeNull();
  });

  it('does not replace primary when deleting a different profile', async () => {
    const primary = 'e9d83fc8-9886-47ca-b00d-d735b75044f4';
    const { service, database } = fixture(createSnapshot(), primary);
    expect(
      (await service.remove(AUTH_SUBJECT, PROFILE_ID)).primarySajuProfileId,
    ).toBe(primary);
    expect(database.user.update).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'USER_REGISTRATION_REQUIRED'],
    [UserStatus.PENDING_REGISTRATION, 'USER_REGISTRATION_REQUIRED'],
    [UserStatus.SUSPENDED, 'USER_ACCESS_DENIED'],
    [UserStatus.WITHDRAWN, 'USER_ACCESS_DENIED'],
  ])('blocks profile access for status %s', async (status, reason) => {
    const { service, database } = fixture();
    database.user.findUnique.mockResolvedValue(
      status ? { id: USER_ID, status, primarySajuProfileId: null } : null,
    );
    await expect(service.findAll(AUTH_SUBJECT)).rejects.toMatchObject({
      status: 403,
      response: { reason },
    });
    expect(database.sajuProfile.findMany).not.toHaveBeenCalled();
  });
});
