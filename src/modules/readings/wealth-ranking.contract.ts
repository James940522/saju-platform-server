import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';
import { SajuChartSnapshotV1Schema } from '../saju-profiles/index.js';

export const MIN_WEALTH_PARTICIPANTS = 2;
export const MAX_WEALTH_PARTICIPANTS = 5;

export const CreateWealthRankingRequestSchema = z
  .strictObject({
    chartIds: z
      .array(z.uuid().toLowerCase())
      .min(MIN_WEALTH_PARTICIPANTS)
      .max(MAX_WEALTH_PARTICIPANTS)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: '같은 차트를 중복해서 선택할 수 없습니다.',
      }),
  })
  .meta({ id: 'CreateWealthRankingRequest' });

// A deliberately narrow text contract: one sentence, no Markdown or line breaks.
export const WealthFortuneSentenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(/^[^.!?。！？\r\n\u2028\u2029]+[.!?。！？]?$/u)
  .regex(/^[^<>`#*]+$/u);
export const WealthRankingRationaleSchema = z
  .string()
  .trim()
  .min(1)
  .max(600)
  .regex(/^[^\r\n\u2028\u2029<>`#*]+$/u);

export const WealthRankingDataSchema = z
  .strictObject({
    productCode: z.literal('wealth-ranking'),
    schemaVersion: z.literal(1),
    promptVersion: z.string().min(1),
    generatedAt: z.iso.datetime(),
    ranking: z
      .array(
        z.strictObject({
          rank: z.number().int().min(1).max(MAX_WEALTH_PARTICIPANTS),
          chartId: z.uuid(),
          displayName: z.string().min(1).max(30),
          fortune: WealthFortuneSentenceSchema,
          quality: SajuChartSnapshotV1Schema.shape.quality,
          warnings: SajuChartSnapshotV1Schema.shape.warnings,
        }),
      )
      .min(MIN_WEALTH_PARTICIPANTS)
      .max(MAX_WEALTH_PARTICIPANTS),
    rationale: WealthRankingRationaleSchema,
    notice: z.string().min(1),
  })
  .superRefine(({ ranking }, context) => {
    if (
      new Set(ranking.map((entry) => entry.chartId)).size !== ranking.length ||
      ranking.some((entry, index) => entry.rank !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ranking'],
        message: 'Invalid ranking permutation',
      });
    }
  })
  .meta({ id: 'WealthRankingData' });

export const WealthRankingResponseSchema = createApiResponseSchema(
  'WealthRankingResponse',
  200,
  WealthRankingDataSchema,
);
export type CreateWealthRankingRequest = z.output<
  typeof CreateWealthRankingRequestSchema
>;
export type WealthRankingData = z.output<typeof WealthRankingDataSchema>;
