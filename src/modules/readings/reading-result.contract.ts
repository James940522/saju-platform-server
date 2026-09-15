import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';
import {
  ReadingJobStageSchema,
  ReadingJobSummarySchema,
} from './reading-job.contract.js';
import {
  MAX_WEALTH_PARTICIPANTS,
  MIN_WEALTH_PARTICIPANTS,
  WealthFortuneSentenceSchema,
  WealthComparisonTitleSchema,
} from './wealth-ranking.contract.js';

// Explicit public allowlist: never derive a public response by spreading a job,
// chart or the private stored result (including old results with birth warnings).
export const PublicWealthRankingSchema = z
  .strictObject({
    ranking: z
      .array(
        z.strictObject({
          rank: z.number().int().min(1).max(MAX_WEALTH_PARTICIPANTS),
          displayName: z.string().min(1).max(30),
          fortune: WealthFortuneSentenceSchema,
        }),
      )
      .min(MIN_WEALTH_PARTICIPANTS)
      .max(MAX_WEALTH_PARTICIPANTS),
    // Names may contain punctuation and expand the validated 600-character source.
    // This is plain text, never HTML/Markdown. The AI source retains strict validation.
    rationale: z.string().min(1).max(3600),
    comparisonTitle: WealthComparisonTitleSchema,
    notice: z.string().min(1),
  })
  .refine(
    ({ ranking }) => ranking.every((entry, index) => entry.rank === index + 1),
    { message: 'Invalid public ranking order' },
  );

export const ReadingResultDataSchema = z
  .strictObject({
    id: z.uuid(),
    productCode: z.literal('wealth-ranking'),
    status: ReadingJobSummarySchema.shape.status,
    stage: ReadingJobStageSchema,
    result: PublicWealthRankingSchema.nullable(),
    error: z.strictObject({ message: z.string().min(1) }).nullable(),
  })
  .superRefine((value, context) => {
    if (
      (value.status === 'succeeded') !== (value.result !== null) ||
      (value.status === 'failed') !== (value.error !== null) ||
      (value.status === 'queued' && value.stage !== 'queued') ||
      (value.status === 'running' &&
        !['preparing', 'interpreting', 'saving'].includes(value.stage)) ||
      (['succeeded', 'failed'].includes(value.status) &&
        value.stage !== 'finished')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent public reading state',
      });
    }
  })
  .meta({ id: 'ReadingResultData' });

export const ReadingResultResponseSchema = createApiResponseSchema(
  'ReadingResultResponse',
  200,
  ReadingResultDataSchema,
);
export type ReadingResultData = z.output<typeof ReadingResultDataSchema>;
