import { Controller, Get, Param } from '@nestjs/common';
import { ResponseContract } from '../../common/http/response-contract.decorator.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  GetReadingProductDataSchema,
  type GetReadingProductData,
  GetReadingProductsDataSchema,
  type GetReadingProductsData,
  type ReadingProductParams,
  ReadingProductParamsSchema,
} from './reading-product.contract.js';
import { ReadingProductsService } from './reading-products.service.js';

@Controller({ path: 'reading-products', version: '1' })
export class ReadingProductsController {
  constructor(
    private readonly readingProductsService: ReadingProductsService,
  ) {}

  @Get()
  @ResponseContract({
    message: '풀이 상품 목록을 조회했습니다.',
    schema: GetReadingProductsDataSchema,
  })
  findAll(): GetReadingProductsData {
    return this.readingProductsService.findAll();
  }

  @Get(':productCode')
  @ResponseContract({
    message: '풀이 상품을 조회했습니다.',
    schema: GetReadingProductDataSchema,
  })
  findOne(
    @Param(new ZodValidationPipe(ReadingProductParamsSchema))
    params: ReadingProductParams,
  ): GetReadingProductData {
    return this.readingProductsService.findOne(params.productCode);
  }
}
