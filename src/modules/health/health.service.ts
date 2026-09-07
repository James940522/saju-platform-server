import { Injectable } from '@nestjs/common';
import type { HealthData } from './health.contract.js';

@Injectable()
export class HealthService {
  getStatus(): HealthData {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
