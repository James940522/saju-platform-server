import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import {
  getRequestId,
  type RequestWithId,
} from '../../common/http/request-id.middleware.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentAuthPrincipal } from '../auth/current-auth-principal.decorator.js';
import type { AuthPrincipal } from '../auth/auth-principal.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import {
  CreateReadingJobSchema,
  ReadingJobDataSchema,
  ReadingJobParamsSchema,
  ReadingJobsDataSchema,
  ReadingJobsQuerySchema,
  ReadingRequestKeySchema,
  type CreateReadingJob,
  type ReadingJobsQuery,
} from './reading-job.contract.js';
import { ReadingJobsService } from './reading-jobs.service.js';

@Controller({ path: 'reading-jobs', version: '1' })
@UseGuards(SupabaseAuthGuard)
export class ReadingJobsController {
  constructor(private readonly jobs: ReadingJobsService) {}

  @Post()
  @HttpCode(202)
  @ResponseContract({
    message: '풀이 요청을 접수했습니다.',
    schema: ReadingJobDataSchema,
  })
  create(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateReadingJobSchema)) body: CreateReadingJob,
    @Headers('idempotency-key') key: unknown,
    @Req() request: RequestWithId,
  ) {
    return this.jobs.create(
      principal.subject,
      body,
      new ZodValidationPipe(ReadingRequestKeySchema).transform(key),
      getRequestId(request),
    );
  }

  @Get()
  @ResponseContract({
    message: '내 풀이 목록을 조회했습니다.',
    schema: ReadingJobsDataSchema,
  })
  findAll(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Query(new ZodValidationPipe(ReadingJobsQuerySchema))
    query: ReadingJobsQuery,
  ) {
    return this.jobs.findAll(principal.subject, query);
  }

  @Get(':jobId')
  @ResponseContract({
    message: '풀이 상태와 결과를 조회했습니다.',
    schema: ReadingJobDataSchema,
  })
  findOne(
    @CurrentAuthPrincipal() principal: AuthPrincipal,
    @Param(new ZodValidationPipe(ReadingJobParamsSchema))
    params: { jobId: string },
  ) {
    return this.jobs.findOne(principal.subject, params.jobId);
  }
}
