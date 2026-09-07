import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  GetReadingProductData,
  GetReadingProductsData,
} from './reading-product.contract.js';
import { READING_PRODUCTS } from './reading-products.catalog.js';

@Injectable()
export class ReadingProductsService {
  findAll(): GetReadingProductsData {
    return { products: [...READING_PRODUCTS] };
  }

  findOne(productCode: string): GetReadingProductData {
    const product = READING_PRODUCTS.find(
      (candidate) => candidate.code === productCode,
    );

    if (!product) {
      throw new NotFoundException({
        message: '요청한 풀이 상품을 찾을 수 없습니다.',
        reason: 'READING_PRODUCT_NOT_FOUND',
      });
    }

    return { product };
  }
}
