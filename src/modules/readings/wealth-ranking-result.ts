import type {
  WealthRankingContext,
  WealthRankingChart,
} from './wealth-ranking-context.js';
import { WealthRankingDataSchema } from './wealth-ranking.contract.js';
import { wealthRankingFailure } from './wealth-ranking-failure.js';
import {
  WealthRankingModelOutputSchema,
  WEALTH_RANKING_PROMPT_VERSION,
} from './infrastructure/wealth-ranking.prompt.js';

const POSITION_LABELS = {
  year: '년',
  month: '월',
  day: '일',
  hour: '시',
} as const;

export function mapWealthRankingResult(
  value: unknown,
  context: WealthRankingContext,
  charts: readonly WealthRankingChart[],
) {
  const parsed = WealthRankingModelOutputSchema.safeParse(value);
  if (!parsed.success) throw wealthRankingFailure('model_output_schema');
  const output = parsed.data;
  const orderedCharts = [...charts].sort((a, b) =>
    a.chartId.localeCompare(b.chartId),
  );
  const seen = new Set<string>();
  const referenceLabels = new Map<
    string,
    { participantKey: string; label: string }
  >();
  const equivalentFacts = new Map<string, string>();
  const entries = new Map(
    context.map((participant, index) => [
      participant.participantKey,
      {
        participant,
        chart: orderedCharts[index],
      },
    ]),
  );
  if (output.ranking.length !== charts.length)
    throw wealthRankingFailure('model_participants');
  const ranking = output.ranking.map((entry, index) => {
    const source = entries.get(entry.participantKey);
    if (!source?.chart || seen.has(entry.participantKey))
      throw wealthRankingFailure('model_participants');
    seen.add(entry.participantKey);
    const signature = JSON.stringify(
      source.participant.facts.map(({ id: _id, ...fact }) => fact),
    );
    const previousEquivalent = equivalentFacts.get(signature);
    if (previousEquivalent && previousEquivalent > entry.participantKey)
      throw wealthRankingFailure('model_equivalent_order');
    equivalentFacts.set(signature, entry.participantKey);
    const factIds = new Set(
      [
        ...source.participant.facts,
        ...source.participant.hiddenStemFacts,
        ...source.participant.branchRelations,
      ].map(({ id }) => id),
    );
    if (
      entry.evidenceIds.some((id) => !factIds.has(id)) ||
      !entry.evidenceIds.some((id) =>
        source.participant.facts.some((fact) => fact.id === id),
      ) ||
      new Set(entry.evidenceIds).size !== entry.evidenceIds.length ||
      /\{\{|\bp[1-5]\b/u.test(entry.fortune)
    )
      throw wealthRankingFailure('model_evidence');
    const rankLabel = `${index + 1}위 참여자`;
    referenceLabels.set(entry.participantKey, {
      participantKey: entry.participantKey,
      label: rankLabel,
    });
    // Normalize only already-validated citations, never an unknown pN prefix.
    const evidenceLabels = [
      ...source.participant.facts.map((fact) => ({
        id: fact.id,
        label: `${POSITION_LABELS[fact.position]}${fact.symbol === 'stem' ? '간' : '지'}`,
      })),
      ...source.participant.hiddenStemFacts.map((fact) => ({
        id: fact.id,
        label: `${POSITION_LABELS[fact.position]}지 지장간 ${fact.stemKorean}`,
      })),
      ...source.participant.branchRelations.map((fact) => ({
        id: fact.id,
        label: `${fact.branchesKorean} 삼합 구성`,
      })),
    ];
    for (const fact of evidenceLabels) {
      if (entry.evidenceIds.includes(fact.id))
        referenceLabels.set(fact.id, {
          participantKey: entry.participantKey,
          label: `${rankLabel}의 ${fact.label}`,
        });
    }
    return {
      rank: index + 1,
      chartId: source.chart.chartId,
      displayName: source.chart.displayName,
      fortune: entry.fortune,
      quality: source.chart.snapshot.quality,
      warnings: source.chart.snapshot.warnings,
    };
  });
  const comparedParticipants = new Set([
    output.ranking[0]?.participantKey,
    output.ranking.at(-1)?.participantKey,
  ]);
  // A literal rank label could bypass participant-key validation, or be
  // mistaken for one of our persisted references when names are resolved.
  if (/\d+\s*위\s*참여자/u.test(output.rationale))
    throw wealthRankingFailure('model_references');
  const mentioned = new Set<string>();
  const rationale = output.rationale.replace(
    /\{\{([^{}]+)\}\}|\bp\d+(?:\.[a-zA-Z0-9_-]+)*\b/gu,
    (match: string, wrappedKey: string | undefined) => {
      const reference = referenceLabels.get(wrappedKey ?? match);
      if (!reference || !comparedParticipants.has(reference.participantKey))
        throw wealthRankingFailure('model_references');
      mentioned.add(reference.participantKey);
      return reference.label;
    },
  );
  if (mentioned.size !== 2 || /[{}]|\bp\d+/u.test(rationale)) {
    throw wealthRankingFailure('model_references');
  }
  const hasUnavailableCalendar = context.some(
    (participant) => participant.calendarVerification.status === 'unavailable',
  );
  const hasDisabledCalendar = context.some(
    (participant) => participant.calendarVerification.status === 'disabled',
  );
  const calendarNotice = hasUnavailableCalendar
    ? '공식 달력 대조를 일부 완료하지 못해 저장된 만세력 정보로 풀이했습니다.'
    : hasDisabledCalendar
      ? '실시간 공식 달력 대조는 적용하지 않았습니다.'
      : '음양력 날짜와 윤달 여부를 한국천문연구원 자료와 대조했습니다.';
  const solarStatuses = context.map(
    (participant) => participant.solarTermVerification.status,
  );
  const solarNotice = solarStatuses.every((status) => status === 'matched')
    ? '연주·월주를 한국천문연구원의 절입 시각과 대조했습니다.'
    : solarStatuses.every((status) => status === 'disabled')
      ? '공식 절기 대조는 적용하지 않았습니다.'
      : '자료 미제공·조회 실패 또는 계산 정책 차이로 일부 연주·월주의 공식 절기 대조를 완료하지 못했습니다.';
  const result = WealthRankingDataSchema.safeParse({
    productCode: 'wealth-ranking',
    schemaVersion: 1,
    promptVersion: WEALTH_RANKING_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    ranking,
    rationale,
    comparisonTitle: output.comparisonTitle,
    notice: `사주에 기반한 오락용 상대 순위이며 실제 재산이나 미래 수익을 보장하지 않습니다. ${calendarNotice} ${solarNotice}${context.some((participant) => participant.fortuneTellerAnalysis.status === 'partial') ? ' 출생시간 미상자는 시주가 필요한 분석을 제외했으며, 시간을 확인하면 해석과 상대 순위가 달라질 수 있습니다.' : ''}`,
  });
  if (!result.success) throw wealthRankingFailure('result_schema');
  return result.data;
}
