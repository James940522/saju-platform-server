import { SajuChartCalculator } from '../../src/modules/saju-profiles/saju-chart-calculator.js';
import type { WealthRankingChart } from '../../src/modules/readings/wealth-ranking-context.js';

export const WEALTH_CHART_IDS = [
  '067410a4-7bed-4901-ab62-faf700827f4a',
  '167410a4-7bed-4901-ab62-faf700827f4a',
];

export function wealthCharts(): WealthRankingChart[] {
  const calculator = new SajuChartCalculator();
  return WEALTH_CHART_IDS.map((chartId, index) => ({
    chartId,
    displayName: '동명이인',
    snapshot: calculator.calculate(
      {
        calendarType: 'solar',
        isLeapMonth: false,
        date: { year: 1992 + index, month: 10, day: 24 },
        time:
          index === 0
            ? { precision: 'exact', hour: 5, minute: 30 }
            : { precision: 'unknown' },
        luckCycleGender: 'male',
      },
      new Date('2026-09-12T00:00:00.000Z'),
    ).snapshot,
  }));
}

// Transport fixture only; not a model-quality benchmark or fabricated live result.
export function wealthModelOutput() {
  return {
    ranking: [
      {
        participantKey: 'p2',
        fortune:
          '기술을 꾸준히 다듬고 지출을 기록하면 돈을 관리하는 데 도움이 돼요.',
        evidenceIds: ['p2.month.stem'],
      },
      {
        participantKey: 'p1',
        fortune:
          '협업의 장점을 살리면서 소비 계획을 세우면 재물 관리에 도움이 돼요.',
        evidenceIds: ['p1.year.stem', 'p1.month.stem'],
      },
    ],
    comparisonTitle: '기회를 넓히는 감각과 돈을 지키는 습관',
    rationale:
      '{{p2}}님은 확인된 정보 범위에서 재능을 키우며 돈의 흐름을 만들고, {{p1}}님은 협업의 강점을 살리며 소비 원칙을 세우면 도움이 돼요. 두 사람의 자료 범위에 따라 해석과 상대 순위가 달라질 수 있어요.',
  };
}
