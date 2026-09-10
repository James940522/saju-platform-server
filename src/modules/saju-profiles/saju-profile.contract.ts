import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';

export const SajuRelationTypeSchema = z
  .enum(['self', 'family', 'friend', 'partner', 'other'])
  .meta({ id: 'SajuRelationType' });

export const SajuCalendarTypeSchema = z
  .enum(['solar', 'lunar'])
  .meta({ id: 'SajuCalendarType' });

export const LuckCycleGenderSchema = z
  .enum(['male', 'female'])
  .meta({ id: 'LuckCycleGender' });

export const BirthDateSchema = z
  .strictObject({
    year: z.number().int().min(1800).max(2300),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .meta({ id: 'BirthDate' });

export const BirthTimeSchema = z
  .discriminatedUnion('precision', [
    z.strictObject({
      precision: z.literal('exact'),
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    }),
    z.strictObject({ precision: z.literal('unknown') }),
  ])
  .meta({ id: 'BirthTime' });

export const BirthInputSchema = z
  .strictObject({
    calendarType: SajuCalendarTypeSchema,
    isLeapMonth: z.boolean(),
    date: BirthDateSchema,
    time: BirthTimeSchema,
    luckCycleGender: LuckCycleGenderSchema,
  })
  .superRefine((birth, context) => {
    if (birth.calendarType === 'solar' && birth.isLeapMonth) {
      context.addIssue({
        code: 'custom',
        message: '양력에는 윤달을 지정할 수 없습니다.',
        path: ['isLeapMonth'],
      });
    }

    if (birth.calendarType === 'lunar' && birth.date.day > 30) {
      context.addIssue({
        code: 'custom',
        message: '음력 날짜는 30일까지 입력할 수 있습니다.',
        path: ['date', 'day'],
      });
    }

    if (birth.calendarType === 'lunar' && birth.date.year > 2100) {
      context.addIssue({
        code: 'custom',
        message: '음력은 2100년까지 입력할 수 있습니다.',
        path: ['date', 'year'],
      });
    }
  })
  .meta({ id: 'BirthInput' });

export const CreateSajuProfileRequestSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(30),
    relationType: SajuRelationTypeSchema,
    birth: BirthInputSchema,
  })
  .meta({ id: 'CreateSajuProfileRequest' });

export const UpdateSajuProfileRequestSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(30).optional(),
    relationType: SajuRelationTypeSchema.optional(),
    birth: BirthInputSchema.optional(),
  })
  .refine(
    (request) =>
      request.displayName !== undefined ||
      request.relationType !== undefined ||
      request.birth !== undefined,
    { message: '변경할 사주 프로필 정보를 입력해주세요.' },
  )
  .meta({ id: 'UpdateSajuProfileRequest' });

export const SajuProfileParamsSchema = z.strictObject({
  profileId: z.uuid(),
});

export const SajuProfileSchema = z
  .strictObject({
    id: z.uuid(),
    displayName: z.string().min(1).max(30),
    relationType: SajuRelationTypeSchema,
    isPrimary: z.boolean(),
    birth: BirthInputSchema,
    currentChartId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SajuProfile' });

const FiveElementCodeSchema = z.enum([
  'wood',
  'fire',
  'earth',
  'metal',
  'water',
]);

const YinYangCodeSchema = z.enum(['yang', 'yin']);

const HeavenlyStemCodeSchema = z.enum([
  'gap',
  'eul',
  'byeong',
  'jeong',
  'mu',
  'gi',
  'gyeong',
  'sin',
  'im',
  'gye',
]);

const EarthlyBranchCodeSchema = z.enum([
  'ja',
  'chuk',
  'in',
  'myo',
  'jin',
  'sa',
  'o',
  'mi',
  'sin',
  'yu',
  'sul',
  'hae',
]);

const TenGodCodeSchema = z.enum([
  'day_master',
  'bi_gyeon',
  'geop_jae',
  'sik_sin',
  'sang_gwan',
  'pyeon_jae',
  'jeong_jae',
  'pyeon_gwan',
  'jeong_gwan',
  'pyeon_in',
  'jeong_in',
]);

const StemSymbolSchema = z.strictObject({
  code: HeavenlyStemCodeSchema,
  korean: z.string().min(1),
  hanja: z.string().min(1),
  element: FiveElementCodeSchema,
  yinYang: YinYangCodeSchema,
});

const BranchSymbolSchema = z.strictObject({
  code: EarthlyBranchCodeSchema,
  korean: z.string().min(1),
  hanja: z.string().min(1),
  element: FiveElementCodeSchema,
  yinYang: YinYangCodeSchema,
});

const GanjiSchema = z.strictObject({
  korean: z.string().min(2),
  hanja: z.string().min(2),
  stem: StemSymbolSchema,
  branch: BranchSymbolSchema,
});

const NatalPillarSchema = GanjiSchema.extend({
  tenGods: z.strictObject({
    stem: TenGodCodeSchema,
    branch: TenGodCodeSchema,
  }),
});

const SajuChartWarningSchema = z.strictObject({
  code: z.enum([
    'birth_time_unknown',
    'luck_cycle_unavailable',
    'near_solar_term_boundary',
  ]),
  message: z.string().min(1),
});

export const SajuChartSnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    quality: z.enum(['complete', 'partial']),
    calculation: z.strictObject({
      engine: z.literal('manseryeok'),
      engineVersion: z.string().min(1),
      policyVersion: z.string().min(1),
      calculatedAt: z.iso.datetime(),
    }),
    normalizedBirth: z.strictObject({
      calendarType: SajuCalendarTypeSchema,
      inputDate: BirthDateSchema,
      solarDate: BirthDateSchema,
      lunarDate: BirthDateSchema.extend({ isLeapMonth: z.boolean() }),
      time: BirthTimeSchema,
      luckCycleGender: LuckCycleGenderSchema,
      timezone: z.literal('Asia/Seoul'),
    }),
    pillars: z.strictObject({
      year: NatalPillarSchema,
      month: NatalPillarSchema,
      day: NatalPillarSchema,
      hour: NatalPillarSchema.nullable(),
    }),
    dayMaster: StemSymbolSchema,
    elementDistribution: z.strictObject({
      method: z.literal('eight-symbol-count-v1'),
      totalSymbols: z.union([z.literal(6), z.literal(8)]),
      counts: z.strictObject({
        wood: z.number().int().nonnegative(),
        fire: z.number().int().nonnegative(),
        earth: z.number().int().nonnegative(),
        metal: z.number().int().nonnegative(),
        water: z.number().int().nonnegative(),
      }),
    }),
    voidBranches: z.array(
      z.strictObject({
        code: EarthlyBranchCodeSchema,
        korean: z.string().min(1),
        hanja: z.string().min(1),
      }),
    ),
    luckCycle: z
      .strictObject({
        direction: z.enum(['forward', 'backward']),
        start: z.strictObject({
          roundedAge: z.number().int().nonnegative(),
          years: z.number().int().nonnegative(),
          months: z.number().int().nonnegative(),
          days: z.number().int().nonnegative(),
        }),
        items: z.array(
          z.strictObject({
            sequence: z.number().int().positive(),
            startAge: z.number().int().nonnegative(),
            ganji: GanjiSchema,
          }),
        ),
      })
      .nullable(),
    warnings: z.array(SajuChartWarningSchema),
  })
  .meta({ id: 'SajuChartSnapshotV1' });

export const SajuChartSchema = z
  .strictObject({
    id: z.uuid(),
    profileId: z.uuid(),
    snapshot: SajuChartSnapshotV1Schema,
  })
  .meta({ id: 'SajuChart' });

export const CreateSajuProfileDataSchema = z
  .strictObject({
    profile: SajuProfileSchema,
    chart: SajuChartSchema,
  })
  .meta({ id: 'CreateSajuProfileData' });

export const GetSajuProfilesDataSchema = z
  .strictObject({ profiles: z.array(SajuProfileSchema) })
  .meta({ id: 'GetSajuProfilesData' });

export const GetSajuProfileDataSchema = z
  .strictObject({
    profile: SajuProfileSchema,
    chart: SajuChartSchema.nullable(),
  })
  .meta({ id: 'GetSajuProfileData' });

export const UpdateSajuProfileDataSchema = z
  .strictObject({
    profile: SajuProfileSchema,
    chart: SajuChartSchema.nullable(),
  })
  .meta({ id: 'UpdateSajuProfileData' });

export const DeleteSajuProfileDataSchema = z
  .strictObject({
    deletedProfileId: z.uuid(),
    primarySajuProfileId: z.uuid().nullable(),
  })
  .meta({ id: 'DeleteSajuProfileData' });

export const CreateSajuProfileResponseSchema = createApiResponseSchema(
  'CreateSajuProfileResponse',
  201,
  CreateSajuProfileDataSchema,
);

export const GetSajuProfilesResponseSchema = createApiResponseSchema(
  'GetSajuProfilesResponse',
  200,
  GetSajuProfilesDataSchema,
);

export const GetSajuProfileResponseSchema = createApiResponseSchema(
  'GetSajuProfileResponse',
  200,
  GetSajuProfileDataSchema,
);

export const UpdateSajuProfileResponseSchema = createApiResponseSchema(
  'UpdateSajuProfileResponse',
  200,
  UpdateSajuProfileDataSchema,
);

export const DeleteSajuProfileResponseSchema = createApiResponseSchema(
  'DeleteSajuProfileResponse',
  200,
  DeleteSajuProfileDataSchema,
);

export type BirthInput = z.output<typeof BirthInputSchema>;
export type CreateSajuProfileRequest = z.output<
  typeof CreateSajuProfileRequestSchema
>;
export type UpdateSajuProfileRequest = z.output<
  typeof UpdateSajuProfileRequestSchema
>;
export type SajuProfileParams = z.output<typeof SajuProfileParamsSchema>;
export type SajuProfile = z.output<typeof SajuProfileSchema>;
export type SajuChartSnapshotV1 = z.output<typeof SajuChartSnapshotV1Schema>;
export type SajuChart = z.output<typeof SajuChartSchema>;
export type CreateSajuProfileData = z.output<
  typeof CreateSajuProfileDataSchema
>;
export type GetSajuProfilesData = z.output<typeof GetSajuProfilesDataSchema>;
export type GetSajuProfileData = z.output<typeof GetSajuProfileDataSchema>;
export type UpdateSajuProfileData = z.output<
  typeof UpdateSajuProfileDataSchema
>;
export type DeleteSajuProfileData = z.output<
  typeof DeleteSajuProfileDataSchema
>;
