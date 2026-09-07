import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';

export const ReadingProductCodeSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .meta({
    id: 'ReadingProductCode',
    description: '풀이 상품의 안정적인 URL 코드',
    example: 'past-life-relationship',
  });

export const ReadingThemeSchema = z
  .enum(['self', 'relationship', 'fortune', 'wealth', 'career', 'question'])
  .meta({ id: 'ReadingTheme' });

export const ReadingSubjectRequirementSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('single') }),
    z.strictObject({ type: z.literal('pair') }),
    z.strictObject({
      type: z.literal('group'),
      min: z.number().int().min(2),
      max: z.number().int().min(2),
    }),
  ])
  .meta({ id: 'ReadingSubjectRequirement' });

export const ReadingAvailabilitySchema = z
  .enum(['active', 'coming_soon', 'hidden'])
  .meta({ id: 'ReadingAvailability' });

export const ReadingPricingSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('free') }),
    z.strictObject({
      type: z.literal('paid'),
      amount: z.number().int().nonnegative(),
      currency: z.literal('KRW'),
    }),
    z.strictObject({
      type: z.literal('pending'),
      expectedAmount: z.number().int().nonnegative().optional(),
      currency: z.literal('KRW').optional(),
    }),
  ])
  .meta({ id: 'ReadingPricing' });

export const ReadingResultTypeSchema = z
  .enum(['standard', 'daily_fortune', 'past_life_relationship', 'ranking'])
  .meta({ id: 'ReadingResultType' });

export const ReadingProductSchema = z
  .strictObject({
    id: z.string().min(1),
    code: ReadingProductCodeSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    theme: ReadingThemeSchema,
    subjectRequirement: ReadingSubjectRequirementSchema,
    availability: ReadingAvailabilitySchema,
    pricing: ReadingPricingSchema,
    resultType: ReadingResultTypeSchema,
    highlights: z.array(z.string().min(1)).min(1),
  })
  .meta({ id: 'ReadingProduct' });

export const ReadingProductParamsSchema = z.strictObject({
  productCode: ReadingProductCodeSchema,
});

export const GetReadingProductsDataSchema = z
  .strictObject({
    products: z.array(ReadingProductSchema),
  })
  .meta({ id: 'GetReadingProductsData' });

export const GetReadingProductDataSchema = z
  .strictObject({
    product: ReadingProductSchema,
  })
  .meta({ id: 'GetReadingProductData' });

export const GetReadingProductsResponseSchema = createApiResponseSchema(
  'GetReadingProductsResponse',
  200,
  GetReadingProductsDataSchema,
);

export const GetReadingProductResponseSchema = createApiResponseSchema(
  'GetReadingProductResponse',
  200,
  GetReadingProductDataSchema,
);

export type ReadingProduct = z.output<typeof ReadingProductSchema>;
export type ReadingProductParams = z.output<typeof ReadingProductParamsSchema>;
export type GetReadingProductsData = z.output<
  typeof GetReadingProductsDataSchema
>;
export type GetReadingProductData = z.output<
  typeof GetReadingProductDataSchema
>;
