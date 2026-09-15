import type { WealthRankingData } from './wealth-ranking.contract.js';

const LEGACY_COMPARISON_TITLE = '함께 살펴보는 재물의 흐름';
const HONORIFIC_PARTICLES: Readonly<Record<string, string>> = {
  는: '은',
  가: '이',
  를: '을',
  와: '과',
  로: '으로',
};

// Persist stable rank references, then resolve current names at read time.
// Names never enter the AI prompt and renaming never regenerates a reading.
export function renderWealthComparison(
  result: Pick<WealthRankingData, 'ranking' | 'rationale' | 'comparisonTitle'>,
  names: ReadonlyMap<string, string>,
) {
  const nameCounts = new Map<string, number>();
  for (const name of names.values())
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  const rationale = result.rationale.replace(
    /([1-5])위 참여자(?:님)?(으로|은|는|이|가|을|를|과|와|로)?/gu,
    (_match: string, rank: string, particle: string | undefined) => {
      const entry = result.ranking.find((entry) => entry.rank === Number(rank));
      const name = entry && names.get(entry.chartId);
      if (!name) throw new Error('Missing comparison participant');
      const label = `${name}님${(nameCounts.get(name) ?? 0) > 1 ? `(${rank}위)` : ''}`;
      // One replacement pass: names containing '$&' or rank-like text stay literal.
      return (
        label + (particle ? (HONORIFIC_PARTICLES[particle] ?? particle) : '')
      );
    },
  );
  return {
    rationale,
    comparisonTitle: result.comparisonTitle ?? LEGACY_COMPARISON_TITLE,
  };
}
