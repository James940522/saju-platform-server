import { BadGatewayException } from '@nestjs/common';
import type {
  WealthRankingContext,
  WealthRankingChart,
} from './wealth-ranking-context.js';
import { WealthRankingDataSchema } from './wealth-ranking.contract.js';
import {
  WealthRankingModelOutputSchema,
  WEALTH_RANKING_PROMPT_VERSION,
} from './infrastructure/wealth-ranking.prompt.js';

export function invalidWealthRankingOutput() {
  return new BadGatewayException({ reason: 'READING_OUTPUT_INVALID' });
}

export function mapWealthRankingResult(
  value: unknown,
  context: WealthRankingContext,
  charts: readonly WealthRankingChart[],
) {
  const parsed = WealthRankingModelOutputSchema.safeParse(value);
  if (!parsed.success) throw invalidWealthRankingOutput();
  const output = parsed.data;
  const orderedCharts = [...charts].sort((a, b) =>
    a.chartId.localeCompare(b.chartId),
  );
  const seen = new Set<string>();
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
    throw invalidWealthRankingOutput();
  const ranking = output.ranking.map((entry, index) => {
    const source = entries.get(entry.participantKey);
    if (!source?.chart || seen.has(entry.participantKey))
      throw invalidWealthRankingOutput();
    seen.add(entry.participantKey);
    const signature = JSON.stringify(
      source.participant.facts.map(({ id: _id, ...fact }) => fact),
    );
    const previousEquivalent = equivalentFacts.get(signature);
    if (previousEquivalent && previousEquivalent > entry.participantKey)
      throw invalidWealthRankingOutput();
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
      throw invalidWealthRankingOutput();
    return {
      rank: index + 1,
      chartId: source.chart.chartId,
      displayName: source.chart.displayName,
      fortune: entry.fortune,
      quality: source.chart.snapshot.quality,
      warnings: source.chart.snapshot.warnings,
    };
  });
  const mentioned = new Set<string>();
  const rationale = output.rationale.replace(
    /\{\{([^{}]+)\}\}/gu,
    (_match: string, key: string) => {
      const entry = entries.get(key);
      if (!entry?.chart) throw invalidWealthRankingOutput();
      mentioned.add(key);
      // Refer to the public rank: arbitrary names cannot alter generated prose.
      const rank = ranking.find(
        (item) => item.chartId === entry.chart.chartId,
      )?.rank;
      if (!rank) throw invalidWealthRankingOutput();
      return `${rank}위 참여자`;
    },
  );
  if (
    mentioned.size !== charts.length ||
    /[{}]|\bp\d+\b/u.test(output.rationale.replace(/\{\{p[1-5]\}\}/gu, ''))
  ) {
    throw invalidWealthRankingOutput();
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
  const result = WealthRankingDataSchema.safeParse({
    productCode: 'wealth-ranking',
    schemaVersion: 1,
    promptVersion: WEALTH_RANKING_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    ranking,
    rationale,
    notice: `사주에 기반한 오락용 상대 순위이며 실제 재산이나 미래 수익을 보장하지 않습니다. ${calendarNotice}`,
  });
  if (!result.success) throw invalidWealthRankingOutput();
  return result.data;
}
