import { wealthRankingV8Prompt } from './prompts/wealth-ranking-v8.prompt.js';
import { wealthRankingV9Prompt } from './prompts/wealth-ranking-v9.prompt.js';

const wealthRankingPromptVersions = {
  v8: wealthRankingV8Prompt,
  v9: wealthRankingV9Prompt,
} as const;

// 롤백: 아래 'v9'를 'v8'로 변경하고 서버를 재시작하세요.
// 운영에서는 npm run build 후 재시작합니다. 기존 저장 결과는 다시 생성하지 않습니다.
const ACTIVE_WEALTH_RANKING_PROMPT: keyof typeof wealthRankingPromptVersions =
  'v9';

/**
 * 상품별 활성 프롬프트. 사용: readingPrompts['wealth-ranking'].systemPrompt
 * 본문은 prompts/wealth-ranking-v9.prompt.ts에서 편집합니다.
 * 버전과 본문을 함께 선택하므로 로그와 저장 결과에도 선택한 버전이 기록됩니다.
 * 모델은 ai-model.config.ts, 인증키는 .env에서 관리합니다.
 */
export const readingPrompts = {
  'wealth-ranking': wealthRankingPromptVersions[ACTIVE_WEALTH_RANKING_PROMPT],
} as const;
