import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SajuChartCalculator } from './saju-chart-calculator.js';
import { SajuChartPreviewController } from './saju-chart-preview.controller.js';
import { SajuChartPreviewRateLimitGuard } from './saju-chart-preview-rate-limit.guard.js';
import { SajuProfilesController } from './saju-profiles.controller.js';
import { SajuProfilesService } from './saju-profiles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SajuProfilesController, SajuChartPreviewController],
  providers: [
    SajuProfilesService,
    SajuChartCalculator,
    SajuChartPreviewRateLimitGuard,
  ],
  exports: [SajuProfilesService],
})
export class SajuProfilesModule {}
