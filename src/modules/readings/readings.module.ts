import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { aiModelConfig } from '../../config/ai-model.config.js';
import { AuthModule } from '../auth/auth.module.js';
import { SajuProfilesModule } from '../saju-profiles/index.js';
import { KieWealthRankingProvider } from './infrastructure/kie-wealth-ranking.provider.js';
import { KasiCalendarProvider } from './infrastructure/kasi-calendar.provider.js';
import { WealthRankingController } from './wealth-ranking.controller.js';
import { WealthRankingRateLimitGuard } from './wealth-ranking-rate-limit.guard.js';
import { WealthRankingService } from './wealth-ranking.service.js';

@Module({
  imports: [
    AuthModule,
    SajuProfilesModule,
    ConfigModule.forFeature(aiModelConfig),
  ],
  controllers: [WealthRankingController],
  providers: [
    WealthRankingService,
    KieWealthRankingProvider,
    KasiCalendarProvider,
    WealthRankingRateLimitGuard,
  ],
})
export class ReadingsModule {}
