import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { HealthDataSchema, type HealthData } from './health.contract.js';
import { HealthService } from './health.service.js';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ResponseContract({
    message: '서비스가 정상적으로 동작 중입니다.',
    schema: HealthDataSchema,
  })
  getStatus(): HealthData {
    return this.healthService.getStatus();
  }
}
