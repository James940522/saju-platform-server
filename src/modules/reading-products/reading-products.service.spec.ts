import { NotFoundException } from '@nestjs/common';
import { ReadingProductsService } from './reading-products.service.js';

describe('ReadingProductsService', () => {
  const service = new ReadingProductsService();

  it('returns the server-owned reading catalog', () => {
    const { products } = service.findAll();

    expect(products).toHaveLength(13);
    expect(
      products.find((product) => product.code === 'past-life-relationship'),
    ).toMatchObject({
      availability: 'active',
      pricing: { type: 'paid', amount: 990, currency: 'KRW' },
      subjectRequirement: { type: 'pair' },
    });
  });

  it('returns a product by code', () => {
    const { product } = service.findOne('daily-fortune');

    expect(product.title).toBe('오늘의 운세');
  });

  it('rejects an unknown product code', () => {
    expect(() => service.findOne('unknown-product')).toThrow(NotFoundException);
  });
});
