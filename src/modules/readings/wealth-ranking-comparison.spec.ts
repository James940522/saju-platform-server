import { renderWealthComparison } from './wealth-ranking-comparison.js';
import { PublicWealthRankingSchema } from './reading-result.contract.js';
import { mapWealthRankingResult } from './wealth-ranking-result.js';
import { buildWealthRankingContext } from './wealth-ranking-context.js';
import {
  wealthCharts,
  wealthModelOutput,
} from '../../../test/fixtures/wealth-ranking.fixture.js';

function fixture() {
  const charts = wealthCharts();
  const result = mapWealthRankingResult(
    wealthModelOutput(),
    buildWealthRankingContext(charts),
    charts,
  );
  const names = new Map(
    result.ranking.map((entry, index) => [
      entry.chartId,
      index === 0 ? '정재민' : '신연주',
    ]),
  );
  return { result, names };
}

describe('Named wealth comparison', () => {
  it('resolves current names and the generated title without reranking or mutating storage', () => {
    const { result, names } = fixture();
    const original = structuredClone(result);
    const output = renderWealthComparison(result, names);
    expect(output.comparisonTitle).toBe(wealthModelOutput().comparisonTitle);
    expect(output.rationale).toContain('정재민님은');
    expect(output.rationale).toContain('신연주님은');
    expect(output.rationale).not.toMatch(/위 참여자|p[1-5]|[{}]/);
    names.set(result.ranking[0]!.chartId, '새이름');
    expect(renderWealthComparison(result, names).rationale).toContain(
      '새이름님은',
    );
    expect(result).toEqual(original);
  });

  it('reads old results without an AI title and fixes honorific particles', () => {
    const { result, names } = fixture();
    delete result.comparisonTitle;
    result.rationale =
      '1위 참여자는 기회를 살리고 2위 참여자가 지출을 관리해요. 1위 참여자와 2위 참여자의 장점을 함께 보세요.';
    const output = renderWealthComparison(result, names);
    expect(output.comparisonTitle).toBe('함께 살펴보는 재물의 흐름');
    expect(output.rationale).toBe(
      '정재민님은 기회를 살리고 신연주님이 지출을 관리해요. 정재민님과 신연주님의 장점을 함께 보세요.',
    );
  });

  it('disambiguates duplicate names by result rank', () => {
    const { result, names } = fixture();
    for (const chartId of names.keys()) names.set(chartId, '동명이인');
    const output = renderWealthComparison(result, names);
    expect(output.rationale).toContain('동명이인님(1위)은');
    expect(output.rationale).toContain('동명이인님(2위)은');
  });

  it('keeps user names literal and allows named text to exceed the AI source length', () => {
    const { result, names } = fixture();
    names.set(result.ranking[0]!.chartId, '$& <b>1위 참여자</b>');
    const output = renderWealthComparison(result, names);
    expect(output.rationale).toContain('$& <b>1위 참여자</b>님은');
    expect(output.rationale).not.toContain('님님');
    // Worst-case legacy source with repeated labels and longest duplicate names.
    result.rationale = '1위 참여자'.repeat(100);
    for (const key of names.keys()) names.set(key, '가'.repeat(30));
    const rendered = renderWealthComparison(result, names);
    expect(rendered.rationale.length).toBeGreaterThan(600);
    expect(
      PublicWealthRankingSchema.safeParse({
        ...rendered,
        ranking: result.ranking.map(({ rank, chartId, fortune }) => ({
          rank,
          displayName: names.get(chartId),
          fortune,
        })),
        notice: '참고용 풀이예요.',
      }).success,
    ).toBe(true);
  });
});
