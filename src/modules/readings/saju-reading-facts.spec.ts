import { wealthCharts } from '../../../test/fixtures/wealth-ranking.fixture.js';
import { buildSajuReadingFacts } from './saju-reading-facts.js';

describe('Versioned reading facts', () => {
  it('derives hidden-stem ten gods from the same day master without inventing strength', () => {
    const chart = wealthCharts()[0]!;
    chart.snapshot.dayMaster = {
      code: 'gap',
      korean: '갑',
      hanja: '甲',
      element: 'wood',
      yinYang: 'yang',
    };
    chart.snapshot.pillars.year.branch = {
      code: 'chuk',
      korean: '축',
      hanja: '丑',
      element: 'earth',
      yinYang: 'yin',
    };
    const result = buildSajuReadingFacts(chart.snapshot, 'p1');
    expect(
      result.hiddenStemFacts.filter((fact) => fact.position === 'year'),
    ).toMatchObject([
      {
        id: 'p1.year.hidden.gi',
        stemKorean: '기',
        tenGodKorean: '정재',
        isPrincipal: true,
      },
      { stemKorean: '신', tenGodKorean: '정관', isPrincipal: false },
      { stemKorean: '계', tenGodKorean: '정인', isPrincipal: false },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/strength|weight|score/);
  });

  it('does not manufacture hidden stems for unknown birth time or change the snapshot', () => {
    const chart = wealthCharts()[1]!;
    const before = structuredClone(chart.snapshot);
    const result = buildSajuReadingFacts(chart.snapshot, 'p2');
    expect(
      result.hiddenStemFacts.some((fact) => fact.position === 'hour'),
    ).toBe(false);
    expect(
      result.hiddenStemFacts.every((fact) => fact.id.startsWith('p2.')),
    ).toBe(true);
    expect(chart.snapshot).toEqual(before);
  });

  it('requires three distinct branches for a trine and never asserts transformation', () => {
    const chart = wealthCharts()[1]!;
    chart.snapshot.pillars.year.branch.code = 'sin';
    chart.snapshot.pillars.month.branch.code = 'ja';
    chart.snapshot.pillars.day.branch.code = 'jin';
    expect(buildSajuReadingFacts(chart.snapshot, 'p2').branchRelations).toEqual(
      [
        {
          id: 'p2.branch_trine.water',
          kind: 'complete_trine_membership',
          branchesKorean: '신자진',
          associatedElementKorean: '수',
          positions: ['year', 'month', 'day'],
          transformationEstablished: false,
        },
      ],
    );
    chart.snapshot.pillars.year.branch.code = 'ja';
    expect(buildSajuReadingFacts(chart.snapshot, 'p2').branchRelations).toEqual(
      [],
    );
  });
});
