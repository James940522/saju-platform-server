import { Controller, Get, Param } from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { ReadingJobParamsSchema } from './reading-job.contract.js';
import { ReadingResultDataSchema } from './reading-result.contract.js';
import { ReadingJobsService } from './reading-jobs.service.js';

// All existing job UUIDs are public for this minimal result view. Creation,
// personal history and the detailed owner endpoint keep their auth guards.
@Controller({ path: 'reading-results', version: '1' })
export class ReadingResultsController {
  constructor(private readonly jobs: ReadingJobsService) {}

  @Get(':jobId')
  @ResponseContract({
    message: '풀이 결과를 조회했습니다.',
    schema: ReadingResultDataSchema,
  })
  findOne(
    @Param(new ZodValidationPipe(ReadingJobParamsSchema))
    params: {
      jobId: string;
    },
  ) {
    return this.jobs.findPublicResult(params.jobId);
  }
}
