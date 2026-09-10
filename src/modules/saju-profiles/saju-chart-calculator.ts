import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  calculateFourPillars,
  EARTHLY_BRANCHES,
  EARTHLY_BRANCHES_HANJA,
  getEarthlyBranchElement,
  getEarthlyBranchYinYang,
  getHeavenlyStemElement,
  getHeavenlyStemYinYang,
  HEAVENLY_STEMS,
  HEAVENLY_STEMS_HANJA,
  isValidSolarDate,
  lunarToSolar,
  solarToLunar,
  type EarthlyBranch,
  type FiveElement,
  type FourPillarsDetail,
  type HeavenlyStem,
  type Pillar,
  type TenGod,
  type YinYang,
} from 'manseryeok';
import type {
  BirthInput,
  SajuChartSnapshotV1,
} from './saju-profile.contract.js';

export const SAJU_CHART_SCHEMA_VERSION = 1;
export const SAJU_ENGINE_NAME = 'manseryeok';
export const SAJU_ENGINE_VERSION = '2.0.0';
export const SAJU_POLICY_VERSION = 'kr-kst-midnight-v1';
export const SAJU_TIMEZONE = 'Asia/Seoul';

const HEAVENLY_STEM_CODES: Record<
  HeavenlyStem,
  SajuChartSnapshotV1['dayMaster']['code']
> = {
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
};

const EARTHLY_BRANCH_CODES: Record<
  EarthlyBranch,
  SajuChartSnapshotV1['voidBranches'][number]['code']
> = {
  자: 'ja',
  축: 'chuk',
  인: 'in',
  묘: 'myo',
  진: 'jin',
  사: 'sa',
  오: 'o',
  미: 'mi',
  신: 'sin',
  유: 'yu',
  술: 'sul',
  해: 'hae',
};

const FIVE_ELEMENT_CODES: Record<
  FiveElement,
  SajuChartSnapshotV1['dayMaster']['element']
> = {
  목: 'wood',
  화: 'fire',
  토: 'earth',
  금: 'metal',
  수: 'water',
};

const YIN_YANG_CODES: Record<
  YinYang,
  SajuChartSnapshotV1['dayMaster']['yinYang']
> = {
  양: 'yang',
  음: 'yin',
};

const TEN_GOD_CODES: Record<
  TenGod | '일간',
  SajuChartSnapshotV1['pillars']['day']['tenGods']['stem']
> = {
  일간: 'day_master',
  비견: 'bi_gyeon',
  겁재: 'geop_jae',
  식신: 'sik_sin',
  상관: 'sang_gwan',
  편재: 'pyeon_jae',
  정재: 'jeong_jae',
  편관: 'pyeon_gwan',
  정관: 'jeong_gwan',
  편인: 'pyeon_in',
  정인: 'jeong_in',
};

type CalculationResult = {
  inputHash: string;
  snapshot: SajuChartSnapshotV1;
};

function toStemSymbol(stem: HeavenlyStem) {
  return {
    code: HEAVENLY_STEM_CODES[stem],
    korean: stem,
    hanja: HEAVENLY_STEMS_HANJA[HEAVENLY_STEMS.indexOf(stem)],
    element: FIVE_ELEMENT_CODES[getHeavenlyStemElement(stem)],
    yinYang: YIN_YANG_CODES[getHeavenlyStemYinYang(stem)],
  };
}

function toBranchSymbol(branch: EarthlyBranch) {
  return {
    code: EARTHLY_BRANCH_CODES[branch],
    korean: branch,
    hanja: EARTHLY_BRANCHES_HANJA[EARTHLY_BRANCHES.indexOf(branch)],
    element: FIVE_ELEMENT_CODES[getEarthlyBranchElement(branch)],
    yinYang: YIN_YANG_CODES[getEarthlyBranchYinYang(branch)],
  };
}

function toGanji(pillar: Pillar) {
  const stem = toStemSymbol(pillar.heavenlyStem);
  const branch = toBranchSymbol(pillar.earthlyBranch);

  return {
    korean: `${stem.korean}${branch.korean}`,
    hanja: `${stem.hanja}${branch.hanja}`,
    stem,
    branch,
  };
}

function toNatalPillar(
  pillar: Pillar,
  tenGods: { stem: TenGod | '일간'; branch: TenGod },
) {
  return {
    ...toGanji(pillar),
    tenGods: {
      stem: TEN_GOD_CODES[tenGods.stem],
      branch: TEN_GOD_CODES[tenGods.branch],
    },
  };
}

function hasSameDatePillars(
  first: FourPillarsDetail,
  second: FourPillarsDetail,
) {
  return (['year', 'month', 'day'] as const).every(
    (key) =>
      first[key].heavenlyStem === second[key].heavenlyStem &&
      first[key].earthlyBranch === second[key].earthlyBranch,
  );
}

function getKoreaToday() {
  const koreaNow = new Date(Date.now() + 9 * 60 * 60 * 1000);

  return {
    year: koreaNow.getUTCFullYear(),
    month: koreaNow.getUTCMonth() + 1,
    day: koreaNow.getUTCDate(),
  };
}

function isAfterDate(
  date: { year: number; month: number; day: number },
  other: { year: number; month: number; day: number },
) {
  return (
    date.year > other.year ||
    (date.year === other.year && date.month > other.month) ||
    (date.year === other.year &&
      date.month === other.month &&
      date.day > other.day)
  );
}

@Injectable()
export class SajuChartCalculator {
  calculate(birth: BirthInput, calculatedAt = new Date()): CalculationResult {
    const normalizedDates = this.normalizeDates(birth);

    if (isAfterDate(normalizedDates.solarDate, getKoreaToday())) {
      throw new BadRequestException({
        message: '미래의 생년월일은 등록할 수 없습니다.',
        reason: 'FUTURE_BIRTH_DATE',
      });
    }

    let result: FourPillarsDetail;

    try {
      if (birth.time.precision === 'unknown') {
        const startOfDay = this.calculateWithTime(birth, 0, 0, false);
        const endOfDay = this.calculateWithTime(birth, 23, 59, false);

        if (!hasSameDatePillars(startOfDay, endOfDay)) {
          throw new BadRequestException({
            message:
              '이 날짜는 출생 시각에 따라 원국이 달라져 시간을 모름으로 등록할 수 없습니다.',
            reason: 'BIRTH_TIME_REQUIRED_ON_BOUNDARY_DATE',
          });
        }

        result = this.calculateWithTime(birth, 12, 0, false);
      } else {
        result = this.calculateWithTime(
          birth,
          birth.time.hour,
          birth.time.minute,
          true,
        );
      }
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException({
        message: '입력한 생년월일시로 만세력을 계산할 수 없습니다.',
        reason: 'CALCULATION_FAILED',
      });
    }

    const snapshot = this.toSnapshot(
      birth,
      normalizedDates,
      result,
      calculatedAt,
    );
    const inputHash = createHash('sha256')
      .update(
        JSON.stringify({
          schemaVersion: SAJU_CHART_SCHEMA_VERSION,
          engine: SAJU_ENGINE_NAME,
          engineVersion: SAJU_ENGINE_VERSION,
          policyVersion: SAJU_POLICY_VERSION,
          birth,
          timezone: SAJU_TIMEZONE,
        }),
      )
      .digest('hex');

    return { inputHash, snapshot };
  }

  private normalizeDates(birth: BirthInput) {
    if (birth.calendarType === 'solar') {
      if (
        !isValidSolarDate(birth.date.year, birth.date.month, birth.date.day)
      ) {
        throw new BadRequestException({
          message: '실제로 존재하는 양력 생년월일을 입력해주세요.',
          reason: 'INVALID_SOLAR_DATE',
        });
      }

      try {
        return {
          solarDate: { ...birth.date },
          lunarDate: solarToLunar(
            birth.date.year,
            birth.date.month,
            birth.date.day,
          ),
        };
      } catch {
        throw new BadRequestException({
          message: '지원하지 않는 생년월일입니다.',
          reason: 'UNSUPPORTED_BIRTH_YEAR',
        });
      }
    }

    try {
      return {
        solarDate: lunarToSolar(
          birth.date.year,
          birth.date.month,
          birth.date.day,
          birth.isLeapMonth,
        ),
        lunarDate: {
          ...birth.date,
          isLeapMonth: birth.isLeapMonth,
        },
      };
    } catch {
      throw new BadRequestException({
        message: birth.isLeapMonth
          ? '해당 연도에 존재하는 윤달 날짜인지 확인해주세요.'
          : '실제로 존재하는 음력 생년월일을 입력해주세요.',
        reason: birth.isLeapMonth ? 'INVALID_LEAP_MONTH' : 'INVALID_LUNAR_DATE',
      });
    }
  }

  private calculateWithTime(
    birth: BirthInput,
    hour: number,
    minute: number,
    includeLuckCycle: boolean,
  ) {
    return calculateFourPillars({
      year: birth.date.year,
      month: birth.date.month,
      day: birth.date.day,
      hour,
      minute,
      isLunar: birth.calendarType === 'lunar',
      isLeapMonth: birth.isLeapMonth,
      dayBoundary: 'midnight',
      ...(includeLuckCycle ? { gender: birth.luckCycleGender } : {}),
    });
  }

  private toSnapshot(
    birth: BirthInput,
    normalizedDates: ReturnType<SajuChartCalculator['normalizeDates']>,
    result: FourPillarsDetail,
    calculatedAt: Date,
  ): SajuChartSnapshotV1 {
    const isUnknownTime = birth.time.precision === 'unknown';
    const includedPillars = isUnknownTime
      ? [result.year, result.month, result.day]
      : [result.year, result.month, result.day, result.hour];
    const counts: SajuChartSnapshotV1['elementDistribution']['counts'] = {
      wood: 0,
      fire: 0,
      earth: 0,
      metal: 0,
      water: 0,
    };

    for (const pillar of includedPillars) {
      counts[FIVE_ELEMENT_CODES[getHeavenlyStemElement(pillar.heavenlyStem)]] +=
        1;
      counts[
        FIVE_ELEMENT_CODES[getEarthlyBranchElement(pillar.earthlyBranch)]
      ] += 1;
    }

    return {
      schemaVersion: SAJU_CHART_SCHEMA_VERSION,
      quality: isUnknownTime ? 'partial' : 'complete',
      calculation: {
        engine: SAJU_ENGINE_NAME,
        engineVersion: SAJU_ENGINE_VERSION,
        policyVersion: SAJU_POLICY_VERSION,
        calculatedAt: calculatedAt.toISOString(),
      },
      normalizedBirth: {
        calendarType: birth.calendarType,
        inputDate: { ...birth.date },
        solarDate: normalizedDates.solarDate,
        lunarDate: normalizedDates.lunarDate,
        time: birth.time,
        luckCycleGender: birth.luckCycleGender,
        timezone: SAJU_TIMEZONE,
      },
      pillars: {
        year: toNatalPillar(result.year, result.tenGods.year),
        month: toNatalPillar(result.month, result.tenGods.month),
        day: toNatalPillar(result.day, result.tenGods.day),
        hour: isUnknownTime
          ? null
          : toNatalPillar(result.hour, result.tenGods.hour),
      },
      dayMaster: toStemSymbol(result.day.heavenlyStem),
      elementDistribution: {
        method: 'eight-symbol-count-v1',
        totalSymbols: isUnknownTime ? 6 : 8,
        counts,
      },
      voidBranches: result.voidBranches.map((branch) => ({
        code: EARTHLY_BRANCH_CODES[branch],
        korean: branch,
        hanja: EARTHLY_BRANCHES_HANJA[EARTHLY_BRANCHES.indexOf(branch)],
      })),
      luckCycle:
        isUnknownTime || !result.luckPillars
          ? null
          : {
              direction: result.luckPillars.forward ? 'forward' : 'backward',
              start: {
                roundedAge: result.luckPillars.startAge,
                years: result.luckPillars.startYears,
                months: result.luckPillars.startMonths,
                days: result.luckPillars.startDays,
              },
              items: result.luckPillars.pillars.map((luckPillar, index) => ({
                sequence: index + 1,
                startAge: luckPillar.age,
                ganji: toGanji(luckPillar.pillar),
              })),
            },
      warnings: isUnknownTime
        ? [
            {
              code: 'birth_time_unknown',
              message: '출생 시각을 몰라 시주를 제외한 6자로 계산했습니다.',
            },
            {
              code: 'luck_cycle_unavailable',
              message: '출생 시각이 없어 대운 계산 결과를 제공하지 않습니다.',
            },
          ]
        : [],
    };
  }
}
