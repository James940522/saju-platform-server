import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';
import {
  BirthInputSchema,
  SajuChartSnapshotV1Schema,
} from './saju-profile.contract.js';

export const PreviewSajuChartRequestSchema = z
  .strictObject({ birth: BirthInputSchema })
  .meta({ id: 'PreviewSajuChartRequest' });

export const PreviewSajuChartDataSchema = z
  .strictObject({
    status: z.literal('calculated'),
    snapshot: SajuChartSnapshotV1Schema,
  })
  .meta({ id: 'PreviewSajuChartData' });

export const PreviewSajuChartResponseSchema = createApiResponseSchema(
  'PreviewSajuChartResponse',
  200,
  PreviewSajuChartDataSchema,
);

export type PreviewSajuChartRequest = z.infer<
  typeof PreviewSajuChartRequestSchema
>;
export type PreviewSajuChartData = z.infer<typeof PreviewSajuChartDataSchema>;
