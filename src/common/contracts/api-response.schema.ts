import { z } from 'zod';

export const ApiErrorDataSchema = z
  .strictObject({
    reason: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string().min(1))).optional(),
  })
  .meta({ id: 'ApiErrorData' });

export const ApiErrorResponseSchema = z
  .strictObject({
    code: z.number().int().min(400).max(599),
    message: z.string().min(1),
    data: ApiErrorDataSchema.nullable(),
  })
  .meta({ id: 'ApiErrorResponse' });

export function createApiResponseSchema<TSchema extends z.ZodType>(
  id: string,
  statusCode: number,
  dataSchema: TSchema,
) {
  return z
    .strictObject({
      code: z.literal(statusCode),
      message: z.string().min(1),
      data: dataSchema,
    })
    .meta({ id });
}

export function createApiErrorResponseSchema(id: string, statusCode: number) {
  return z
    .strictObject({
      code: z.literal(statusCode),
      message: z.string().min(1),
      data: ApiErrorDataSchema.nullable(),
    })
    .meta({ id });
}

export type ApiResponse<TData> = {
  code: number;
  message: string;
  data: TData;
};

export type ApiErrorData = z.output<typeof ApiErrorDataSchema>;
export type ApiErrorResponse = z.output<typeof ApiErrorResponseSchema>;
