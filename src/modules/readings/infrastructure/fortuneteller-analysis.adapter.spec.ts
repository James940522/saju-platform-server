import * as native from '@hoshin/saju-mcp-server';
import { wealthCharts } from '../../../../test/fixtures/wealth-ranking.fixture.js';
import { buildWealthRankingContext } from '../wealth-ranking-context.js';
import {
  buildWealthRankingMessages,
  WEALTH_RANKING_SYSTEM_PROMPT,
} from './wealth-ranking.prompt.js';
import {
  analyzeFortuneteller,
  mapFortunetellerInput,
} from './fortuneteller-analysis.adapter.js';

function emptyDistribution(): Record<native.TenGod, number> {
  return {
    비견: 0,
    겁재: 0,
    식신: 0,
    상관: 0,
    편재: 0,
    정재: 0,
    편관: 0,
    정관: 0,
    편인: 0,
    정인: 0,
  };
}

describe('Installed fortuneteller on saved charts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads the pinned library entry without exposing a second chart calculator or MCP entry', () => {
    expect(native.FORTUNETELLER_PACKAGE_VERSION).toBe('1.2.0-sunnyeo.1');
    expect(native.FORTUNETELLER_UPSTREAM_REVISION).toBe(
      '1a930ad54c5342b855222e3aa304809b0ed587d5',
    );
    expect(native).not.toHaveProperty('calculateSaju');
    expect(native).not.toHaveProperty('createMCPServer');
  });

  it('calls the actual full analysis functions and preserves their results and the saved chart', () => {
    const chart = wealthCharts()[0]!;
    const before = structuredClone(chart.snapshot);
    const strength = vi.spyOn(native, 'analyzeDayMasterStrength');
    const yongsin = vi.spyOn(native, 'selectYongSin');
    const gyeokguk = vi.spyOn(native, 'determineGyeokGuk');
    const sinsal = vi.spyOn(native, 'findSinSals');
    const wealth = vi.spyOn(native, 'analyzeWealthFortune');
    const result = analyzeFortuneteller(
      chart.snapshot,
      'p1',
    ).fortuneTellerAnalysis;
    for (const call of [strength, yongsin, gyeokguk, sinsal, wealth])
      expect(call).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('complete');
    expect(result.pillarsUsed).toEqual(['year', 'month', 'day', 'hour']);
    expect(result.dayMasterStrength).toEqual(strength.mock.results[0]?.value);
    const nativeGyeokGuk = gyeokguk.mock.results[0]?.value;
    if (!nativeGyeokGuk) throw new Error('Expected original classification');
    expect(result.gyeokGuk).toEqual({
      gyeokGuk: nativeGyeokGuk.gyeokGuk,
      name: nativeGyeokGuk.name,
      hanja: nativeGyeokGuk.hanja,
      description: nativeGyeokGuk.description,
    });
    expect(result.yongSin).toMatchObject({
      primaryYongSin: expect.any(String),
      reasoning: expect.any(String),
    });
    expect(result.sinSals).toEqual(sinsal.mock.results[0]?.value);
    expect(result.wealth.referenceScore).toEqual(expect.any(Number));
    expect(result.excludedAnalyses).toEqual([]);
    expect(chart.snapshot).toEqual(before);
    expect(strength.mock.calls[0]?.[0].hour.stem).toBe(
      chart.snapshot.pillars.hour?.stem.korean,
    );
  });

  it('never calls time-dependent functions for a missing hour but still calls original wealth analysis', () => {
    const chart = wealthCharts()[1]!;
    const strength = vi.spyOn(native, 'analyzeDayMasterStrength');
    const yongsin = vi.spyOn(native, 'selectYongSin');
    const gyeokguk = vi.spyOn(native, 'determineGyeokGuk');
    const sinsal = vi.spyOn(native, 'findSinSals');
    const wealth = vi.spyOn(native, 'analyzeWealthFortune');
    const result = analyzeFortuneteller(chart.snapshot, 'p2');
    for (const call of [strength, yongsin, gyeokguk, sinsal])
      expect(call).not.toHaveBeenCalled();
    expect(wealth).toHaveBeenCalledTimes(1);
    expect(wealth.mock.calls[0]?.[0].hour).toBeNull();
    expect(wealth.mock.calls[0]?.[0].birthTime).toBe('');
    expect(result.fortuneTellerAnalysis).toMatchObject({
      status: 'partial',
      pillarsUsed: ['year', 'month', 'day'],
      dayMasterStrength: null,
      gyeokGuk: null,
      yongSin: null,
      sinSals: null,
      wealth: {
        referenceScore: null,
        summary: expect.stringContaining('부분 분석'),
      },
    });
    expect(
      result.hiddenStemFacts.some((fact) => fact.position === 'hour'),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain('p2.hour');
  });

  it('keeps nine full analyses when a tenth participant has no time', () => {
    const [known, unknown] = wealthCharts();
    if (!known || !unknown) throw new Error('Missing fixtures');
    const single = analyzeFortuneteller(known.snapshot, 'p1');
    const charts = Array.from({ length: 10 }, (_, index) => ({
      ...(index === 9 ? unknown : known),
      chartId: `${index}67410a4-7bed-4901-ab62-faf700827f4a`,
    }));
    const context = buildWealthRankingContext(charts);
    expect(
      context.filter((p) => p.fortuneTellerAnalysis.status === 'complete'),
    ).toHaveLength(9);
    expect(
      context.filter((p) => p.fortuneTellerAnalysis.status === 'partial'),
    ).toHaveLength(1);
    expect(context[0]?.fortuneTellerAnalysis).toEqual(
      single.fortuneTellerAnalysis,
    );
    expect(
      context
        .slice(0, 9)
        .every((p) => p.fortuneTellerAnalysis.yongSin !== null),
    ).toBe(true);
  });

  it('projects native full/partial results after KASI verification without metadata or private birth data', () => {
    const charts = wealthCharts();
    const context = buildWealthRankingContext(
      charts,
      new Map(charts.map((c) => [c.chartId, 'matched' as const])),
    );
    const payload = buildWealthRankingMessages(context)[1]!.content;
    expect(context[0]?.fortuneTellerAnalysis.implementation).toBe(
      'installed_upstream_fork',
    );
    expect(context[0]?.calendarVerification.status).toBe('matched');
    expect(payload).toContain('"yongSin":');
    expect(payload).toContain('"wealth":');
    expect(payload).not.toContain('"calendarVerification":');
    expect(payload).not.toMatch(
      /wealth-traits-v1|reviewed_rules_on_saved_snapshot|"wealthAnalysis"|birthDate|birthTime|birthCity|normalizedBirth|luckCycleGender/,
    );
    for (const chart of charts) {
      expect(payload).not.toContain(chart.chartId);
      expect(payload).not.toContain(chart.displayName);
    }
    expect(WEALTH_RANKING_SYSTEM_PROMPT).toContain(
      '한 사람의 시간 미상 때문에 다른 사람의 분석을 줄이지 않는다',
    );
    expect(WEALTH_RANKING_SYSTEM_PROMPT).toContain(
      '정보량 자체로 순위를 가감하지',
    );
  });

  it('makes every weighted observation traceable to its own real pillar and never counts the day-master position', () => {
    for (const participant of buildWealthRankingContext(wealthCharts())) {
      const ids = new Set(
        [...participant.facts, ...participant.hiddenStemFacts].map((f) => f.id),
      );
      const analysis = participant.fortuneTellerAnalysis;
      for (const id of analysis.tenGodDistribution.evidenceIds)
        expect(ids.has(id)).toBe(true);
      expect(analysis.tenGodDistribution.evidenceIds).not.toContain(
        `${participant.participantKey}.day.stem`,
      );
      const expectedTotal =
        analysis.pillarsUsed.length -
        1 +
        participant.hiddenStemFacts.reduce(
          (sum, fact) => sum + fact.seasonalWeight,
          0,
        );
      expect(
        Object.values(analysis.tenGodDistribution.counts).reduce(
          (sum, value) => sum + value,
          0,
        ),
      ).toBeCloseTo(expectedTotal);
    }
  });

  it('rejects mismatched time metadata before any original analysis is called', () => {
    const chart = wealthCharts()[0]!;
    chart.snapshot.pillars.hour = null;
    const wealth = vi.spyOn(native, 'analyzeWealthFortune');
    expect(() => analyzeFortuneteller(chart.snapshot, 'p1')).toThrow(
      'Inconsistent saved chart',
    );
    expect(wealth).not.toHaveBeenCalled();
  });
});

describe('Reviewed upstream patches', () => {
  it.each([
    ['인', 0],
    ['묘', 1],
    ['진', 2],
    ['사', 3],
    ['오', 4],
    ['미', 5],
    ['신', 6],
    ['유', 7],
    ['술', 8],
    ['해', 9],
    ['자', 10],
    ['축', 11],
  ] as const)(
    'aligns the %s month command with the original 寅-based index %s',
    (branch, index) =>
      expect(
        native.calculateJiJangGanStrength(branch, index).primary.strength,
      ).toBe(90),
  );

  it('keeps identical stems as peers at other positions and inside hidden stems', () => {
    const input = mapFortunetellerInput(wealthCharts()[0]!.snapshot);
    if (!input.hour) throw new Error('Expected known hour');
    input.year.stem = input.day.stem;
    input.month.stem = input.day.stem;
    input.hour.stem = input.day.stem;
    const hidden = { primary: { stem: input.day.stem, strength: 90 } };
    input.jiJangGan = {
      year: hidden,
      month: hidden,
      day: hidden,
      hour: hidden,
    };
    expect(native.calculateTenGodsDistribution(input).비견).toBeCloseTo(6.6);
    input.hour = null;
    // Even stale hour weights must never be counted when the hour is missing.
    expect(native.calculateTenGodsDistribution(input).비견).toBeCloseTo(4.7);
  });

  it.each([
    [0, 60],
    [0.5, 70],
    [1, 75],
    [1.5, 75],
    [2, 85],
  ] as const)(
    'handles fractional peer weight %s without claiming positive evidence is absent',
    (peerWeight, expectedScore) => {
      const input = mapFortunetellerInput(wealthCharts()[0]!.snapshot);
      if (!input.hour) throw new Error('Expected known hour');
      const result = native.analyzeDayMasterStrength({
        ...input,
        hour: input.hour,
        jiJangGan: undefined,
        wolRyeong: {
          strength: 'medium',
          isDeukRyeong: false,
          reason: 'synthetic branch fixture',
        },
        tenGodsDistribution: { ...emptyDistribution(), 겁재: peerWeight },
      });
      expect(result.score).toBe(expectedScore);
      if (peerWeight > 0) expect(result.analysis).not.toContain('비겁이 없어');
    },
  );

  it('limits zero observed wealth to the partial scope', () => {
    const input = mapFortunetellerInput(wealthCharts()[1]!.snapshot);
    input.wuxingCount[native.getControlledElement(input.day.stemElement)] = 0;
    input.tenGodsDistribution = emptyDistribution();
    const result = native.analyzeWealthFortune(input);
    expect(result.summary).toContain('부분 분석');
    expect(result.details.negative.join(' ')).toContain(
      '전체 원국의 부재를 뜻하지 않습니다',
    );
    expect(result.details.negative.join(' ')).not.toContain(
      '정재가 없어 안정적이고',
    );
  });

  it('preserves leap-month metadata locally without altering the saved pillars', () => {
    const snapshot = wealthCharts()[0]!.snapshot;
    snapshot.normalizedBirth.calendarType = 'lunar';
    snapshot.normalizedBirth.lunarDate.isLeapMonth = true;
    const input = mapFortunetellerInput(snapshot);
    expect(input.calendar).toBe('lunar');
    expect(input.isLeapMonth).toBe(true);
    const result = analyzeFortuneteller(snapshot, 'p1');
    expect(
      result.fortuneTellerAnalysis.yongSin?.recommendations.cautions,
    ).toEqual(expect.any(Array));
    expect(JSON.stringify(result)).not.toContain('birthDate');
    expect(mapFortunetellerInput(snapshot)).toEqual(input);
  });
});
