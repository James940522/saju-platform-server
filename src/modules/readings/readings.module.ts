import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { aiModelConfig } from '../../config/ai-model.config.js';
import { AuthModule } from '../auth/auth.module.js';
import { SajuProfilesModule } from '../saju-profiles/index.js';
import { KieWealthRankingProvider } from './infrastructure/kie-wealth-ranking.provider.js';
import { KasiCalendarProvider } from './infrastructure/kasi-calendar.provider.js';
import { KasiSolarTermsProvider } from './infrastructure/kasi-solar-terms.provider.js';
import { WealthRankingController } from './wealth-ranking.controller.js';
import { WealthRankingRateLimitGuard } from './wealth-ranking-rate-limit.guard.js';
import { WealthRankingService } from './wealth-ranking.service.js';
import { ReadingJobsController } from './reading-jobs.controller.js';
import { ReadingJobsService } from './reading-jobs.service.js';
import { ReadingJobsWorker } from './reading-jobs.worker.js';
import { ReadingResultsController } from './reading-results.controller.js';

@Module({
  imports: [
    AuthModule,
    SajuProfilesModule,
    ConfigModule.forFeature(aiModelConfig),
  ],
  controllers: [
    WealthRankingController,
    ReadingJobsController,
    ReadingResultsController,
  ],
  providers: [
    ReadingJobsService,
    ReadingJobsWorker,
    WealthRankingService,
    KieWealthRankingProvider,
    KasiCalendarProvider,
    KasiSolarTermsProvider,
    WealthRankingRateLimitGuard,
  ],
})
export class ReadingsModule {}
