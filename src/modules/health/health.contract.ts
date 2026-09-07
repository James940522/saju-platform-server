import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';

export const HealthDataSchema = z
  .strictObject({
    status: z.literal('ok'),
    timestamp: z.string().datetime(),
  })
  .meta({ id: 'HealthData' });

export const HealthResponseSchema = createApiResponseSchema(
  'HealthResponse',
  200,
  HealthDataSchema,
);

export type HealthData = z.output<typeof HealthDataSchema>;
