import {
  analyzeBranchRelations,
  analyzeDayMasterStrength,
  analyzeWealthFortune,
  calculateJiJangGanStrength,
  calculateTenGod,
  calculateTenGodsDistribution,
  checkWolRyeong,
  determineGyeokGuk,
  extractJiJangGan,
  findSinSals,
  FORTUNETELLER_PACKAGE_VERSION,
  FORTUNETELLER_UPSTREAM_REVISION,
  generateTenGodsList,
  getHeavenlyStemByKorean,
  SAM_HAP,
  selectYongSin,
  type PartialSajuData,
  type Pillar,
  type SajuData,
} from '@hoshin/saju-mcp-server';
import { z } from 'zod';
import type { SajuChartSnapshotV1 } from '../../saju-profiles/index.js';

export const FORTUNETELLER_ANALYSIS_VERSION = 'fortuneteller-native-v1';
const STEM = z.enum([
  '갑',
  '을',
  '병',
  '정',
  '무',
  '기',
  '경',
  '신',
  '임',
  '계',
]);
const BRANCH = z.enum([
  '자',
  '축',
  '인',
  '묘',
  '진',
  '사',
  '오',
  '미',
  '신',
  '유',
  '술',
  '해',
]);
const ELEMENT = z.enum(['목', '화', '토', '금', '수']);
const TEN_GOD = z.enum([
  '비견',
  '겁재',
  '식신',
  '상관',
  '편재',
  '정재',
  '편관',
  '정관',
  '편인',
  '정인',
]);
const LEVEL = z.enum(['very_strong', 'strong', 'medium', 'weak', 'very_weak']);
const TEXT = z.string().max(10_000);
const TEXTS = z.array(TEXT).max(100);
const SCORE = z.number().finite().min(0).max(100);
const ELEMENTS = {
  wood: '목',
  fire: '화',
  earth: '토',
  metal: '금',
  water: '수',
} as const;
const ELEMENT_CODES = {
  목: 'wood',
  화: 'fire',
  토: 'earth',
  금: 'metal',
  수: 'water',
} as const;
const STEM_CODES = {
  갑: 'gap',
  을: 'eul',
  병: 'byeong',
  정: 'jeong',
  무: 'mu',
  기: 'gi',
  경: 'gyeong',
  신: 'sin',
  임: 'im',
  계: 'gye',
} as const;
const MONTH_BRANCHES: readonly Pillar['branch'][] = [
  '인',
  '묘',
  '진',
  '사',
  '오',
  '미',
  '신',
  '유',
  '술',
  '해',
  '자',
  '축',
];
const POSITIONS = ['year', 'month', 'day', 'hour'] as const;
const STRENGTH = z.object({ level: LEVEL, score: SCORE, analysis: TEXT });
const GYEOKGUK = z.object({
  gyeokGuk: TEXT,
  name: TEXT,
  hanja: TEXT,
  description: TEXT,
});
const YONGSIN = z.object({
  primaryYongSin: ELEMENT,
  secondaryYongSin: ELEMENT.optional(),
  xiSin: z.array(ELEMENT),
  jiSin: z.array(ELEMENT),
  chouSin: z.array(ELEMENT),
  dayMasterStrength: LEVEL,
  reasoning: TEXT,
  recommendations: z.object({
    colors: TEXTS,
    directions: TEXTS,
    careers: TEXTS,
    activities: TEXTS,
    cautions: TEXTS,
  }),
});
const WEALTH = z.object({
  type: z.literal('wealth'),
  score: SCORE,
  summary: TEXT,
  details: z.object({ positive: TEXTS, negative: TEXTS, advice: TEXTS }),
});
const RELATIONS = z.object({
  samHap: z.object({ type: TEXT.nullable(), element: ELEMENT.nullable() }),
  samHyeong: TEXTS,
  yukHae: z.array(z.tuple([BRANCH, BRANCH])),
});

function mapPillar(
  pillar: NonNullable<SajuChartSnapshotV1['pillars']['hour']>,
): Pillar {
  return {
    stem: STEM.parse(pillar.stem.korean),
    branch: BRANCH.parse(pillar.branch.korean),
    stemElement: ELEMENTS[pillar.stem.element],
    branchElement: ELEMENTS[pillar.branch.element],
    yinYang: pillar.stem.yinYang === 'yang' ? '양' : '음',
  };
}

// Saved charts remain authoritative. This mapper never calls a calendar engine,
// invents a birth hour, or shares the local birth metadata with the model.
export function mapFortunetellerInput(
  snapshot: SajuChartSnapshotV1,
): PartialSajuData {
  const birth = snapshot.normalizedBirth;
  const date = birth.inputDate;
  const hour = snapshot.pillars.hour ? mapPillar(snapshot.pillars.hour) : null;
  if ((birth.time.precision === 'exact') !== (hour !== null)) {
    throw new Error('Inconsistent saved chart time precision');
  }
  return {
    birthDate: `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`,
    birthTime:
      birth.time.precision === 'exact'
        ? `${String(birth.time.hour).padStart(2, '0')}:${String(birth.time.minute).padStart(2, '0')}`
        : '',
    birthCity: '', // No birthplace was supplied; no original date calculator is called.
    calendar: birth.calendarType,
    isLeapMonth: birth.lunarDate.isLeapMonth,
    gender: birth.luckCycleGender,
    year: mapPillar(snapshot.pillars.year),
    month: mapPillar(snapshot.pillars.month),
    day: mapPillar(snapshot.pillars.day),
    hour,
    wuxingCount: {
      목: snapshot.elementDistribution.counts.wood,
      화: snapshot.elementDistribution.counts.fire,
      토: snapshot.elementDistribution.counts.earth,
      금: snapshot.elementDistribution.counts.metal,
      수: snapshot.elementDistribution.counts.water,
    },
    tenGods: [],
  };
}

export function analyzeFortuneteller(
  snapshot: SajuChartSnapshotV1,
  participantKey: string,
) {
  const input = mapFortunetellerInput(snapshot);
  const monthIndex = MONTH_BRANCHES.indexOf(input.month.branch);
  // Upstream distribution must see hidden-stem weights before it is called.
  input.jiJangGan = {
    year: calculateJiJangGanStrength(input.year.branch, monthIndex),
    month: calculateJiJangGanStrength(input.month.branch, monthIndex),
    day: calculateJiJangGanStrength(input.day.branch, monthIndex),
    ...(input.hour
      ? { hour: calculateJiJangGanStrength(input.hour.branch, monthIndex) }
      : {}),
  };
  input.tenGods = generateTenGodsList(input);
  input.tenGodsDistribution = z
    .record(TEN_GOD, z.number().finite().nonnegative())
    .parse(calculateTenGodsDistribution(input));
  input.wolRyeong = checkWolRyeong(input.day.stem, input.month.branch);
  const pillars = POSITIONS.flatMap((position) => {
    const pillar = input[position];
    return pillar ? [{ position, pillar }] : [];
  });
  const hiddenStemFacts = pillars.flatMap(({ position, pillar }) => {
    const weights = input.jiJangGan?.[position];
    return extractJiJangGan(pillar.branch).map((stem, index) => {
      const details = getHeavenlyStemByKorean(stem);
      const weightedStem = [
        weights?.primary,
        weights?.secondary,
        weights?.residual,
      ].find((value) => value?.stem === stem);
      if (!details || !weightedStem)
        throw new Error('Invalid upstream hidden-stem data');
      return {
        id: `${participantKey}.${position}.hidden.${STEM_CODES[stem]}`,
        position,
        branchKorean: pillar.branch,
        stemKorean: stem,
        elementKorean: details.element,
        yinYangKorean: details.yinYang,
        tenGodKorean: calculateTenGod(input.day.stem, stem),
        isPrincipal: index === 0,
        seasonalWeight: SCORE.parse(weightedStem.strength) / 100,
      };
    });
  });
  const nativeRelations = RELATIONS.parse(
    analyzeBranchRelations(pillars.map(({ pillar }) => pillar.branch)),
  );
  // Stable evidence IDs for complete trines use the installed upstream table.
  const branchRelations = Object.values(SAM_HAP)
    .filter((trine) =>
      trine.branches.every((branch) =>
        pillars.some(({ pillar }) => pillar.branch === branch),
      ),
    )
    .map((trine) => ({
      id: `${participantKey}.branch_trine.${ELEMENT_CODES[trine.element]}`,
      kind: 'complete_trine_membership' as const,
      branchesKorean: trine.branches.join(''),
      associatedElementKorean: trine.element,
      positions: pillars
        .filter(({ pillar }) => trine.branches.includes(pillar.branch))
        .map(({ position }) => position),
      transformationEstablished: false as const,
    }));
  let dayMasterStrength: z.output<typeof STRENGTH> | null = null;
  let gyeokGuk: z.output<typeof GYEOKGUK> | null = null;
  let yongSin: z.output<typeof YONGSIN> | null = null;
  let sinSals: string[] | null = null;
  // No dummy hour is allowed to satisfy SajuData. Only this branch can call
  // full-chart functions; one partial participant cannot downgrade anyone else.
  if (input.hour && input.jiJangGan.hour) {
    const full: SajuData = {
      ...input,
      hour: input.hour,
      jiJangGan: { ...input.jiJangGan, hour: input.jiJangGan.hour },
    };
    dayMasterStrength = STRENGTH.parse(analyzeDayMasterStrength(full));
    full.dayMasterStrength = dayMasterStrength;
    gyeokGuk = GYEOKGUK.parse(determineGyeokGuk(full));
    yongSin = YONGSIN.parse(selectYongSin(full));
    sinSals = TEXTS.parse(findSinSals(full));
  }
  const nativeWealth = WEALTH.parse(analyzeWealthFortune(input));
  const scope = pillars.map(({ position }) => position);
  const evidenceIds = [
    ...pillars
      .filter(({ position }) => position !== 'day')
      .map(({ position }) => `${participantKey}.${position}.stem`),
    ...hiddenStemFacts.map(({ id }) => id),
  ];
  return {
    hiddenStemFacts,
    branchRelations,
    fortuneTellerAnalysis: {
      source: 'fortuneteller' as const,
      implementation: 'installed_upstream_fork' as const,
      packageVersion: FORTUNETELLER_PACKAGE_VERSION,
      upstreamRevision: FORTUNETELLER_UPSTREAM_REVISION,
      policyVersion: FORTUNETELLER_ANALYSIS_VERSION,
      status: input.hour ? ('complete' as const) : ('partial' as const),
      pillarsUsed: scope,
      tenGodDistribution: {
        method: 'upstream_seasonal_hidden_stem_weights' as const,
        counts: input.tenGodsDistribution,
        evidenceIds,
      },
      monthSupport: {
        ...input.wolRyeong,
        evidenceIds: [
          `${participantKey}.day.stem`,
          `${participantKey}.month.branch`,
        ],
      },
      branchRelationships: nativeRelations,
      dayMasterStrength,
      gyeokGuk,
      yongSin,
      sinSals,
      wealth: {
        summary: nativeWealth.summary,
        ...nativeWealth.details,
        // Upstream's full-chart heuristic is diagnostic, never the sort key.
        referenceScore: input.hour ? nativeWealth.score : null,
        scoreUsage: 'not_a_ranking_or_probability' as const,
        scope,
      },
      excludedAnalyses: input.hour
        ? []
        : [
            'day_master_strength',
            'gyeokguk',
            'yongsin',
            'sinsal',
            'wealth_score',
          ],
      limitations: [
        'interpretation_rules_not_astronomical_facts',
        'native_scores_are_not_wealth_rankings',
        'gyeokguk_yongsin_sinsal_are_upstream_heuristics',
        'seasonal_weights_are_not_normalized_probabilities',
        'no_time_period_prediction',
        ...(!input.hour
          ? [
              'hour_pillar_unknown',
              'absence_in_three_pillars_is_not_full_chart_absence',
              'saved_date_day_master_is_conditional',
            ]
          : []),
      ],
    },
  };
}
