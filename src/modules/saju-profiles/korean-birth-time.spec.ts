import { calculateFourPillars, getSolarTerm } from 'manseryeok';
import { SajuChartCalculator } from './saju-chart-calculator.js';
import {
  SajuChartSnapshotV1Schema,
  type BirthInput,
} from './saju-profile.contract.js';
import { resolveKoreanBirthTime } from './korean-birth-time.js';

const calculator = new SajuChartCalculator();
const birth = (
  date: BirthInput['date'],
  hour = 7,
  minute = 20,
): BirthInput => ({
  calendarType: 'solar',
  isLeapMonth: false,
  date,
  time: { precision: 'exact', hour, minute },
  luckCycleGender: 'female',
});

describe('Korean birth-time correction', () => {
  it.each([
    {
      year: 1910,
      month: 2,
      day: 1,
      offset: 510,
      adjustment: 0,
      hour: 7,
      minute: 20,
    },
    {
      year: 1955,
      month: 2,
      day: 1,
      offset: 510,
      adjustment: 0,
      hour: 7,
      minute: 20,
    },
    {
      year: 1955,
      month: 6,
      day: 1,
      offset: 570,
      adjustment: -60,
      hour: 6,
      minute: 20,
    },
    {
      year: 1965,
      month: 4,
      day: 11,
      offset: 540,
      adjustment: -30,
      hour: 6,
      minute: 50,
    },
    {
      year: 1988,
      month: 6,
      day: 1,
      offset: 600,
      adjustment: -90,
      hour: 5,
      minute: 50,
    },
  ])(
    'uses historical civil offset $offset at $year-$month-$day',
    ({ year, month, day, offset, adjustment, hour, minute }) => {
      const input = birth({ year, month, day });
      const { snapshot } = calculator.calculate(input);
      expect(SajuChartSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
      expect(snapshot.normalizedBirth).toMatchObject({
        time: input.time,
        timeCorrection: {
          civilUtcOffsetMinutes: offset,
          adjustmentMinutes: adjustment,
          correctedTime: { hour, minute },
        },
      });
      const library = calculateFourPillars({
        year,
        month,
        day,
        hour: 7,
        minute: 20,
        gender: 'female',
        dayBoundary: 'midnight',
        trueSolarTime: {
          longitude: 127.5,
          applyEquationOfTime: false,
          applyHistoricalDst: true,
        },
      });
      expect(snapshot.pillars).toMatchObject({
        year: { hanja: library.yearHanja },
        month: { hanja: library.monthHanja },
        day: { hanja: library.dayHanja },
        hour: { hanja: library.hourHanja },
      });
    },
  );

  it.each([
    { month: 5, day: 8, reason: 'NONEXISTENT_BIRTH_TIME' },
    { month: 10, day: 9, reason: 'AMBIGUOUS_BIRTH_TIME' },
  ])(
    'does not silently guess at the 1988 clock transition on $month-$day',
    ({ month, day, reason }) => {
      expect(() =>
        calculator.calculate(birth({ year: 1988, month, day }, 2, 30)),
      ).toThrowError(
        expect.objectContaining({
          response: expect.objectContaining({ reason }),
        }),
      );
    },
  );

  it('rolls the corrected date into the previous month without changing the input', () => {
    const { snapshot } = calculator.calculate(
      birth({ year: 2024, month: 8, day: 1 }, 0, 20),
    );
    expect(snapshot.normalizedBirth).toMatchObject({
      inputDate: { year: 2024, month: 8, day: 1 },
      solarDate: { year: 2024, month: 8, day: 1 },
      time: { precision: 'exact', hour: 0, minute: 20 },
      timeCorrection: {
        correctedSolarDate: { year: 2024, month: 7, day: 31 },
        correctedTime: { hour: 23, minute: 50 },
      },
    });
  });

  it.each([29, 30])(
    'switches the reported hour pillar at 07:$0 civil time',
    (minute) => {
      const { snapshot } = calculator.calculate(
        birth({ year: 1965, month: 4, day: 11 }, 7, minute),
      );
      expect(snapshot.pillars.hour?.hanja).toBe(
        minute === 29 ? '己卯' : '庚辰',
      );
    },
  );

  it('keeps the historical solar-term instant when applying daylight saving time', () => {
    const term = getSolarTerm(1988, 10); // June monthly boundary, UTC+10 civil time
    const civilMs = term.date.getTime() + 600 * 60_000;
    const before = new Date(civilMs - 60_000);
    const after = new Date(before.getTime() + 60_000);
    const calculateAt = (date: Date) =>
      calculator.calculate(
        birth(
          {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
          },
          date.getUTCHours(),
          date.getUTCMinutes(),
        ),
      ).snapshot;
    expect(calculateAt(before).pillars.month.hanja).not.toBe(
      calculateAt(after).pillars.month.hanja,
    );
  });

  it('does not invent a corrected time for unknown-time input', () => {
    const { snapshot } = calculator.calculate({
      ...birth({ year: 1965, month: 4, day: 11 }),
      time: { precision: 'unknown' },
    });
    expect(snapshot.normalizedBirth.timeCorrection).toMatchObject({
      civilUtcOffsetMinutes: null,
      adjustmentMinutes: null,
      correctedSolarDate: null,
      correctedTime: null,
    });
    expect(snapshot.warnings.map(({ code }) => code)).toContain(
      'day_boundary_uncertain',
    );
    expect(snapshot.pillars.hour).toBeNull();
  });

  it('identifies the pre-1908 fallback as an assumption', () => {
    const { snapshot } = calculator.calculate(
      birth({ year: 1900, month: 2, day: 1 }),
    );
    expect(snapshot.quality).toBe('partial');
    expect(snapshot.warnings.map(({ code }) => code)).toContain(
      'historical_time_assumed',
    );
    expect(
      resolveKoreanBirthTime({ year: 1900, month: 2, day: 1 }, 7, 20)
        .adjustmentMinutes,
    ).toBe(-30);
  });

  it('still accepts immutable v1 snapshots without correction metadata', () => {
    const { snapshot } = calculator.calculate(
      birth({ year: 1965, month: 4, day: 11 }),
    );
    snapshot.calculation.policyVersion = 'kr-kst-midnight-v1';
    delete snapshot.normalizedBirth.timeCorrection;
    delete snapshot.calculation.timeZoneDatabaseVersion;
    expect(SajuChartSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
  });
});
