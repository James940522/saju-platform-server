import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';
import {
  CreateWealthRankingRequestSchema,
  WealthRankingDataSchema,
} from './wealth-ranking.contract.js';

export const CreateReadingJobSchema = z
  .strictObject({
    productCode: z.literal('wealth-ranking'),
    chartIds: CreateWealthRankingRequestSchema.shape.chartIds,
  })
  .meta({ id: 'CreateReadingJob' });
export const ReadingRequestKeySchema = z.uuid().toLowerCase();
export const ReadingJobParamsSchema = z.strictObject({
  jobId: z.uuid().toLowerCase(),
});
export const ReadingJobsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().toLowerCase().optional(),
});
export const ReadingJobStageSchema = z.enum([
  'queued',
  'preparing',
  'interpreting',
  'saving',
  'finished',
]);
export const ReadingJobErrorSchema = z.strictObject({
  reason: z.enum([
    'READING_INTERRUPTED',
    'READING_TIMEOUT',
    'READING_FAILED',
    'SAJU_REFERENCE_CONFLICT',
  ]),
  message: z.string().min(1),
});
export const ReadingJobSummarySchema = z
  .strictObject({
    id: z.uuid(),
    productCode: z.literal('wealth-ranking'),
    status: z.enum(['queued', 'running', 'succeeded', 'failed']),
    stage: ReadingJobStageSchema,
    chartIds: CreateWealthRankingRequestSchema.shape.chartIds,
    participantNames: z.array(z.string().min(1).max(30)).min(2).max(5),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    error: ReadingJobErrorSchema.nullable(),
  })
  .meta({ id: 'ReadingJobSummary' });
export const ReadingJobDataSchema = ReadingJobSummarySchema.extend({
  result: WealthRankingDataSchema.nullable(),
})
  .superRefine((job, context) => {
    if (
      (job.status === 'succeeded') !== (job.result !== null) ||
      (job.status === 'failed') !== (job.error !== null) ||
      (job.result &&
        (job.result.ranking.length !== job.chartIds.length ||
          job.result.ranking.some(
            (entry) => !job.chartIds.includes(entry.chartId),
          )))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent reading job result',
      });
    }
  })
  .meta({ id: 'ReadingJobData' });
export const ReadingJobsDataSchema = z
  .strictObject({
    jobs: z.array(ReadingJobSummarySchema),
    nextCursor: z.uuid().nullable(),
  })
  .meta({ id: 'ReadingJobsData' });
export const ReadingJobAcceptedSchema = createApiResponseSchema(
  'ReadingJobAccepted',
  202,
  ReadingJobDataSchema,
);
export const ReadingJobResponseSchema = createApiResponseSchema(
  'ReadingJobResponse',
  200,
  ReadingJobDataSchema,
);
export const ReadingJobsResponseSchema = createApiResponseSchema(
  'ReadingJobsResponse',
  200,
  ReadingJobsDataSchema,
);
export type CreateReadingJob = z.output<typeof CreateReadingJobSchema>;
export type ReadingJobsQuery = z.output<typeof ReadingJobsQuerySchema>;
export type ReadingJobStage = z.output<typeof ReadingJobStageSchema>;
export type ReadingJobData = z.output<typeof ReadingJobDataSchema>;
export type ReadingJobSummary = z.output<typeof ReadingJobSummarySchema>;
