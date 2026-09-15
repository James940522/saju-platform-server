import { registerAs } from '@nestjs/config';
import { z } from 'zod';

export const AiModelConfigSchema = z.strictObject({
  wealthRanking: z.strictObject({
    // Kie의 /{model}/v1/chat/completions 경로에 들어가는 모델 식별자.
    model: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
    responseFormat: z.enum(['prompt_json', 'json_schema']),
    reasoningEffort: z.enum(['low', 'medium', 'high']).nullable(),
  }),
});

/**
 * 모델을 바꾸려면 아래 wealthRanking 설정만 수정하세요.
 * API 인증키는 이 파일에 넣지 않고 서버 루트 .env의 KIE_API_KEY에서 관리합니다.
 * 개발 서버는 변경 후 재시작, 운영 서버는 npm run build 후 재시작하세요.
 *
 * Gemini 3.8 Flash: model='gemini-3-8-flash-openai', responseFormat='prompt_json'
 * Gemini 2.5 Flash: model='gemini-2.5-flash', responseFormat='json_schema'
 * 다른 모델은 Kie의 chat completions 경로와 옵션 지원 여부를 확인하세요.
 * reasoningEffort=null이면 해당 옵션을 보내지 않고 Provider 기본값을 사용합니다.
 */
export const aiModelConfig = registerAs('aiModels', () =>
  AiModelConfigSchema.parse({
    wealthRanking: {
      model: 'gemini-3-8-flash-openai',
      // 3.8 문서에서 JSON Schema 옵션은 확인되지 않아 프롬프트로 JSON을 요청합니다.
      // 출력 schema와 참여자·근거 검증은 어떤 모드에서도 서버가 수행합니다.
      responseFormat: 'prompt_json',
      // 원국 계산은 서버에서 끝납니다. 짧은 비교/문장 생성의 지연을 줄이도록
      // 낮은 추론 강도를 요청합니다. null로 바꾸면 Kie 기본값을 사용합니다.
      reasoningEffort: 'low',
    },
  }),
);
