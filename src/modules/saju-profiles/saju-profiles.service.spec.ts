import { PrismaService } from '../../database/prisma.service.js';
import {
  BirthTimePrecision,
  LuckCycleGender,
  SajuCalendarType,
  SajuRelationType,
  UserStatus,
} from '../../generated/prisma/client.js';
import type { SajuChartSnapshotV1 } from './saju-profile.contract.js';
import { SajuChartCalculator } from './saju-chart-calculator.js';
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

describe('SajuProfilesService', () => {
  it('creates a profile and immutable chart in one transaction', async () => {
    const snapshot = createSnapshot();
    const inputHash = 'a'.repeat(64);
    const chartRecord = {
      id: CHART_ID,
      profileId: PROFILE_ID,
      schemaVersion: 1,
      engineName: 'manseryeok',
      engineVersion: '2.0.0',
      policyVersion: 'kr-kst-midnight-v1',
      inputHash,
      payload: snapshot,
      calculatedAt: CREATED_AT,
    };
    const createProfile = vi
      .fn()
      .mockResolvedValue({ ...profileRecord, currentChartId: null });
    const createChart = vi.fn().mockResolvedValue(chartRecord);
    const updateProfile = vi.fn().mockResolvedValue(profileRecord);
    const assignPrimary = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      sajuProfile: { create: createProfile, update: updateProfile },
      sajuChart: { create: createChart },
      user: { updateMany: assignPrimary },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: null,
        }),
      },
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const calculator = {
      calculate: vi.fn().mockReturnValue({ inputHash, snapshot }),
    } as unknown as SajuChartCalculator;
    const service = new SajuProfilesService(prisma, calculator);

    const result = await service.create(AUTH_SUBJECT, REQUEST);

    expect(result.profile).toMatchObject({
      id: PROFILE_ID,
      displayName: '제임스',
      relationType: 'self',
      isPrimary: true,
      currentChartId: CHART_ID,
      birth: REQUEST.birth,
    });
    expect(result.chart).toEqual({
      id: CHART_ID,
      profileId: PROFILE_ID,
      snapshot,
    });
    expect(createProfile).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerUserId: USER_ID,
        displayName: '제임스',
        birthYear: 1992,
        birthHour: 5,
      }),
      select: expect.any(Object),
    });
    expect(createChart).toHaveBeenCalledWith({
      data: expect.objectContaining({
        profileId: PROFILE_ID,
        inputHash,
        payload: snapshot,
      }),
      select: expect.any(Object),
    });
    expect(updateProfile).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: { currentChartId: CHART_ID },
      select: expect.any(Object),
    });
    expect(assignPrimary).toHaveBeenCalledWith({
      where: { id: USER_ID, primarySajuProfileId: null },
      data: { primarySajuProfileId: PROFILE_ID },
    });
  });

  it('only lists non-deleted profiles owned by the authenticated user', async () => {
    const findMany = vi.fn().mockResolvedValue([profileRecord]);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: PROFILE_ID,
        }),
      },
      sajuProfile: { findMany },
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, new SajuChartCalculator());

    await expect(service.findAll(AUTH_SUBJECT)).resolves.toMatchObject({
      profiles: [{ id: PROFILE_ID, isPrimary: true }],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: USER_ID, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: expect.any(Object),
    });
  });

  it('does not reveal whether another user owns a requested profile', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: null,
        }),
      },
      sajuProfile: { findFirst },
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, new SajuChartCalculator());

    await expect(
      service.findOne(AUTH_SUBJECT, PROFILE_ID),
    ).rejects.toMatchObject({
      status: 404,
      response: { reason: 'SAJU_PROFILE_NOT_FOUND' },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: PROFILE_ID, ownerUserId: USER_ID, deletedAt: null },
      select: expect.objectContaining({
        currentChart: { select: expect.any(Object) },
      }),
    });
  });

  it('updates display information without recalculating the chart', async () => {
    const snapshot = createSnapshot();
    const currentChart = {
      id: CHART_ID,
      profileId: PROFILE_ID,
      payload: snapshot,
    };
    const findFirst = vi.fn().mockResolvedValue({
      ...profileRecord,
      currentChart,
    });
    const updateProfile = vi.fn().mockResolvedValue({
      ...profileRecord,
      displayName: '제임스 수정',
      relationType: SajuRelationType.FAMILY,
    });
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: PROFILE_ID,
        }),
      },
      sajuProfile: { findFirst, update: updateProfile },
    } as unknown as PrismaService;
    const calculate = vi.fn();
    const calculator = { calculate } as unknown as SajuChartCalculator;
    const service = new SajuProfilesService(prisma, calculator);

    const result = await service.update(AUTH_SUBJECT, PROFILE_ID, {
      displayName: '제임스 수정',
      relationType: 'family',
    });

    expect(result).toMatchObject({
      profile: {
        displayName: '제임스 수정',
        isPrimary: true,
      },
      chart: { id: CHART_ID },
    });
    expect(calculate).not.toHaveBeenCalled();
    expect(updateProfile).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: {
        displayName: '제임스 수정',
        relationType: SajuRelationType.FAMILY,
      },
      select: expect.any(Object),
    });
  });

  it('creates and activates an immutable chart when birth input changes', async () => {
    const nextBirth = {
      ...REQUEST.birth,
      date: { ...REQUEST.birth.date, day: 25 },
    };
    const snapshot = new SajuChartCalculator().calculate(
      nextBirth,
      UPDATED_AT,
    ).snapshot;
    const inputHash = 'b'.repeat(64);
    const nextChartId = 'c0cc4dca-b145-45e1-8935-0df724066ecf';
    const currentChart = {
      id: CHART_ID,
      profileId: PROFILE_ID,
      payload: createSnapshot(),
    };
    const nextChart = {
      id: nextChartId,
      profileId: PROFILE_ID,
      payload: snapshot,
    };
    const upsertChart = vi.fn().mockResolvedValue(nextChart);
    const updateProfile = vi.fn().mockResolvedValue({
      ...profileRecord,
      birthDay: 25,
      currentChartId: nextChartId,
    });
    const transactionClient = {
      sajuChart: { upsert: upsertChart },
      sajuProfile: { update: updateProfile },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: PROFILE_ID,
        }),
      },
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue({
          ...profileRecord,
          currentChart,
        }),
      },
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const calculator = {
      calculate: vi.fn().mockReturnValue({ inputHash, snapshot }),
    } as unknown as SajuChartCalculator;
    const service = new SajuProfilesService(prisma, calculator);

    const result = await service.update(AUTH_SUBJECT, PROFILE_ID, {
      birth: nextBirth,
    });

    expect(result).toMatchObject({
      profile: {
        birth: { date: { day: 25 } },
        currentChartId: nextChartId,
      },
      chart: { id: nextChartId },
    });
    expect(upsertChart).toHaveBeenCalledWith({
      where: {
        profileId_inputHash: { profileId: PROFILE_ID, inputHash },
      },
      update: {},
      create: expect.objectContaining({
        profileId: PROFILE_ID,
        inputHash,
        payload: snapshot,
      }),
      select: expect.any(Object),
    });
    expect(updateProfile).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: expect.objectContaining({
        birthDay: 25,
        currentChartId: nextChartId,
      }),
      select: expect.any(Object),
    });
  });

  it('does not write or recalculate when submitted values are unchanged', async () => {
    const updateProfile = vi.fn();
    const calculate = vi.fn();
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: PROFILE_ID,
        }),
      },
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue({
          ...profileRecord,
          currentChart: {
            id: CHART_ID,
            profileId: PROFILE_ID,
            payload: createSnapshot(),
          },
        }),
        update: updateProfile,
      },
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, {
      calculate,
    } as unknown as SajuChartCalculator);

    await expect(
      service.update(AUTH_SUBJECT, PROFILE_ID, REQUEST),
    ).resolves.toMatchObject({
      profile: { id: PROFILE_ID },
      chart: { id: CHART_ID },
    });
    expect(updateProfile).not.toHaveBeenCalled();
    expect(calculate).not.toHaveBeenCalled();
  });

  it('hard deletes a primary profile and assigns the oldest remaining profile', async () => {
    const replacementProfileId = 'e9d83fc8-9886-47ca-b00d-d735b75044f4';
    const detachCurrentChart = vi.fn().mockResolvedValue({ id: PROFILE_ID });
    const deleteProfile = vi.fn().mockResolvedValue({ id: PROFILE_ID });
    const updateUser = vi.fn().mockResolvedValue({ id: USER_ID });
    const transactionClient = {
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: replacementProfileId }),
        update: detachCurrentChart,
        delete: deleteProfile,
      },
      user: { update: updateUser },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: PROFILE_ID,
        }),
      },
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue({
          ...profileRecord,
          currentChart: {
            id: CHART_ID,
            profileId: PROFILE_ID,
            payload: createSnapshot(),
          },
        }),
      },
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, new SajuChartCalculator());

    await expect(service.remove(AUTH_SUBJECT, PROFILE_ID)).resolves.toEqual({
      deletedProfileId: PROFILE_ID,
      primarySajuProfileId: replacementProfileId,
    });
    expect(transactionClient.sajuProfile.findFirst).toHaveBeenCalledWith({
      where: {
        ownerUserId: USER_ID,
        id: { not: PROFILE_ID },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { primarySajuProfileId: replacementProfileId },
      select: { id: true },
    });
    expect(detachCurrentChart).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      data: { currentChartId: null },
      select: { id: true },
    });
    expect(deleteProfile).toHaveBeenCalledWith({
      where: { id: PROFILE_ID },
      select: { id: true },
    });
  });

  it('clears the primary profile when deleting the last profile', async () => {
    const updateUser = vi.fn().mockResolvedValue({ id: USER_ID });
    const transactionClient = {
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ id: PROFILE_ID }),
        delete: vi.fn().mockResolvedValue({ id: PROFILE_ID }),
      },
      user: { update: updateUser },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: PROFILE_ID,
        }),
      },
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue({
          ...profileRecord,
          currentChart: null,
        }),
      },
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, new SajuChartCalculator());

    await expect(service.remove(AUTH_SUBJECT, PROFILE_ID)).resolves.toEqual({
      deletedProfileId: PROFILE_ID,
      primarySajuProfileId: null,
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { primarySajuProfileId: null },
      select: { id: true },
    });
  });

  it('does not change the primary profile when deleting a non-primary profile', async () => {
    const primaryProfileId = 'e9d83fc8-9886-47ca-b00d-d735b75044f4';
    const updateUser = vi.fn();
    const transactionClient = {
      sajuProfile: {
        findFirst: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: PROFILE_ID }),
        delete: vi.fn().mockResolvedValue({ id: PROFILE_ID }),
      },
      user: { update: updateUser },
    };
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: USER_ID,
          status: UserStatus.ACTIVE,
          primarySajuProfileId: primaryProfileId,
        }),
      },
      sajuProfile: {
        findFirst: vi.fn().mockResolvedValue({
          ...profileRecord,
          currentChart: null,
        }),
      },
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, new SajuChartCalculator());

    await expect(service.remove(AUTH_SUBJECT, PROFILE_ID)).resolves.toEqual({
      deletedProfileId: PROFILE_ID,
      primarySajuProfileId: primaryProfileId,
    });
    expect(transactionClient.sajuProfile.findFirst).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'USER_REGISTRATION_REQUIRED'],
    [UserStatus.PENDING_REGISTRATION, 'USER_REGISTRATION_REQUIRED'],
    [UserStatus.SUSPENDED, 'USER_ACCESS_DENIED'],
    [UserStatus.WITHDRAWN, 'USER_ACCESS_DENIED'],
  ])('blocks profile access for user status %s', async (status, reason) => {
    const findMany = vi.fn();
    const prisma = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            status ? { id: USER_ID, status, primarySajuProfileId: null } : null,
          ),
      },
      sajuProfile: { findMany },
    } as unknown as PrismaService;
    const service = new SajuProfilesService(prisma, new SajuChartCalculator());

    await expect(service.findAll(AUTH_SUBJECT)).rejects.toMatchObject({
      status: 403,
      response: { reason },
    });
    expect(findMany).not.toHaveBeenCalled();
  });
});
