import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { ReadingProductsService } from './reading-products.service.js';

describe('ReadingProductsService', () => {
  const service = new ReadingProductsService(
    new ConfigService<EnvironmentVariables, true>({
      WEALTH_RANKING_ENABLED: false,
    }),
  );

  it.each([
    { enabled: true, key: 'test-key', expected: 'active' },
    { enabled: false, key: 'test-key', expected: 'coming_soon' },
    { enabled: true, key: undefined, expected: 'coming_soon' },
  ])(
    'reflects wealth ranking availability in list and detail: $expected ($enabled)',
    ({ enabled, key, expected }) => {
      const configured = new ReadingProductsService(
        new ConfigService<EnvironmentVariables, true>({
          WEALTH_RANKING_ENABLED: enabled,
          KIE_API_KEY: key,
        }),
      );
      expect(configured.findOne('wealth-ranking').product.availability).toBe(
        expected,
      );
      expect(
        configured
          .findAll()
          .products.find((product) => product.code === 'wealth-ranking')
          ?.availability,
      ).toBe(expected);
    },
  );

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
