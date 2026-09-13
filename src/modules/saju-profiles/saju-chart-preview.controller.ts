import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { SajuChartCalculator } from './saju-chart-calculator.js';
import { SajuChartPreviewRateLimitGuard } from './saju-chart-preview-rate-limit.guard.js';
import {
  PreviewSajuChartDataSchema,
  PreviewSajuChartRequestSchema,
  type PreviewSajuChartData,
  type PreviewSajuChartRequest,
} from './saju-chart-preview.contract.js';

@Controller({ path: 'saju-charts', version: '1' })
@UseGuards(SajuChartPreviewRateLimitGuard)
export class SajuChartPreviewController {
  constructor(
    @Inject(SajuChartCalculator)
    private readonly calculator: SajuChartCalculator,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ResponseContract({
    message: '만세력을 계산했습니다.',
    schema: PreviewSajuChartDataSchema,
  })
  preview(
    @Body(new ZodValidationPipe(PreviewSajuChartRequestSchema))
    request: PreviewSajuChartRequest,
  ): PreviewSajuChartData {
    const { snapshot } = this.calculator.calculate(request.birth);
    return { status: 'calculated', snapshot };
  }
}
