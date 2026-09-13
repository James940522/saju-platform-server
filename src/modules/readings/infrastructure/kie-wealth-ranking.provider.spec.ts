import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiModelConfigSchema } from '../../../config/ai-model.config.js';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import {
  wealthCharts,
  wealthModelOutput,
} from '../../../../test/fixtures/wealth-ranking.fixture.js';
import { buildWealthRankingContext } from '../wealth-ranking-context.js';
import { KieWealthRankingProvider } from './kie-wealth-ranking.provider.js';

// Fixed transport fixtures: changing the user's selected model must not require
// editing tests that verify each supported wire format.
function gemini38Settings() {
  return AiModelConfigSchema.parse({
    wealthRanking: {
      model: 'gemini-3-8-flash-openai',
      responseFormat: 'prompt_json',
      reasoningEffort: null,
    },
  });
}

function provider(enabled = true, models = gemini38Settings()) {
  return new KieWealthRankingProvider(
    new ConfigService<EnvironmentVariables, true>({
      WEALTH_RANKING_ENABLED: enabled,
      KIE_API_KEY: 'test-only-key',
      WEALTH_RANKING_TIMEOUT_MS: 1000,
    }),
    models,
  );
}
function completion(
  content = JSON.stringify(wealthModelOutput()),
  finishReason = 'stop',
) {
  return Response.json({
    choices: [
      { message: { role: 'assistant', content }, finish_reason: finishReason },
    ],
  });
}

describe('Kie wealth ranking transport', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const context = buildWealthRankingContext(wealthCharts());
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses Gemini 3.8 and includes the output schema in the prompt', async () => {
    fetchMock.mockResolvedValue(completion());
    expect(await provider().generate(context)).toEqual(wealthModelOutput());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions',
    );
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      stream: false,
      include_thoughts: false,
    });
    expect(body).not.toHaveProperty('response_format');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(init.body).toContain('evidenceIds');
    expect(init.body).toContain('additionalProperties');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('functions');
  });

  it('changes the endpoint and generation options through model configuration', async () => {
    fetchMock.mockResolvedValue(completion());
    await provider(true, {
      wealthRanking: {
        model: 'gemini-2.5-flash',
        responseFormat: 'json_schema',
        reasoningEffort: 'high',
      },
    }).generate(context);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.kie.ai/gemini-2.5-flash/v1/chat/completions');
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      reasoning_effort: 'high',
      response_format: { type: 'json_schema', json_schema: { strict: true } },
    });
  });

  it('normalizes completed Gemini text without thought content or signatures', async () => {
    const json = JSON.stringify(wealthModelOutput());
    fetchMock.mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'private thought', thought: true },
                {
                  text: json.slice(0, 20),
                  thoughtSignature: 'private signature',
                },
                { text: json.slice(20) },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    );
    expect(await provider().generate(context)).toEqual(wealthModelOutput());
  });

  it('does not call an unconfigured provider', async () => {
    await expect(provider(false).generate(context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'provider error',
      () => new Response('private provider error', { status: 429 }),
    ],
    ['invalid JSON', () => new Response('private invalid response')],
    ['truncated output', () => completion('{}', 'length')],
    ['refusal', () => completion('{}', 'content_filter')],
    ['invalid content', () => completion('not JSON')],
    ['oversized output', () => new Response('a'.repeat(65_537))],
    [
      'Gemini truncated output',
      () =>
        Response.json({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: '{}' }] },
              finishReason: 'MAX_TOKENS',
            },
          ],
        }),
    ],
    [
      'Gemini tool call',
      () =>
        Response.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: '{}', functionCall: { name: 'search' } }],
              },
              finishReason: 'STOP',
            },
          ],
        }),
    ],
    [
      'Gemini thoughts only',
      () =>
        Response.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: '{}', thought: true }],
              },
              finishReason: 'STOP',
            },
          ],
        }),
    ],
  ])(
    'rejects %s without retrying or exposing provider text',
    async (_title, response) => {
      fetchMock.mockResolvedValue(response());
      const result = provider().generate(context);
      await expect(result).rejects.toBeInstanceOf(BadGatewayException);
      await expect(result).rejects.not.toThrow('private');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('aborts a slow request without retrying', async () => {
    // Real AbortSignal.timeout uses a native clock; shorten the configured test timeout.
    const shortProvider = new KieWealthRankingProvider(
      new ConfigService<EnvironmentVariables, true>({
        WEALTH_RANKING_ENABLED: true,
        KIE_API_KEY: 'test',
        WEALTH_RANKING_TIMEOUT_MS: 10,
      }),
      gemini38Settings(),
    );
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          );
        }),
    );
    await expect(shortProvider.generate(context)).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
