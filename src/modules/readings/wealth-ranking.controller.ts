import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  getRequestId,
  type RequestWithId,
} from '../../common/http/request-id.middleware.js';
import { CurrentAuthPrincipal } from '../auth/current-auth-principal.decorator.js';
import type { AuthPrincipal } from '../auth/auth-principal.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import {
  CreateWealthRankingRequestSchema,
  WealthRankingDataSchema,
  type CreateWealthRankingRequest,
} from './wealth-ranking.contract.js';
import { WealthRankingRateLimitGuard } from './wealth-ranking-rate-limit.guard.js';
import { WealthRankingService } from './wealth-ranking.service.js';

@Controller({ path: 'readings/wealth-ranking', version: '1' })
@UseGuards(SupabaseAuthGuard, WealthRankingRateLimitGuard)
export class WealthRankingController {
  constructor(
    @Inject(WealthRankingService)
    private readonly service: WealthRankingService,
  ) {}

  @Post()
  @HttpCode(200)
  @ResponseContract({
    message: '재물운 랭킹을 생성했습니다.',
    schema: WealthRankingDataSchema,
  })
  create(
    @Req() httpRequest: RequestWithId,
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateWealthRankingRequestSchema))
    request: CreateWealthRankingRequest,
  ) {
    return this.service.create(
      principal.subject,
      request,
      getRequestId(httpRequest),
    );
  }
}
