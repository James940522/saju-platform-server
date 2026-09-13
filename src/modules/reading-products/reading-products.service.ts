import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import type {
  GetReadingProductData,
  GetReadingProductsData,
  ReadingProduct,
  ReadingProductSummary,
} from './reading-product.contract.js';
import { READING_PRODUCTS } from './reading-products.catalog.js';

const readingProductDisplayOrder = new Map(
  [
    'wealth-ranking',
    'past-life-relationship',
    'detailed-saju',
    'daily-fortune',
    'monthly-fortune',
    'three-month-fortune',
  ].map((code, index) => [code, index]),
);

function toReadingProductSummary(
  product: ReadingProduct,
): ReadingProductSummary {
  return {
    id: product.id,
    code: product.code,
    title: product.title,
    description: product.description,
    theme: product.theme,
    availability: product.availability,
    pricing: product.pricing,
  };
}

@Injectable()
export class ReadingProductsService {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  private withAvailability(product: ReadingProduct): ReadingProduct {
    if (product.code !== 'wealth-ranking') return product;
    const isEnabled = this.config.get('WEALTH_RANKING_ENABLED', {
      infer: true,
    });
    const hasApiKey = Boolean(this.config.get('KIE_API_KEY', { infer: true }));
    return {
      ...product,
      availability: isEnabled && hasApiKey ? 'active' : 'coming_soon',
    };
  }

  findAll(): GetReadingProductsData {
    return {
      products: READING_PRODUCTS.filter(
        (product) => product.availability !== 'hidden',
      )
        .sort(
          (left, right) =>
            (readingProductDisplayOrder.get(left.code) ??
              Number.MAX_SAFE_INTEGER) -
            (readingProductDisplayOrder.get(right.code) ??
              Number.MAX_SAFE_INTEGER),
        )
        .map((product) =>
          toReadingProductSummary(this.withAvailability(product)),
        ),
    };
  }

  findOne(productCode: string): GetReadingProductData {
    const product = READING_PRODUCTS.find(
      (candidate) =>
        candidate.code === productCode && candidate.availability !== 'hidden',
    );

    if (!product) {
      throw new NotFoundException({
        message: '요청한 풀이 상품을 찾을 수 없습니다.',
        reason: 'READING_PRODUCT_NOT_FOUND',
      });
    }

    return { product: this.withAvailability(product) };
  }
}
