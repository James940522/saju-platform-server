import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import type { AuthPrincipal } from '../auth/auth-principal.js';
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
  constructor(private readonly usersService: UsersService) {}

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
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CompleteRegistrationRequestSchema))
    request: CompleteRegistrationRequest,
  ): Promise<CurrentUserData> {
    return this.usersService.completeRegistration(
      principal.subject,
      principal.displayName,
      request,
    );
  }
}
