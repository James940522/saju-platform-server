import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import type { AuthPrincipal } from '../auth/auth-principal.js';
import { CurrentAuthPrincipal } from '../auth/current-auth-principal.decorator.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import {
  CreateSajuProfileDataSchema,
  CreateSajuProfileRequestSchema,
  DeleteSajuProfileDataSchema,
  GetSajuProfileDataSchema,
  GetSajuProfilesDataSchema,
  SajuProfileParamsSchema,
  UpdateSajuProfileDataSchema,
  UpdateSajuProfileRequestSchema,
  type CreateSajuProfileData,
  type CreateSajuProfileRequest,
  type DeleteSajuProfileData,
  type GetSajuProfileData,
  type GetSajuProfilesData,
  type SajuProfileParams,
  type UpdateSajuProfileData,
  type UpdateSajuProfileRequest,
} from './saju-profile.contract.js';
import { SajuProfilesService } from './saju-profiles.service.js';

@Controller({ path: 'saju-profiles', version: '1' })
@UseGuards(SupabaseAuthGuard)
export class SajuProfilesController {
  constructor(private readonly sajuProfilesService: SajuProfilesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseContract({
    message: '사주 프로필을 등록했습니다.',
    schema: CreateSajuProfileDataSchema,
  })
  create(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateSajuProfileRequestSchema))
    request: CreateSajuProfileRequest,
  ): Promise<CreateSajuProfileData> {
    return this.sajuProfilesService.create(principal.subject, request);
  }

  @Get()
  @ResponseContract({
    message: '사주 프로필 목록을 조회했습니다.',
    schema: GetSajuProfilesDataSchema,
  })
  findAll(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
  ): Promise<GetSajuProfilesData> {
    return this.sajuProfilesService.findAll(principal.subject);
  }

  @Get(':profileId')
  @ResponseContract({
    message: '사주 프로필을 조회했습니다.',
    schema: GetSajuProfileDataSchema,
  })
  findOne(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Param(new ZodValidationPipe(SajuProfileParamsSchema))
    params: SajuProfileParams,
  ): Promise<GetSajuProfileData> {
    return this.sajuProfilesService.findOne(
      principal.subject,
      params.profileId,
    );
  }

  @Patch(':profileId')
  @ResponseContract({
    message: '사주 프로필을 수정했습니다.',
    schema: UpdateSajuProfileDataSchema,
  })
  update(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Param(new ZodValidationPipe(SajuProfileParamsSchema))
    params: SajuProfileParams,
    @Body(new ZodValidationPipe(UpdateSajuProfileRequestSchema))
    request: UpdateSajuProfileRequest,
  ): Promise<UpdateSajuProfileData> {
    return this.sajuProfilesService.update(
      principal.subject,
      params.profileId,
      request,
    );
  }

  @Delete(':profileId')
  @ResponseContract({
    message: '사주 프로필과 연결된 만세력 데이터를 삭제했습니다.',
    schema: DeleteSajuProfileDataSchema,
  })
  remove(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Param(new ZodValidationPipe(SajuProfileParamsSchema))
    params: SajuProfileParams,
  ): Promise<DeleteSajuProfileData> {
    return this.sajuProfilesService.remove(principal.subject, params.profileId);
  }
}
