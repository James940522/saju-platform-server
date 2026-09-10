import { SajuChartSnapshotV1Schema } from './saju-profile.contract.js';
import { SajuChartCalculator } from './saju-chart-calculator.js';

const CALCULATED_AT = new Date('2026-09-09T00:00:00.000Z');

describe('SajuChartCalculator', () => {
  const calculator = new SajuChartCalculator();

  it('maps an exact solar birth input to a versioned snapshot', () => {
    const result = calculator.calculate(
      {
        calendarType: 'solar',
        isLeapMonth: false,
        date: { year: 1992, month: 10, day: 24 },
        time: { precision: 'exact', hour: 5, minute: 30 },
        luckCycleGender: 'male',
      },
      CALCULATED_AT,
    );

    expect(SajuChartSnapshotV1Schema.parse(result.snapshot)).toEqual(
      result.snapshot,
    );
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.snapshot).toMatchObject({
      schemaVersion: 1,
      quality: 'complete',
      calculation: {
        engine: 'manseryeok',
        engineVersion: '2.0.0',
        policyVersion: 'kr-kst-midnight-v1',
        calculatedAt: CALCULATED_AT.toISOString(),
      },
      normalizedBirth: {
        solarDate: { year: 1992, month: 10, day: 24 },
        lunarDate: {
          year: 1992,
          month: 9,
          day: 29,
          isLeapMonth: false,
        },
        timezone: 'Asia/Seoul',
      },
      pillars: {
        year: { korean: '임신', hanja: '壬申' },
        month: { korean: '경술', hanja: '庚戌' },
        day: { korean: '계유', hanja: '癸酉' },
        hour: { korean: '을묘', hanja: '乙卯' },
      },
      dayMaster: { code: 'gye', korean: '계', hanja: '癸' },
      elementDistribution: {
        method: 'eight-symbol-count-v1',
        totalSymbols: 8,
        counts: { wood: 2, fire: 0, earth: 1, metal: 3, water: 2 },
      },
      warnings: [],
    });
    expect(result.snapshot.luckCycle).not.toBeNull();
  });

  it('normalizes an equivalent lunar date to the same solar date and pillars', () => {
    const result = calculator.calculate(
      {
        calendarType: 'lunar',
        isLeapMonth: false,
        date: { year: 1992, month: 9, day: 29 },
        time: { precision: 'exact', hour: 5, minute: 30 },
        luckCycleGender: 'female',
      },
      CALCULATED_AT,
    );

    expect(result.snapshot.normalizedBirth.solarDate).toEqual({
      year: 1992,
      month: 10,
      day: 24,
    });
    expect(result.snapshot.pillars).toMatchObject({
      year: { korean: '임신' },
      month: { korean: '경술' },
      day: { korean: '계유' },
      hour: { korean: '을묘' },
    });
  });

  it('returns a partial six-symbol snapshot when birth time is unknown', () => {
    const result = calculator.calculate(
      {
        calendarType: 'solar',
        isLeapMonth: false,
        date: { year: 1992, month: 10, day: 24 },
        time: { precision: 'unknown' },
        luckCycleGender: 'male',
      },
      CALCULATED_AT,
    );

    expect(result.snapshot.quality).toBe('partial');
    expect(result.snapshot.pillars.hour).toBeNull();
    expect(result.snapshot.elementDistribution.totalSymbols).toBe(6);
    expect(result.snapshot.luckCycle).toBeNull();
    expect(result.snapshot.warnings.map((warning) => warning.code)).toEqual([
      'birth_time_unknown',
      'luck_cycle_unavailable',
    ]);
  });

  it('requires time when a solar-term boundary changes a date pillar', () => {
    expect(() =>
      calculator.calculate({
        calendarType: 'solar',
        isLeapMonth: false,
        date: { year: 2024, month: 2, day: 4 },
        time: { precision: 'unknown' },
        luckCycleGender: 'male',
      }),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({
          reason: 'BIRTH_TIME_REQUIRED_ON_BOUNDARY_DATE',
        }),
      }),
    );
  });

  it('returns a stable error for an invalid solar date', () => {
    expect(() =>
      calculator.calculate({
        calendarType: 'solar',
        isLeapMonth: false,
        date: { year: 2023, month: 2, day: 29 },
        time: { precision: 'exact', hour: 12, minute: 0 },
        luckCycleGender: 'female',
      }),
    ).toThrowError(
      expect.objectContaining({
        response: expect.objectContaining({ reason: 'INVALID_SOLAR_DATE' }),
      }),
    );
  });
});
