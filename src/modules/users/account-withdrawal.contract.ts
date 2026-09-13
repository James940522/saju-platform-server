import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';

export const AccountWithdrawalRequestSchema = z
  .strictObject({ confirmDataDeletion: z.literal(true) })
  .meta({ id: 'AccountWithdrawalRequest' });
export const AccountWithdrawalDataSchema = z
  .strictObject({ status: z.enum(['completed', 'processing']) })
  .meta({ id: 'AccountWithdrawalData' });
export const AccountWithdrawalCompletedResponseSchema = createApiResponseSchema(
  'AccountWithdrawalCompletedResponse',
  200,
  z.strictObject({ status: z.literal('completed') }),
);
export const AccountWithdrawalProcessingResponseSchema =
  createApiResponseSchema(
    'AccountWithdrawalProcessingResponse',
    202,
    z.strictObject({ status: z.literal('processing') }),
  );
export type AccountWithdrawalRequest = z.infer<
  typeof AccountWithdrawalRequestSchema
>;
export type AccountWithdrawalData = z.infer<typeof AccountWithdrawalDataSchema>;
