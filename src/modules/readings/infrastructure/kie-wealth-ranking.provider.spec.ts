import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import { AiModelConfigSchema } from '../../../config/ai-model.config.js';
import { readingPrompts } from '../../../config/reading-prompts.config.js';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import {
  wealthCharts,
  wealthModelOutput,
} from '../../../../test/fixtures/wealth-ranking.fixture.js';
import { buildWealthRankingContext } from '../wealth-ranking-context.js';
import { getWealthRankingFailureDiagnostic } from '../wealth-ranking-failure.js';
import { KieWealthRankingProvider } from './kie-wealth-ranking.provider.js';
import { WealthRankingDeadline } from '../wealth-ranking-deadline.js';

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
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports the configuration actually loaded without exposing credentials', async () => {
    const service = provider(true, {
      wealthRanking: {
        ...gemini38Settings().wealthRanking,
        reasoningEffort: 'low',
      },
    });
    service.onModuleInit();
    expect(Logger.prototype.log).toHaveBeenCalledWith({
      event: 'wealth_ranking_provider_configured',
      enabled: true,
      model: 'gemini-3-8-flash-openai',
      promptVersion: readingPrompts['wealth-ranking'].version,
      reasoningEffort: 'low',
      providerTimeoutMs: 1000,
      jobTimeoutMs: 300_000,
    });
    expect(Logger.prototype.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ KIE_API_KEY: expect.anything() }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await service.onModuleDestroy();
  });

  it('reports an outstanding header wait and stops periodic logs after completion', async () => {
    vi.useFakeTimers();
    let respond!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const service = provider();
    const operation = service.generate(context, 'waiting-request');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'kie_request_waiting',
        requestId: 'waiting-request',
        stage: 'waiting_response_headers',
        httpStatus: null,
        responseBytes: 0,
        elapsedMs: 30_000,
      }),
    );
    respond(completion());
    await operation;
    const logCount = vi.mocked(Logger.prototype.log).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.mocked(Logger.prototype.log).mock.calls).toHaveLength(logCount);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.log).mock.calls),
    ).not.toMatch(/test-only-key|동명이인|year\.stem/);
    await service.onModuleDestroy();
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
    expect(body).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('"fortuneTellerAnalysis":'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('"dayMasterStrength":'),
        }),
      ]),
    });
    expect(init.body).not.toContain('calendarVerification');
    expect(init.body).not.toContain('solarTermVerification');
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

  it('logs payload size and response timing without logging prompt or response content', async () => {
    const response = completion();
    const responseBytes = Buffer.byteLength(await response.clone().text());
    fetchMock.mockResolvedValue(response);
    const service = provider();
    try {
      await service.generate(context, 'timing-request');
      const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
      if (typeof requestBody !== 'string')
        throw new Error('Expected JSON body');
      const metadata = {
        requestId: 'timing-request',
        timeoutMs: 1000,
        promptVersion: expect.any(String),
        participantCount: context.length,
        requestBytes: Buffer.byteLength(requestBody),
        reasoningEffort: 'provider_default',
      };
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'kie_request_started', ...metadata }),
      );
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'kie_response_headers_received',
          requestId: 'timing-request',
          httpStatus: 200,
          headersAfterMs: expect.any(Number),
        }),
      );
      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'kie_request_completed',
          ...metadata,
          httpStatus: 200,
          headersAfterMs: expect.any(Number),
          responseBytes,
          durationMs: expect.any(Number),
        }),
      );
      const logged = JSON.stringify(
        vi.mocked(Logger.prototype.debug).mock.calls,
      );
      expect(logged).not.toContain(requestBody);
      expect(logged).not.toContain(wealthModelOutput().rationale);
      expect(logged).not.toMatch(
        /test-only-key|p1\.year\.stem|tenGod|Authorization/,
      );
    } finally {
      await service.onModuleDestroy();
    }
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

  it.each(['plain', 'bom', 'fenced', 'double_encoded'])(
    'accepts a complete %s JSON payload without another model call',
    async (kind) => {
      const json = JSON.stringify(wealthModelOutput());
      const text =
        kind === 'bom'
          ? '\uFEFF' + json
          : kind === 'fenced'
            ? '```json\n' + json + '\n```'
            : kind === 'double_encoded'
              ? JSON.stringify(json)
              : json;
      fetchMock.mockResolvedValue(completion(text));
      const service = provider();
      expect(await service.generate(context)).toEqual(wealthModelOutput());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await service.onModuleDestroy();
    },
  );

  it.each([
    'Here is your result: {"ranking":[]}',
    '```json\n{}\n```\nextra',
    '{"ranking":',
    'Provider is busy, try again',
  ])(
    'rejects incomplete or mixed output and records only its shape (%s)',
    async (text) => {
      fetchMock.mockResolvedValue(completion(text));
      const service = provider();
      await expect(service.generate(context)).rejects.toMatchObject({
        cause: { stage: 'model_output_json' },
      });
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'model_output_json',
          completionChars: text.length,
          completionFormat: expect.any(String),
        }),
      );
      expect(
        JSON.stringify(vi.mocked(Logger.prototype.error).mock.calls),
      ).not.toContain(text);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await service.onModuleDestroy();
    },
  );

  it.each([
    [
      'provider error',
      () => new Response('private provider error', { status: 429 }),
      'provider_http',
    ],
    [
      'invalid JSON',
      () => new Response('private invalid response'),
      'provider_response_json',
    ],
    [
      'truncated output',
      () => completion('{}', 'length'),
      'provider_completion',
    ],
    [
      'refusal',
      () => completion('{}', 'content_filter'),
      'provider_completion',
    ],
    [
      'invalid content',
      () => completion('private not JSON'),
      'model_output_json',
    ],
    [
      'oversized output',
      () => new Response('a'.repeat(65_537)),
      'provider_response_size',
    ],
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
      'provider_completion',
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
      'provider_completion',
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
      'provider_completion',
    ],
  ])(
    'rejects %s without retrying or exposing provider text',
    async (_title, response, stage) => {
      fetchMock.mockResolvedValue(response());
      const result = provider().generate(context, 'test-request-123');
      await expect(result).rejects.toBeInstanceOf(BadGatewayException);
      await expect(result).rejects.not.toThrow('private');
      const failure: unknown = await result.catch((error: unknown) => error);
      const diagnostic = getWealthRankingFailureDiagnostic(failure);
      expect(diagnostic).toMatchObject({ stage, status: 502 });
      if (stage === 'provider_http')
        expect(diagnostic?.upstreamStatus).toBe(429);
      expect(JSON.stringify(failure)).not.toContain('private');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'kie_request_failed',
          source: 'kie',
          method: 'POST',
          endpoint:
            'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions',
          requestId: 'test-request-123',
          callId: expect.any(String),
          stage,
        }),
      );
      const logged = JSON.stringify(
        vi.mocked(Logger.prototype.error).mock.calls,
      );
      expect(logged).not.toMatch(/private|test-only-key|동명이인/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('identifies transport failures without retaining the original exception', async () => {
    fetchMock.mockRejectedValue(
      new Error('private request URL and credentials'),
    );
    const failure: unknown = await provider()
      .generate(context)
      .catch((error: unknown) => error);
    expect(getWealthRankingFailureDiagnostic(failure)).toEqual({
      reason: 'READING_PROVIDER_FAILED',
      status: 502,
      stage: 'provider_transport',
    });
    expect(JSON.stringify(failure)).not.toContain('private');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

  it('uses only the remaining job budget and cancels the live request when that job expires', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const deadline = new WealthRankingDeadline(Date.now() + 20_000);
    const service = new KieWealthRankingProvider(
      new ConfigService<EnvironmentVariables, true>({
        WEALTH_RANKING_ENABLED: true,
        KIE_API_KEY: 'test',
        WEALTH_RANKING_TIMEOUT_MS: 300_000,
      }),
      gemini38Settings(),
    );
    let requestSignal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((_input, init) => {
      requestSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      });
    });
    const operation = service
      .generate(context, 'shared-deadline', deadline)
      .catch((error: unknown) => error);
    try {
      expect(timeoutSpy).toHaveBeenCalledWith(15_000);
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await operation).toBeInstanceOf(GatewayTimeoutException);
      expect(requestSignal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      deadline.dispose();
      await service.onModuleDestroy();
    }
  });

  it('aborts at 300 seconds with no automatic retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), delay);
      return controller.signal;
    });
    const service = new KieWealthRankingProvider(
      new ConfigService<EnvironmentVariables, true>({
        WEALTH_RANKING_ENABLED: true,
        KIE_API_KEY: 'test-only-key',
        WEALTH_RANKING_TIMEOUT_MS: 300_000,
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
    const failed = vi.fn();
    const operation = service.generate(context).catch((error: unknown) => {
      failed();
      return error;
    });
    try {
      await vi.advanceTimersByTimeAsync(299_999);
      expect(failed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await operation).toBeInstanceOf(GatewayTimeoutException);
      expect(AbortSignal.timeout).toHaveBeenCalledWith(300_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'kie_request_failed',
          timeoutMs: 300_000,
          httpStatus: null,
          headersAfterMs: null,
          responseBytes: 0,
          stage: 'provider_timeout',
        }),
      );
      const options = fetchMock.mock.calls[0]?.[1];
      const dispatcher =
        options && 'dispatcher' in options ? options.dispatcher : undefined;
      expect(dispatcher).toBeInstanceOf(Agent);
      await service.onModuleDestroy();
      if (!(dispatcher instanceof Agent))
        throw new Error('Expected AI dispatcher');
      expect(dispatcher.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
      await service.onModuleDestroy();
    }
  });
});
