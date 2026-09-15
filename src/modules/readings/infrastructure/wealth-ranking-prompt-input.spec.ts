import { wealthCharts } from '../../../../test/fixtures/wealth-ranking.fixture.js';
import { buildWealthRankingContext } from '../wealth-ranking-context.js';
import { buildWealthRankingPromptInput } from './wealth-ranking-prompt-input.js';
import {
  buildWealthRankingMessages,
  WEALTH_RANKING_PROMPT_VERSION,
  WealthRankingModelOutputSchema,
} from './wealth-ranking.prompt.js';
import { readingPrompts } from '../../../config/reading-prompts.config.js';
import { wealthModelOutput } from '../../../../test/fixtures/wealth-ranking.fixture.js';

describe('Wealth-only prompt projection', () => {
  it('preserves every selectable evidence ID and per-person analysis without changing the source', () => {
    const context = buildWealthRankingContext(wealthCharts());
    const before = structuredClone(context);
    const input = buildWealthRankingPromptInput(context);
    for (const [index, participant] of input.participants.entries()) {
      const source = context[index]!;
      expect(participant.facts).toEqual(source.facts);
      expect(participant.hiddenStemFacts.map(({ id }) => id)).toEqual(
        source.hiddenStemFacts.map(({ id }) => id),
      );
      expect(participant.branchRelations).toEqual(source.branchRelations);
      expect(participant.warningCodes).toEqual(source.warningCodes);
      expect(participant.fortuneTellerAnalysis).toMatchObject({
        status: source.fortuneTellerAnalysis.status,
        dayMasterStrength: source.fortuneTellerAnalysis.dayMasterStrength,
        gyeokGuk: source.fortuneTellerAnalysis.gyeokGuk,
        sinSals: source.fortuneTellerAnalysis.sinSals,
        excludedAnalyses: source.fortuneTellerAnalysis.excludedAnalyses,
        tenGodCounts: source.fortuneTellerAnalysis.tenGodDistribution.counts,
      });
      expect(participant.fortuneTellerAnalysis.wealth.summary).toBe(
        source.fortuneTellerAnalysis.wealth.summary,
      );
    }
    expect(input.participants[0]?.fortuneTellerAnalysis.status).toBe(
      'complete',
    );
    expect(input.participants[1]?.fortuneTellerAnalysis.yongSin).toBeNull();
    expect(input.participants[1]?.facts).toHaveLength(6);
    expect(context).toEqual(before);
  });

  it('omits private/source-only fields and unused score/color/direction instructions', () => {
    const input = buildWealthRankingPromptInput(
      buildWealthRankingContext(wealthCharts()),
    );
    const serialized = JSON.stringify(input);
    for (const key of [
      'sources',
      'calculationPolicy',
      'calendarVerification',
      'solarTermVerification',
      'referenceScore',
      'colors',
      'directions',
      'upstreamRevision',
      'birthDate',
      'chartId',
      'displayName',
    ]) {
      expect(serialized).not.toContain(`"${key}":`);
    }
    expect(serialized).not.toContain('https://');
  });

  it('reads the product registry and validates concise output while preserving the public result shape', () => {
    const messages = buildWealthRankingMessages(
      buildWealthRankingContext(wealthCharts()),
    );
    expect(messages[0]?.content).toBe(
      readingPrompts['wealth-ranking'].systemPrompt,
    );
    expect(WEALTH_RANKING_PROMPT_VERSION).toBe(
      readingPrompts['wealth-ranking'].version,
    );
    const output = wealthModelOutput();
    expect(WealthRankingModelOutputSchema.safeParse(output).success).toBe(true);
    expect(
      WealthRankingModelOutputSchema.safeParse({
        ...output,
        rationale: '가'.repeat(401),
      }).success,
    ).toBe(false);
    output.ranking[0]!.evidenceIds = [
      'p2.year.stem',
      'p2.month.stem',
      'p2.day.stem',
    ];
    expect(WealthRankingModelOutputSchema.safeParse(output).success).toBe(
      false,
    );
  });
});
