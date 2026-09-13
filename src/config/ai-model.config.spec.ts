import { AiModelConfigSchema, aiModelConfig } from './ai-model.config.js';

describe('AI model configuration', () => {
  it.each([
    '',
    '../other',
    'https://other.example',
    'gemini?key=value',
    'model/path',
  ])('rejects invalid model paths: %s', (model) => {
    expect(
      AiModelConfigSchema.safeParse({
        wealthRanking: { ...aiModelConfig().wealthRanking, model },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown options instead of silently ignoring configuration mistakes', () => {
    expect(
      AiModelConfigSchema.safeParse({
        wealthRanking: {
          ...aiModelConfig().wealthRanking,
          responseFormat: 'invalid',
        },
      }).success,
    ).toBe(false);
    expect(
      AiModelConfigSchema.safeParse({
        wealthRanking: {
          ...aiModelConfig().wealthRanking,
          apiKey: 'never-store-keys-here',
        },
      }).success,
    ).toBe(false);
  });
});
