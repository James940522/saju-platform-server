import { z } from 'zod';
import type { WealthRankingContext } from '../wealth-ranking-context.js';
import { readingPrompts } from '../../../config/reading-prompts.config.js';
import { buildWealthRankingPromptInput } from './wealth-ranking-prompt-input.js';
import {
  MAX_WEALTH_PARTICIPANTS,
  MIN_WEALTH_PARTICIPANTS,
  WealthFortuneSentenceSchema,
  WealthComparisonTitleSchema,
  WealthRankingRationaleSchema,
} from '../wealth-ranking.contract.js';

const prompt = readingPrompts['wealth-ranking'];
export const WEALTH_RANKING_PROMPT_VERSION = prompt.version;

export const WealthRankingModelOutputSchema = z.strictObject({
  ranking: z
    .array(
      z.strictObject({
        participantKey: z.string().regex(/^p[1-5]$/),
        fortune: WealthFortuneSentenceSchema,
        evidenceIds: z.array(z.string().min(1)).min(1).max(2),
      }),
    )
    .min(MIN_WEALTH_PARTICIPANTS)
    .max(MAX_WEALTH_PARTICIPANTS),
  rationale: WealthRankingRationaleSchema.max(400),
  comparisonTitle: WealthComparisonTitleSchema,
});

export const WEALTH_RANKING_SYSTEM_PROMPT = prompt.systemPrompt;

export function buildWealthRankingMessages(context: WealthRankingContext) {
  return [
    { role: 'system', content: WEALTH_RANKING_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify(buildWealthRankingPromptInput(context)),
    },
  ];
}
