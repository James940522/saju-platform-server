import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../dist/config/environment.schema.js';
import { aiModelConfig } from '../dist/config/ai-model.config.js';
import { SajuChartCalculator } from '../dist/modules/saju-profiles/saju-chart-calculator.js';
import { KasiCalendarProvider } from '../dist/modules/readings/infrastructure/kasi-calendar.provider.js';
import { KasiSolarTermsProvider } from '../dist/modules/readings/infrastructure/kasi-solar-terms.provider.js';
import { KieWealthRankingProvider } from '../dist/modules/readings/infrastructure/kie-wealth-ranking.provider.js';
import { buildWealthRankingContext } from '../dist/modules/readings/wealth-ranking-context.js';
import { mapWealthRankingResult } from '../dist/modules/readings/wealth-ranking-result.js';
import { getWealthRankingFailureDiagnostic } from '../dist/modules/readings/wealth-ranking-failure.js';
import { WealthRankingDeadline } from '../dist/modules/readings/wealth-ranking-deadline.js';
import { WEALTH_RANKING_JOB_TIMEOUT_MS } from '../dist/config/wealth-ranking-runtime.config.js';
import { renderWealthComparison } from '../dist/modules/readings/wealth-ranking-comparison.js';

// Manual, networked smoke check. No database or real user profiles are accessed.
// Optional --with-ai performs exactly one billable generation with synthetic data.
try {
  const checkStarted = Date.now();
  const count = Number(
    process.argv
      .find((arg) => arg.startsWith('--participants='))
      ?.split('=')[1] ?? 2,
  );
  if (!Number.isInteger(count) || count < 2 || count > 5)
    throw new Error('Invalid participant count');
  const mixedTime = process.argv.includes('--unknown-time');
  const environment = validateEnvironment({
    ...parse(readFileSync(new URL('../.env', import.meta.url))),
    ...process.env,
  });
  const config = new ConfigService(environment);
  const calculator = new SajuChartCalculator();
  const charts = [7, 21, 27, 9, 15].slice(0, count).map((day, index) => ({
    chartId: `${index}67410a4-7bed-4901-ab62-faf700827f4a`,
    displayName: `검증용 가상인물 ${index + 1}`,
    snapshot: calculator.calculate({
      calendarType: 'solar',
      isLeapMonth: false,
      date: { year: 2019, month: 3, day },
      time:
        mixedTime && index === count - 1
          ? { precision: 'unknown' }
          : { precision: 'exact', hour: 12, minute: 0 },
      luckCycleGender: 'male',
    }).snapshot,
  }));
  const calendar = new KasiCalendarProvider(config);
  const terms = new KasiSolarTermsProvider(config);
  const checks = await Promise.all(
    charts.map(async (chart) => {
      const [lunar, solar] = await Promise.all([
        calendar.verify(chart.snapshot),
        terms.verify(chart.snapshot),
      ]);
      return { chartId: chart.chartId, lunar, solar };
    }),
  );
  console.log(
    JSON.stringify({
      calendar: checks.map(({ lunar }) => lunar),
      solarTerms: checks.map(({ solar }) => solar.status),
    }),
  );
  const context = buildWealthRankingContext(
    charts,
    new Map(checks.map(({ chartId, lunar }) => [chartId, lunar])),
    new Map(checks.map(({ chartId, solar }) => [chartId, solar])),
  );
  console.log(
    JSON.stringify({
      participants: context.length,
      fortuneTellerAnalysis: context.map(({ fortuneTellerAnalysis }) => ({
        policyVersion: fortuneTellerAnalysis.policyVersion,
        implementation: fortuneTellerAnalysis.implementation,
        packageVersion: fortuneTellerAnalysis.packageVersion,
        status: fortuneTellerAnalysis.status,
        pillarsUsed: fortuneTellerAnalysis.pillarsUsed,
        excludedAnalyses: fortuneTellerAnalysis.excludedAnalyses,
      })),
      nativeWealthAnalysis: context.every(
        (entry) =>
          typeof entry.fortuneTellerAnalysis.wealth.summary === 'string',
      ),
    }),
  );
  if (process.argv.includes('--with-ai')) {
    const started = Date.now();
    const provider = new KieWealthRankingProvider(config, aiModelConfig());
    const deadline = new WealthRankingDeadline(
      checkStarted + WEALTH_RANKING_JOB_TIMEOUT_MS,
    );
    try {
      const result = mapWealthRankingResult(
        await deadline.run(() =>
          provider.generate(context, 'synthetic-wealth-smoke', deadline),
        ),
        context,
        charts,
      );
      console.log(
        JSON.stringify(
          {
            ai: 'passed',
            elapsedMs: Date.now() - started,
            totalElapsedMs: Date.now() - checkStarted,
            promptVersion: result.promptVersion,
            ranks: result.ranking.map(({ rank }) => rank),
            fortunes: result.ranking.map(({ fortune }) => fortune),
            ...renderWealthComparison(
              result,
              new Map(
                charts.map(({ chartId, displayName }) => [
                  chartId,
                  displayName,
                ]),
              ),
            ),
            notice: result.notice,
          },
          null,
          2,
        ),
      );
    } finally {
      deadline.dispose();
      await provider.onModuleDestroy();
    }
  }
  if (
    checks.some(
      ({ lunar, solar }) => lunar !== 'matched' || solar.status !== 'matched',
    )
  )
    process.exitCode = 1;
} catch (error) {
  // Do not print exceptions, configuration values, URLs, or provider responses.
  console.error(
    JSON.stringify({
      status: 'failed',
      httpStatus:
        typeof error?.getStatus === 'function' ? error.getStatus() : null,
      diagnostic: getWealthRankingFailureDiagnostic(error),
    }),
  );
  process.exitCode = 1;
}
