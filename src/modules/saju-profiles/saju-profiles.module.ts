import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SajuChartCalculator } from './saju-chart-calculator.js';
import { SajuProfilesController } from './saju-profiles.controller.js';
import { SajuProfilesService } from './saju-profiles.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SajuProfilesController],
  providers: [SajuProfilesService, SajuChartCalculator],
})
export class SajuProfilesModule {}
