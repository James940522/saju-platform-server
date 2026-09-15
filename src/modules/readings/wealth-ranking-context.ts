import type { SajuChartSnapshotV1 } from '../saju-profiles/index.js';
import type { CalendarVerificationStatus } from './infrastructure/kasi-calendar.provider.js';
import { analyzeFortuneteller } from './infrastructure/fortuneteller-analysis.adapter.js';
// Previous local rules are commented out in archive/readings-reference-v1.
// import { analyzeFortunetellerReference } from './fortuneteller-analysis.js';
// import { analyzeWealthTraits } from './wealth-ranking-analysis.js';
import {
  solarTermVerification,
  type SolarTermVerification,
} from './saju-solar-term-verification.js';

export type WealthRankingChart = {
  chartId: string;
  displayName: string;
  snapshot: SajuChartSnapshotV1;
};

export function buildWealthRankingContext(
  charts: readonly WealthRankingChart[],
  calendarVerifications: ReadonlyMap<
    string,
    CalendarVerificationStatus
  > = new Map(),
  solarTermVerifications: ReadonlyMap<
    string,
    SolarTermVerification
  > = new Map(),
) {
  // Input order and names cannot influence the comparison. No birth dates,
  // names, account IDs, chart IDs or provider/library objects leave the server.
  return [...charts]
    .sort((a, b) => a.chartId.localeCompare(b.chartId))
    .map(({ chartId, snapshot }, index) => {
      const participantKey = `p${index + 1}`;
      const facts = (['year', 'month', 'day', 'hour'] as const).flatMap(
        (position) => {
          const pillar = snapshot.pillars[position];
          if (!pillar) return [];
          return (['stem', 'branch'] as const).map((symbol) => ({
            id: `${participantKey}.${position}.${symbol}`,
            position,
            symbol,
            korean: pillar[symbol].korean,
            element: pillar[symbol].element,
            yinYang: pillar[symbol].yinYang,
            tenGod: pillar.tenGods[symbol],
          }));
        },
      );
      const nativeAnalysis = analyzeFortuneteller(snapshot, participantKey);
      return {
        participantKey,
        quality: snapshot.quality,
        dayMaster: snapshot.dayMaster,
        facts,
        ...nativeAnalysis,
        calculationPolicy: {
          engine: snapshot.calculation.engine,
          engineVersion: snapshot.calculation.engineVersion,
          policyVersion: snapshot.calculation.policyVersion,
        },
        calendarVerification: {
          status: calendarVerifications.get(chartId) ?? 'disabled',
          scope: 'solar_lunar_date_and_leap_month' as const,
          pillarVerification: 'not_performed' as const,
        },
        solarTermVerification:
          solarTermVerifications.get(chartId) ??
          solarTermVerification('disabled'),
        elementDistribution: snapshot.elementDistribution,
        warningCodes: snapshot.warnings.map(({ code }) => code),
        periodContext: null,
      };
    });
}

export type WealthRankingContext = ReturnType<typeof buildWealthRankingContext>;
