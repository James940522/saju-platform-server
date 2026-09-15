import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  BirthTimePrecision as PrismaBirthTimePrecision,
  LuckCycleGender as PrismaLuckCycleGender,
  Prisma,
  SajuCalendarType as PrismaSajuCalendarType,
  SajuRelationType as PrismaSajuRelationType,
  UserStatus as PrismaUserStatus,
} from '../../generated/prisma/client.js';
import {
  SAJU_CHART_SCHEMA_VERSION,
  SAJU_ENGINE_NAME,
  SAJU_ENGINE_VERSION,
  SAJU_POLICY_VERSION,
  SAJU_TIMEZONE,
  SajuChartCalculator,
} from './saju-chart-calculator.js';
import {
  SajuChartSnapshotV1Schema,
  type BirthInput,
  type CreateSajuProfileData,
  type CreateSajuProfileRequest,
  type DeleteSajuProfileData,
  type GetSajuProfileData,
  type GetSajuProfilesData,
  type SajuChart,
  type SajuProfile,
  type UpdateSajuProfileData,
  type UpdateSajuProfileRequest,
} from './saju-profile.contract.js';
import { KOREAN_TIME_DATA_VERSION } from './korean-birth-time.js';

const RELATION_TYPE_TO_PRISMA: Record<
  CreateSajuProfileRequest['relationType'],
  PrismaSajuRelationType
> = {
  self: PrismaSajuRelationType.SELF,
  family: PrismaSajuRelationType.FAMILY,
  friend: PrismaSajuRelationType.FRIEND,
  partner: PrismaSajuRelationType.PARTNER,
  other: PrismaSajuRelationType.OTHER,
};

const RELATION_TYPE_FROM_PRISMA: Record<
  PrismaSajuRelationType,
  SajuProfile['relationType']
> = {
  [PrismaSajuRelationType.SELF]: 'self',
  [PrismaSajuRelationType.FAMILY]: 'family',
  [PrismaSajuRelationType.FRIEND]: 'friend',
  [PrismaSajuRelationType.PARTNER]: 'partner',
  [PrismaSajuRelationType.OTHER]: 'other',
};

const CALENDAR_TYPE_TO_PRISMA = {
  solar: PrismaSajuCalendarType.SOLAR,
  lunar: PrismaSajuCalendarType.LUNAR,
} as const;

const CALENDAR_TYPE_FROM_PRISMA = {
  [PrismaSajuCalendarType.SOLAR]: 'solar',
  [PrismaSajuCalendarType.LUNAR]: 'lunar',
} as const;

const LUCK_CYCLE_GENDER_TO_PRISMA = {
  male: PrismaLuckCycleGender.MALE,
  female: PrismaLuckCycleGender.FEMALE,
} as const;

const LUCK_CYCLE_GENDER_FROM_PRISMA = {
  [PrismaLuckCycleGender.MALE]: 'male',
  [PrismaLuckCycleGender.FEMALE]: 'female',
} as const;

const SAJU_PROFILE_SELECT = {
  id: true,
  displayName: true,
  relationType: true,
  calendarType: true,
  birthYear: true,
  birthMonth: true,
  birthDay: true,
  isLeapMonth: true,
  birthTimePrecision: true,
  birthHour: true,
  birthMinute: true,
  luckCycleGender: true,
  timezone: true,
  currentChartId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SajuProfileSelect;

const SAJU_CHART_SELECT = {
  id: true,
  profileId: true,
  payload: true,
} satisfies Prisma.SajuChartSelect;

const SAJU_PROFILE_WITH_CURRENT_CHART_SELECT = {
  ...SAJU_PROFILE_SELECT,
  currentChart: { select: SAJU_CHART_SELECT },
} satisfies Prisma.SajuProfileSelect;

type ProfileRecord = Prisma.SajuProfileGetPayload<{
  select: typeof SAJU_PROFILE_SELECT;
}>;
type ChartRecord = Prisma.SajuChartGetPayload<{
  select: typeof SAJU_CHART_SELECT;
}>;
type ProfileWithCurrentChartRecord = Prisma.SajuProfileGetPayload<{
  select: typeof SAJU_PROFILE_WITH_CURRENT_CHART_SELECT;
}>;

type ActiveUser = {
  id: string;
  status: PrismaUserStatus;
  primarySajuProfileId: string | null;
};

function hashCreationRequest(request: CreateSajuProfileRequest): string {
  const { birth } = request;
  // Canonical field order; independent of JSON object property ordering.
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.displayName,
        request.relationType,
        birth.calendarType,
        birth.isLeapMonth,
        birth.date.year,
        birth.date.month,
        birth.date.day,
        birth.time.precision,
        birth.time.precision === 'exact' ? birth.time.hour : null,
        birth.time.precision === 'exact' ? birth.time.minute : null,
        birth.luckCycleGender,
      ]),
    )
    .digest('hex');
}

function toPrismaBirthData(birth: BirthInput) {
  return {
    calendarType: CALENDAR_TYPE_TO_PRISMA[birth.calendarType],
    birthYear: birth.date.year,
    birthMonth: birth.date.month,
    birthDay: birth.date.day,
    isLeapMonth: birth.isLeapMonth,
    birthTimePrecision:
      birth.time.precision === 'exact'
        ? PrismaBirthTimePrecision.EXACT
        : PrismaBirthTimePrecision.UNKNOWN,
    birthHour: birth.time.precision === 'exact' ? birth.time.hour : null,
    birthMinute: birth.time.precision === 'exact' ? birth.time.minute : null,
    luckCycleGender: LUCK_CYCLE_GENDER_TO_PRISMA[birth.luckCycleGender],
    timezone: SAJU_TIMEZONE,
  };
}

function hasSameBirth(profile: ProfileRecord, birth: BirthInput) {
  return (
    profile.calendarType === CALENDAR_TYPE_TO_PRISMA[birth.calendarType] &&
    profile.birthYear === birth.date.year &&
    profile.birthMonth === birth.date.month &&
    profile.birthDay === birth.date.day &&
    profile.isLeapMonth === birth.isLeapMonth &&
    profile.birthTimePrecision ===
      (birth.time.precision === 'exact'
        ? PrismaBirthTimePrecision.EXACT
        : PrismaBirthTimePrecision.UNKNOWN) &&
    profile.birthHour ===
      (birth.time.precision === 'exact' ? birth.time.hour : null) &&
    profile.birthMinute ===
      (birth.time.precision === 'exact' ? birth.time.minute : null) &&
    profile.luckCycleGender ===
      LUCK_CYCLE_GENDER_TO_PRISMA[birth.luckCycleGender] &&
    profile.timezone === SAJU_TIMEZONE
  );
}

@Injectable()
export class SajuProfilesService {
  /** Public batch boundary: no caller can read another account's chart. */
  async getOwnedReadingCharts(authSubject: string, chartIds: readonly string[]) {
    const user = await this.getActiveUser(authSubject);
    const charts = await this.prisma.sajuChart.findMany({
      where: {
        id: { in: [...chartIds] },
        profile: {
          ownerUserId: user.id,
          deletedAt: null,
          owner: { status: PrismaUserStatus.ACTIVE },
        },
      },
      select: {
        id: true,
        profileId: true,
        payload: true,
        profile: { select: { displayName: true } },
      },
    });
    if (charts.length !== chartIds.length) {
      throw new NotFoundException({
        message: '선택한 사주 정보를 찾을 수 없습니다.',
        reason: 'SAJU_CHART_NOT_FOUND',
      });
    }
    if (new Set(charts.map((chart) => chart.profileId)).size !== charts.length) {
      throw new ConflictException({
        message: '같은 사람의 차트는 한 번만 선택해주세요.',
        reason: 'DUPLICATE_READING_PARTICIPANT',
      });
    }
    return charts.map((chart) => ({
      chartId: chart.id,
      displayName: chart.profile.displayName,
      snapshot: SajuChartSnapshotV1Schema.parse(chart.payload),
    }));
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: SajuChartCalculator,
  ) {}

  async create(
    authSubject: string,
    request: CreateSajuProfileRequest,
    requestKey?: string,
  ): Promise<CreateSajuProfileData> {
    return this.withOwnerTransaction(authSubject, async (transaction, user) => {
      const requestHash = hashCreationRequest(request);
      if (requestKey) {
        const previous = await transaction.sajuProfileCreation.findUnique({
          where: {
            ownerUserId_requestKey: { ownerUserId: user.id, requestKey },
          },
          select: { requestHash: true, profileId: true },
        });
        if (previous) {
          if (previous.requestHash !== requestHash) {
            throw new ConflictException({
              message: '같은 등록 요청 키로 다른 정보를 저장할 수 없습니다.',
              reason: 'IDEMPOTENCY_KEY_REUSED',
            });
          }
          if (!previous.profileId) {
            throw new ConflictException({
              message:
                '이 요청으로 등록한 프로필은 삭제되었습니다. 새 등록을 시작해주세요.',
              reason: 'SAJU_PROFILE_CREATION_DELETED',
            });
          }
          const profile = await this.getOwnedProfile(
            user.id,
            previous.profileId,
            transaction,
          );
          if (!profile.currentChart) {
            throw new ConflictException({
              message: '등록된 프로필의 만세력을 확인해주세요.',
              reason: 'SAJU_PROFILE_CHART_UNAVAILABLE',
            });
          }
          return {
            profile: this.toSajuProfile(
              profile,
              user.primarySajuProfileId === profile.id,
            ),
            chart: this.toSajuChart(profile.currentChart),
          };
        }
      }
      const calculatedAt = new Date();
      const calculation = this.calculator.calculate(
        request.birth,
        calculatedAt,
      );
      const createdProfile = await transaction.sajuProfile.create({
        data: {
          ownerUserId: user.id,
          displayName: request.displayName,
          relationType: RELATION_TYPE_TO_PRISMA[request.relationType],
          ...toPrismaBirthData(request.birth),
        },
        select: SAJU_PROFILE_SELECT,
      });
      const chart = await transaction.sajuChart.create({
        data: {
          profileId: createdProfile.id,
          schemaVersion: SAJU_CHART_SCHEMA_VERSION,
          engineName: SAJU_ENGINE_NAME,
          engineVersion: SAJU_ENGINE_VERSION,
          policyVersion: SAJU_POLICY_VERSION,
          inputHash: calculation.inputHash,
          payload: calculation.snapshot,
          calculatedAt,
        },
        select: SAJU_CHART_SELECT,
      });
      const profile = await transaction.sajuProfile.update({
        where: { id: createdProfile.id },
        data: { currentChartId: chart.id },
        select: SAJU_PROFILE_SELECT,
      });
      const primaryAssignment = await transaction.user.updateMany({
        where: { id: user.id, primarySajuProfileId: null },
        data: { primarySajuProfileId: profile.id },
      });
      const isPrimary =
        user.primarySajuProfileId === profile.id ||
        primaryAssignment.count === 1;

      if (requestKey) {
        await transaction.sajuProfileCreation.create({
          data: {
            ownerUserId: user.id,
            requestKey,
            requestHash,
            profileId: profile.id,
          },
          select: { requestKey: true },
        });
      }
      return {
        profile: this.toSajuProfile(profile, isPrimary),
        chart: this.toSajuChart(chart),
      };
    });
  }

  async findAll(authSubject: string): Promise<GetSajuProfilesData> {
    const user = await this.getActiveUser(authSubject);
    const profiles = await this.prisma.sajuProfile.findMany({
      where: { ownerUserId: user.id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: SAJU_PROFILE_SELECT,
    });

    return {
      profiles: profiles.map((profile) =>
        this.toSajuProfile(profile, user.primarySajuProfileId === profile.id),
      ),
    };
  }

  async findOne(
    authSubject: string,
    profileId: string,
  ): Promise<GetSajuProfileData> {
    const user = await this.getActiveUser(authSubject);
    const profile = await this.getOwnedProfile(user.id, profileId);

    return this.toSajuProfileData(
      profile,
      user.primarySajuProfileId === profile.id,
    );
  }

  async update(
    authSubject: string,
    profileId: string,
    request: UpdateSajuProfileRequest,
  ): Promise<UpdateSajuProfileData> {
    return this.withOwnerTransaction(authSubject, async (transaction, user) => {
      const existingProfile = await this.getOwnedProfile(
        user.id,
        profileId,
        transaction,
      );
      const nextDisplayName =
        request.displayName ?? existingProfile.displayName;
      const nextRelationType =
        request.relationType ??
        RELATION_TYPE_FROM_PRISMA[existingProfile.relationType];
      const isDisplayNameChanged =
        nextDisplayName !== existingProfile.displayName;
      const isRelationTypeChanged =
        RELATION_TYPE_TO_PRISMA[nextRelationType] !==
        existingProfile.relationType;
      const isBirthChanged =
        request.birth !== undefined &&
        !hasSameBirth(existingProfile, request.birth);
      const nextBirth = request.birth;
      const currentCalculation = existingProfile.currentChart
        ? this.toSajuChart(existingProfile.currentChart).snapshot.calculation
        : null;
      // Submitting birth information also confirms the current calculation policy.
      // Display-name/relation-only PATCH requests keep the immutable old chart.
      const shouldRecalculate =
        nextBirth !== undefined &&
        (isBirthChanged ||
          currentCalculation?.policyVersion !== SAJU_POLICY_VERSION ||
          currentCalculation?.engineVersion !== SAJU_ENGINE_VERSION ||
          currentCalculation?.timeZoneDatabaseVersion !==
            KOREAN_TIME_DATA_VERSION);
      const isPrimary = user.primarySajuProfileId === existingProfile.id;
      const profileInfoUpdate = {
        ...(isDisplayNameChanged ? { displayName: nextDisplayName } : {}),
        ...(isRelationTypeChanged
          ? { relationType: RELATION_TYPE_TO_PRISMA[nextRelationType] }
          : {}),
      };

      if (
        !isDisplayNameChanged &&
        !isRelationTypeChanged &&
        !shouldRecalculate
      ) {
        return this.toSajuProfileData(existingProfile, isPrimary);
      }

      if (!shouldRecalculate || nextBirth === undefined) {
        const profile = await transaction.sajuProfile.update({
          where: { id: existingProfile.id },
          data: profileInfoUpdate,
          select: SAJU_PROFILE_SELECT,
        });

        return {
          profile: this.toSajuProfile(profile, isPrimary),
          chart: existingProfile.currentChart
            ? this.toSajuChart(existingProfile.currentChart)
            : null,
        };
      }

      const calculatedAt = new Date();
      const calculation = this.calculator.calculate(nextBirth, calculatedAt);

      const chart = await transaction.sajuChart.upsert({
        where: {
          profileId_inputHash: {
            profileId: existingProfile.id,
            inputHash: calculation.inputHash,
          },
        },
        update: {},
        create: {
          profileId: existingProfile.id,
          schemaVersion: SAJU_CHART_SCHEMA_VERSION,
          engineName: SAJU_ENGINE_NAME,
          engineVersion: SAJU_ENGINE_VERSION,
          policyVersion: SAJU_POLICY_VERSION,
          inputHash: calculation.inputHash,
          payload: calculation.snapshot,
          calculatedAt,
        },
        select: SAJU_CHART_SELECT,
      });
      const profile = await transaction.sajuProfile.update({
        where: { id: existingProfile.id },
        data: {
          ...profileInfoUpdate,
          ...toPrismaBirthData(nextBirth),
          currentChartId: chart.id,
        },
        select: SAJU_PROFILE_SELECT,
      });

      return {
        profile: this.toSajuProfile(profile, isPrimary),
        chart: this.toSajuChart(chart),
      };
    });
  }

  async remove(
    authSubject: string,
    profileId: string,
  ): Promise<DeleteSajuProfileData> {
    return this.withOwnerTransaction(authSubject, async (transaction, user) => {
      const profile = await this.getOwnedProfile(
        user.id,
        profileId,
        transaction,
      );
      let primarySajuProfileId = user.primarySajuProfileId;

      if (user.primarySajuProfileId === profile.id) {
        const replacementProfile = await transaction.sajuProfile.findFirst({
          where: {
            ownerUserId: user.id,
            id: { not: profile.id },
            deletedAt: null,
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });

        primarySajuProfileId = replacementProfile?.id ?? null;
        await transaction.user.update({
          where: { id: user.id },
          data: { primarySajuProfileId },
          select: { id: true },
        });
      }

      await transaction.sajuProfile.update({
        where: { id: profile.id },
        data: { currentChartId: null },
        select: { id: true },
      });
      await transaction.readingJob.deleteMany({
        where: { ownerUserId: user.id, participants: { some: { chart: { profileId: profile.id } } } },
      });
      await transaction.sajuProfile.delete({
        where: { id: profile.id },
        select: { id: true },
      });

      return {
        deletedProfileId: profile.id,
        primarySajuProfileId,
      };
    });
  }

  private async withOwnerTransaction<T>(
    authSubject: string,
    work: (
      transaction: Prisma.TransactionClient,
      user: ActiveUser,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => {
        // All profile writes take the same per-owner lock before reading state.
        // This also serializes first-profile assignment and concurrent retries.
        await transaction.$queryRaw`
        SELECT id FROM users WHERE auth_subject = ${authSubject}::uuid FOR UPDATE
      `;
        const user = await this.getActiveUser(authSubject, transaction);
        return work(transaction, user);
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  private async getActiveUser(
    authSubject: string,
    database: Prisma.TransactionClient = this.prisma,
  ) {
    const user = await database.user.findUnique({
      where: { authSubject },
      select: { id: true, status: true, primarySajuProfileId: true },
    });

    if (!user || user.status === PrismaUserStatus.PENDING_REGISTRATION) {
      throw new ForbiddenException({
        message: '가입 확인을 완료한 뒤 사주 프로필을 이용할 수 있습니다.',
        reason: 'USER_REGISTRATION_REQUIRED',
      });
    }

    if (user.status !== PrismaUserStatus.ACTIVE) {
      throw new ForbiddenException({
        message: '현재 사용자 상태에서는 사주 프로필을 이용할 수 없습니다.',
        reason: 'USER_ACCESS_DENIED',
      });
    }

    return user;
  }

  private async getOwnedProfile(
    ownerUserId: string,
    profileId: string,
    database: Prisma.TransactionClient = this.prisma,
  ): Promise<ProfileWithCurrentChartRecord> {
    const profile = await database.sajuProfile.findFirst({
      where: { id: profileId, ownerUserId, deletedAt: null },
      select: SAJU_PROFILE_WITH_CURRENT_CHART_SELECT,
    });

    if (!profile) {
      throw new NotFoundException({
        message: '사주 프로필을 찾을 수 없습니다.',
        reason: 'SAJU_PROFILE_NOT_FOUND',
      });
    }

    return profile;
  }

  private toSajuProfileData(
    profile: ProfileWithCurrentChartRecord,
    isPrimary: boolean,
  ): GetSajuProfileData {
    return {
      profile: this.toSajuProfile(profile, isPrimary),
      chart: profile.currentChart
        ? this.toSajuChart(profile.currentChart)
        : null,
    };
  }

  private toSajuProfile(
    profile: ProfileRecord,
    isPrimary: boolean,
  ): SajuProfile {
    const time: SajuProfile['birth']['time'] =
      profile.birthTimePrecision === PrismaBirthTimePrecision.EXACT &&
      profile.birthHour !== null &&
      profile.birthMinute !== null
        ? {
            precision: 'exact',
            hour: profile.birthHour,
            minute: profile.birthMinute,
          }
        : { precision: 'unknown' };

    return {
      id: profile.id,
      displayName: profile.displayName,
      relationType: RELATION_TYPE_FROM_PRISMA[profile.relationType],
      isPrimary,
      birth: {
        calendarType: CALENDAR_TYPE_FROM_PRISMA[profile.calendarType],
        isLeapMonth: profile.isLeapMonth,
        date: {
          year: profile.birthYear,
          month: profile.birthMonth,
          day: profile.birthDay,
        },
        time,
        luckCycleGender: LUCK_CYCLE_GENDER_FROM_PRISMA[profile.luckCycleGender],
      },
      currentChartId: profile.currentChartId,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private toSajuChart(chart: ChartRecord): SajuChart {
    return {
      id: chart.id,
      profileId: chart.profileId,
      snapshot: SajuChartSnapshotV1Schema.parse(chart.payload),
    };
  }
}
