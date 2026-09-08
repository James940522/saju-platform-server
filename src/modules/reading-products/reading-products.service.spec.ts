import { NotFoundException } from '@nestjs/common';
import { ReadingProductsService } from './reading-products.service.js';

describe('ReadingProductsService', () => {
  const service = new ReadingProductsService();

  it('returns the server-owned reading catalog', () => {
    const { products } = service.findAll();

    expect(products.map((product) => product.code)).toEqual([
      'wealth-ranking',
      'past-life-relationship',
      'detailed-saju',
      'daily-fortune',
      'monthly-fortune',
      'three-month-fortune',
    ]);
    const product = products.find(
      (candidate) => candidate.code === 'past-life-relationship',
    );

    expect(product).toMatchObject({
      availability: 'active',
      pricing: { type: 'paid', amount: 990, currency: 'KRW' },
    });
    expect(product).not.toHaveProperty('subjectRequirement');
    expect(product).not.toHaveProperty('resultType');
    expect(product).not.toHaveProperty('highlights');
  });

  it('returns a product by code', () => {
    const { product } = service.findOne('daily-fortune');

    expect(product.title).toBe('오늘의 운세');
    expect(product.subjectRequirement).toEqual({ type: 'single' });
    expect(product.highlights).toHaveLength(3);
  });

  it('rejects an unknown product code', () => {
    expect(() => service.findOne('unknown-product')).toThrow(NotFoundException);
  });

  it('does not expose a hidden product by code', () => {
    expect(() => service.findOne('love-fortune')).toThrow(NotFoundException);
  });
});
