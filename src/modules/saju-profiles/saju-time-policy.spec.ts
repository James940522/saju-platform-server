import {
  calculateFourPillars,
  type BirthInfo,
  type FiveElement,
} from 'manseryeok';
import { SajuChartCalculator } from './saju-chart-calculator.js';

// Reference fixture for the service's Korean mean-solar-time convention.
const BOUNDARY_BIRTH: BirthInfo = {
  year: 1965,
  month: 3,
  day: 10,
  hour: 7,
  minute: 0,
  isLunar: true,
  isLeapMonth: false,
  dayBoundary: 'midnight',
};

describe('Hour-pillar time policy comparison', () => {
  it('matches the shared reference core fields when both inputs have unknown time', () => {
    const { snapshot } = new SajuChartCalculator().calculate({
      calendarType: 'lunar',
      isLeapMonth: false,
      date: { year: 1965, month: 3, day: 10 },
      time: { precision: 'unknown' },
      luckCycleGender: 'female',
    });

    // The supplied reference uses hour=-1 and hour pillar=null, not 07:00.
    // Its main branch god is the first item of each branchGods array.
    expect(snapshot).toMatchObject({
      quality: 'partial',
      normalizedBirth: { time: { precision: 'unknown' } },
      pillars: {
        year: {
          hanja: '乙巳',
          tenGods: { stem: 'bi_gyeon', branch: 'sang_gwan' },
        },
        month: {
          hanja: '庚辰',
          tenGods: { stem: 'jeong_gwan', branch: 'jeong_jae' },
        },
        day: {
          hanja: '乙未',
          tenGods: { stem: 'day_master', branch: 'pyeon_jae' },
        },
        hour: null,
      },
      dayMaster: { hanja: '乙', element: 'wood', yinYang: 'yin' },
      elementDistribution: {
        totalSymbols: 6,
        counts: { wood: 2, fire: 1, earth: 2, metal: 1, water: 0 },
      },
    });
    // The reference supplies a luck cycle for unknown time. Our current policy
    // deliberately omits it; the reference's substitute time is not provided.
    expect(snapshot.luckCycle).toBeNull();
  });

  it('matches the reference while preserving the recorded birth time', () => {
    const { snapshot } = new SajuChartCalculator().calculate({
      calendarType: 'lunar',
      isLeapMonth: false,
      date: { year: 1965, month: 3, day: 10 },
      time: { precision: 'exact', hour: 7, minute: 20 },
      luckCycleGender: 'female',
    });

    expect(snapshot).toMatchObject({
      calculation: { policyVersion: 'kr-mean-solar-midnight-v2' },
      normalizedBirth: {
        solarDate: { year: 1965, month: 4, day: 11 },
        time: { precision: 'exact', hour: 7, minute: 20 },
        timeCorrection: {
          method: 'korean_mean_solar',
          adjustmentMinutes: -30,
          correctedSolarDate: { year: 1965, month: 4, day: 11 },
          correctedTime: { hour: 6, minute: 50 },
        },
      },
      pillars: {
        year: { hanja: '乙巳' },
        month: { hanja: '庚辰' },
        day: { hanja: '乙未' },
        hour: {
          hanja: '己卯',
          tenGods: { stem: 'pyeon_jae', branch: 'bi_gyeon' },
        },
      },
      elementDistribution: {
        counts: { wood: 3, fire: 1, earth: 3, metal: 1, water: 0 },
      },
    });
    expect(snapshot.luckCycle?.start.roundedAge).toBe(8);
    expect(snapshot.luckCycle?.items.slice(0, 9)).toMatchObject(
      [
        '신사',
        '임오',
        '계미',
        '갑신',
        '을유',
        '병술',
        '정해',
        '무자',
        '기축',
      ].map((korean, index) => ({
        startAge: 8 + index * 10,
        ganji: { korean },
      })),
    );
  });

  it.each([
    { minute: 0, applyEquationOfTime: false },
    { minute: 0, applyEquationOfTime: true },
    { minute: 20, applyEquationOfTime: false },
    { minute: 20, applyEquationOfTime: true },
  ])(
    'reproduces the reference with longitude correction at minute $minute, EoT=$applyEquationOfTime',
    ({ minute, applyEquationOfTime }) => {
      const result = calculateFourPillars({
        ...BOUNDARY_BIRTH,
        minute,
        gender: 'female',
        trueSolarTime: {
          longitude: 127.5,
          applyEquationOfTime,
          applyHistoricalDst: true,
        },
      });

      expect(result.toObject()).toEqual({
        year: '을사',
        month: '경진',
        day: '을미',
        hour: '기묘',
      });
      expect(result.hourHanja).toBe('己卯');
      expect(result.tenGods.hour).toEqual({ stem: '편재', branch: '비견' });

      const counts: Record<FiveElement, number> = {
        목: 0,
        화: 0,
        토: 0,
        금: 0,
        수: 0,
      };
      for (const pair of [
        result.yearElement,
        result.monthElement,
        result.dayElement,
        result.hourElement,
      ]) {
        counts[pair.stem] += 1;
        counts[pair.branch] += 1;
      }
      expect(counts).toEqual({ 목: 3, 화: 1, 토: 3, 금: 1, 수: 0 });
      expect(result.luckPillars?.startAge).toBe(8);
      expect(result.luckPillars?.pillars.slice(0, 9)).toMatchObject(
        [
          '신사',
          '임오',
          '계미',
          '갑신',
          '을유',
          '병술',
          '정해',
          '무자',
          '기축',
        ].map((korean, index) => ({ age: 8 + index * 10, korean })),
      );
    },
  );

  it.each([
    { minute: 29, meanHour: '기묘', apparentHour: '기묘' },
    { minute: 30, meanHour: '경진', apparentHour: '기묘' },
    { minute: 32, meanHour: '경진', apparentHour: '경진' },
  ])(
    'distinguishes mean and apparent solar time at minute $minute',
    ({ minute, meanHour, apparentHour }) => {
      const calculate = (applyEquationOfTime: boolean) =>
        calculateFourPillars({
          ...BOUNDARY_BIRTH,
          minute,
          trueSolarTime: {
            longitude: 127.5,
            applyEquationOfTime,
            applyHistoricalDst: true,
          },
        });

      expect(calculate(false).hourString).toBe(meanHour);
      expect(calculate(true).hourString).toBe(apparentHour);
    },
  );
});
