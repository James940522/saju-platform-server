import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SajuProfilesService } from '../saju-profiles/index.js';
import { KieWealthRankingProvider } from './infrastructure/kie-wealth-ranking.provider.js';
import { KasiCalendarProvider } from './infrastructure/kasi-calendar.provider.js';
import { buildWealthRankingContext } from './wealth-ranking-context.js';
import type { CreateWealthRankingRequest } from './wealth-ranking.contract.js';
import { mapWealthRankingResult } from './wealth-ranking-result.js';

@Injectable()
export class WealthRankingService {
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(SajuProfilesService) private readonly profiles: SajuProfilesService,
    @Inject(KieWealthRankingProvider)
    private readonly provider: KieWealthRankingProvider,
    @Inject(KasiCalendarProvider)
    private readonly calendar: KasiCalendarProvider,
  ) {}

  async create(authSubject: string, request: CreateWealthRankingRequest) {
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
    try {
      const charts = await this.profiles.getOwnedReadingCharts(
        authSubject,
        request.chartIds,
      );
      const verifications = await Promise.all(
        charts.map(
          async (chart) =>
            [
              chart.chartId,
              await this.calendar.verify(chart.snapshot),
            ] as const,
        ),
      );
      const context = buildWealthRankingContext(charts, new Map(verifications));
      const output = await this.provider.generate(context);
      // Do not return a result if the user withdrew or a participant was deleted
      // while the external request was running. No DB transaction spans the AI call.
      const currentCharts = await this.profiles.getOwnedReadingCharts(
        authSubject,
        request.chartIds,
      );
      return mapWealthRankingResult(output, context, currentCharts);
    } finally {
      this.inFlight.delete(authSubject);
    }
  }
}
