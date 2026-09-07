import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

function createFieldErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const field = issue.path.map(String).join('.') || '_root';
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
  }

  return fieldErrors;
}

export class ZodValidationPipe<
  TSchema extends z.ZodType,
> implements PipeTransform<unknown, z.output<TSchema>> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    throw new BadRequestException({
      message: '요청값을 확인해주세요.',
      reason: 'VALIDATION_ERROR',
      fieldErrors: createFieldErrors(result.error),
    });
  }
}
