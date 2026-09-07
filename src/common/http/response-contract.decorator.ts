import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';

export const RESPONSE_CONTRACT_METADATA = Symbol('response-contract');

export type ResponseContractOptions = {
  message: string;
  schema: z.ZodType;
};

export function ResponseContract(options: ResponseContractOptions) {
  return SetMetadata(RESPONSE_CONTRACT_METADATA, options);
}
