import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SajuProfilesService } from '../saju-profiles/index.js';
import { KieWealthRankingProvider } from './infrastructure/kie-wealth-ranking.provider.js';
import { KasiCalendarProvider } from './infrastructure/kasi-calendar.provider.js';
import { KasiSolarTermsProvider } from './infrastructure/kasi-solar-terms.provider.js';
import { buildWealthRankingContext } from './wealth-ranking-context.js';
import type { CreateWealthRankingRequest } from './wealth-ranking.contract.js';
import { mapWealthRankingResult } from './wealth-ranking-result.js';
import { getWealthRankingFailureDiagnostic } from './wealth-ranking-failure.js';
import { FORTUNETELLER_ANALYSIS_VERSION } from './infrastructure/fortuneteller-analysis.adapter.js';
import type { ReadingJobStage } from './reading-job.contract.js';
import { WealthRankingDeadline } from './wealth-ranking-deadline.js';

@Injectable()
export class WealthRankingService {
  private readonly logger = new Logger(WealthRankingService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(SajuProfilesService) private readonly profiles: SajuProfilesService,
    @Inject(KieWealthRankingProvider)
    private readonly provider: KieWealthRankingProvider,
    @Inject(KasiCalendarProvider)
    private readonly calendar: KasiCalendarProvider,
    @Inject(KasiSolarTermsProvider)
    private readonly solarTerms: KasiSolarTermsProvider,
  ) {}

  async create(
    authSubject: string,
    request: CreateWealthRankingRequest,
    requestId: string,
    onProgress?: (stage: ReadingJobStage) => Promise<void>,
    deadline?: WealthRankingDeadline,
  ) {
    const startedAt = performance.now();
    this.logger.log({
      event: 'wealth_ranking_started',
      requestId,
      participantCount: request.chartIds.length,
    });
    // Configuration check only. The first outbound Kie call is generate below.
    this.provider.assertAvailable();
    if (this.inFlight.has(authSubject)) {
      throw new ConflictException({
        message: '이미 재물운 랭킹을 생성하고 있습니다.',
        reason: 'READING_IN_PROGRESS',
      });
    }
    if (this.inFlight.size >= 4)
      throw new ServiceUnavailableException({ reason: 'READING_UNAVAILABLE' });
    this.inFlight.add(authSubject);
    const execution = deadline ?? new WealthRankingDeadline();
    let pipelineStage = 'load_owned_charts';
    try {
      return await execution.run(async () => {
        const charts = await this.profiles.getOwnedReadingCharts(
          authSubject,
          request.chartIds,
        );
        execution.remainingMs();
        this.logger.log({
          event: 'wealth_ranking_charts_loaded',
          requestId,
          source: 'manseryeok',
          mode: 'saved_snapshot',
          participantCount: charts.length,
          durationMs: Math.round(performance.now() - startedAt),
        });
        const referencesStartedAt = performance.now();
        pipelineStage = 'kasi_verification';
        this.logger.log({
          event: 'wealth_ranking_references_started',
          requestId,
        });
        const verifications = await Promise.all(
          charts.map(async (chart) => {
            const [calendar, solarTerms] = await Promise.all([
              this.calendar.verify(chart.snapshot, requestId),
              this.solarTerms.verify(chart.snapshot, requestId),
            ]);
            return { chartId: chart.chartId, calendar, solarTerms };
          }),
        );
        execution.remainingMs();
        this.logger.log({
          event: 'wealth_ranking_references_checked',
          requestId,
          durationMs: Math.round(performance.now() - referencesStartedAt),
          calendarStatuses: [
            ...new Set(verifications.map((item) => item.calendar)),
          ],
          solarTermStatuses: [
            ...new Set(verifications.map((item) => item.solarTerms.status)),
          ],
        });
        pipelineStage = 'server_analysis';
        const analysisStartedAt = performance.now();
        this.logger.log({
          event: 'wealth_ranking_analysis_started',
          requestId,
          source: 'fortuneteller',
          mode: 'installed_upstream_fork',
        });
        const context = buildWealthRankingContext(
          charts,
          new Map(
            verifications.map(({ chartId, calendar }) => [chartId, calendar]),
          ),
          new Map(
            verifications.map(({ chartId, solarTerms }) => [
              chartId,
              solarTerms,
            ]),
          ),
        );
        this.logger.log({
          event: 'wealth_ranking_analysis_completed',
          requestId,
          policyVersion: FORTUNETELLER_ANALYSIS_VERSION,
          participantCount: context.length,
          completeCount: context.filter(
            ({ fortuneTellerAnalysis }) =>
              fortuneTellerAnalysis.status === 'complete',
          ).length,
          partialCount: context.filter(
            ({ fortuneTellerAnalysis }) =>
              fortuneTellerAnalysis.status === 'partial',
          ).length,
          durationMs: Math.round(performance.now() - analysisStartedAt),
        });
        pipelineStage = 'ai_generation';
        const aiStartedAt = performance.now();
        this.logger.log({
          event: 'wealth_ranking_ai_started',
          requestId,
          preparationDurationMs: Math.round(performance.now() - startedAt),
        });
        await onProgress?.('interpreting');
        execution.remainingMs();
        const output = await this.provider.generate(
          context,
          requestId,
          execution,
        );
        execution.remainingMs();
        this.logger.log({
          event: 'wealth_ranking_ai_received',
          requestId,
          durationMs: Math.round(performance.now() - aiStartedAt),
        });
        // Do not return a result if the user withdrew or a participant was deleted
        // while the external request was running. No DB transaction spans the AI call.
        pipelineStage = 'recheck_ownership';
        await onProgress?.('saving');
        execution.remainingMs();
        const currentCharts = await this.profiles.getOwnedReadingCharts(
          authSubject,
          request.chartIds,
        );
        execution.remainingMs();
        pipelineStage = 'validate_result';
        const result = mapWealthRankingResult(output, context, currentCharts);
        this.logger.log({
          event: 'wealth_ranking_completed',
          requestId,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return result;
      });
    } catch (error: unknown) {
      const diagnostic = getWealthRankingFailureDiagnostic(error);
      this.logger.error({
        event: 'wealth_ranking_failed',
        method: 'POST',
        route: onProgress ? '/v1/reading-jobs' : '/v1/readings/wealth-ranking',
        requestId,
        pipelineStage,
        durationMs: Math.round(performance.now() - startedAt),
        ...(diagnostic ?? {
          reason: 'READING_REQUEST_FAILED',
          stage: pipelineStage,
          status: error instanceof HttpException ? error.getStatus() : 500,
        }),
      });
      throw error;
    } finally {
      if (!deadline) execution.dispose();
      this.inFlight.delete(authSubject);
    }
  }
}
