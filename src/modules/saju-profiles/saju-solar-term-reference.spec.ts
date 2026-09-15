import { SajuChartCalculator } from './saju-chart-calculator.js';
import { getSajuSolarTermReference } from './saju-solar-term-reference.js';

describe('Public snapshot reference for solar term verification', () => {
  const chart = (year: number, month: number, day: number, hour = 12) =>
    new SajuChartCalculator().calculate({
      calendarType: 'solar',
      isLeapMonth: false,
      date: { year, month, day },
      time: { precision: 'exact', hour, minute: 0 },
      luckCycleGender: 'male',
    }).snapshot;
  it.each([
    [2019, 3, 7, '2019-03-07T03:00:00.000Z'],
    [1958, 1, 15, '1958-01-15T03:30:00.000Z'],
    [1988, 7, 1, '1988-07-01T02:00:00.000Z'],
  ])(
    'preserves the recorded civil instant for %i/%i/%i',
    (year, month, day, expected) => {
      expect(
        new Date(
          getSajuSolarTermReference(chart(year, month, day))!.startMs,
        ).toISOString(),
      ).toBe(expected);
    },
  );
  it('uses the previous UTC year for early January KST', () => {
    const result = getSajuSolarTermReference(chart(2019, 1, 1, 0))!;
    expect(result.year).toBe(2019);
    expect(new Date(result.startMs).toISOString()).toBe(
      '2018-12-31T15:00:00.000Z',
    );
  });
  it('does not assume offsets or reinterpret an unknown day under changed timezone data', () => {
    const snapshot = chart(2019, 3, 7);
    delete snapshot.normalizedBirth.timeCorrection;
    expect(getSajuSolarTermReference(snapshot)).toBeNull();
    snapshot.normalizedBirth.time = { precision: 'unknown' };
    snapshot.calculation.timeZoneDatabaseVersion = 'different-version';
    expect(getSajuSolarTermReference(snapshot)).toBeNull();
  });
});
