import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import type {
  AuthPrincipal,
  AuthenticatedRequest,
} from '../auth/auth-principal.js';
import { AccountWithdrawalService } from './account-withdrawal.service.js';
import { AccountWithdrawalRateLimitGuard } from './account-withdrawal-rate-limit.guard.js';
import {
  AccountWithdrawalDataSchema,
  AccountWithdrawalRequestSchema,
  type AccountWithdrawalRequest,
} from './account-withdrawal.contract.js';
import { CurrentAuthPrincipal } from '../auth/current-auth-principal.decorator.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import {
  CompleteRegistrationRequestSchema,
  CurrentUserDataSchema,
  type CompleteRegistrationRequest,
  type CurrentUserData,
} from './user.contract.js';
import { UsersService } from './users.service.js';

@Controller({ path: 'users/me', version: '1' })
@UseGuards(SupabaseAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly withdrawals: AccountWithdrawalService,
  ) {}

  @Delete()
  @UseGuards(AccountWithdrawalRateLimitGuard)
  @ResponseContract({
    message: '회원 탈퇴 처리 상태를 확인했습니다.',
    schema: AccountWithdrawalDataSchema,
  })
  async withdraw(
    @Req() request: AuthenticatedRequest,
    @Body(new ZodValidationPipe(AccountWithdrawalRequestSchema))
    _body: AccountWithdrawalRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.withdrawals.withdraw(
      request.authPrincipal.subject,
      request.authAccessToken,
    );
    response.status(result.status === 'completed' ? 200 : 202);
    return result;
  }

  @Get()
  @ResponseContract({
    message: '사용자 정보를 조회했습니다.',
    schema: CurrentUserDataSchema,
  })
  getCurrentUser(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
  ): Promise<CurrentUserData> {
    return this.usersService.getCurrentUser(principal.subject);
  }

  @Put('registration')
  @ResponseContract({
    message: '가입 확인을 완료했습니다.',
    schema: CurrentUserDataSchema,
  })
  completeRegistration(
    @Req() httpRequest: AuthenticatedRequest,
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CompleteRegistrationRequestSchema))
    request: CompleteRegistrationRequest,
  ): Promise<CurrentUserData> {
    return this.usersService.completeRegistration(
      principal.subject,
      principal.displayName,
      request,
      httpRequest.authAccessToken,
    );
  }
}
