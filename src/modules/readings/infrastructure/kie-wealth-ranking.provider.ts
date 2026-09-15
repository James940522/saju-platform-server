import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService, type ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { Agent } from 'undici';
import { aiModelConfig } from '../../../config/ai-model.config.js';
import {
  parseWealthRankingCompletion,
  wealthCompletionFormat,
} from './wealth-ranking-completion.js';
import {
  WEALTH_RANKING_AI_TIMEOUT_MS,
  WEALTH_RANKING_SAVE_RESERVE_MS,
  WEALTH_RANKING_JOB_TIMEOUT_MS,
} from '../../../config/wealth-ranking-runtime.config.js';
import type { WealthRankingDeadline } from '../wealth-ranking-deadline.js';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import type { WealthRankingContext } from '../wealth-ranking-context.js';
import {
  wealthRankingFailure,
  getWealthRankingFailureDiagnostic,
  type WealthRankingFailureStage,
} from '../wealth-ranking-failure.js';
import {
  buildWealthRankingMessages,
  WEALTH_RANKING_PROMPT_VERSION,
  WealthRankingModelOutputSchema,
} from './wealth-ranking.prompt.js';

const KIE_ORIGIN = 'https://api.kie.ai';
const MAX_RESPONSE_BYTES = 65_536;
const WAIT_LOG_INTERVAL_MS = 30_000;
const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.literal('assistant'),
          content: z.string().min(1),
          refusal: z.null().optional(),
          tool_calls: z.array(z.unknown()).length(0).optional(),
        }),
        finish_reason: z.literal('stop'),
      }),
    )
    .length(1),
});

// The Kie 3.8 chat-completions documentation also shows Gemini's native envelope.
// Accept completed text only; do not turn tool calls or thought parts into output.
const GeminiCompletionSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({
          role: z.literal('model'),
          parts: z
            .array(
              z.strictObject({
                text: z.string(),
                thought: z.boolean().optional(),
                thoughtSignature: z.string().optional(),
              }),
            )
            .min(1),
        }),
        finishReason: z.literal('STOP'),
      }),
    )
    .length(1),
});

function extractCompletionText(value: unknown): string {
  const chat = ChatCompletionSchema.safeParse(value);
  if (chat.success && chat.data.choices[0])
    return chat.data.choices[0].message.content;
  const gemini = GeminiCompletionSchema.safeParse(value);
  if (gemini.success && gemini.data.candidates[0]) {
    const text = gemini.data.candidates[0].content.parts
      .filter((part) => part.thought !== true)
      .map((part) => part.text)
      .join('');
    if (text.trim()) return text;
  }
  throw wealthRankingFailure('provider_completion');
}

export function buildKieWealthRankingRequest(
  context: WealthRankingContext,
  settings: ConfigType<typeof aiModelConfig>['wealthRanking'],
) {
  const schema = z.toJSONSchema(WealthRankingModelOutputSchema);
  const messages = buildWealthRankingMessages(context);
  if (settings.responseFormat === 'prompt_json') {
    messages.unshift({
      role: 'system',
      content: `출력은 다음 JSON Schema를 따르는 JSON 객체 하나여야 합니다. 코드 펜스 없이 JSON만 출력하세요.\n${JSON.stringify(schema)}`,
    });
  }
  return {
    messages,
    stream: false,
    include_thoughts: false,
    ...(settings.reasoningEffort === null
      ? {}
      : { reasoning_effort: settings.reasoningEffort }),
    ...(settings.responseFormat === 'json_schema'
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'wealth_ranking',
              strict: true,
              schema,
            },
          },
        }
      : {}),
  };
}

@Injectable()
export class KieWealthRankingProvider implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(KieWealthRankingProvider.name);
  // Native fetch otherwise has a separate five-minute headers/body deadline.
  // The bounded AbortSignal below owns this AI request's total deadline.
  private readonly dispatcher = new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
  });
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(aiModelConfig.KEY)
    private readonly models: ConfigType<typeof aiModelConfig>,
  ) {}

  onModuleInit() {
    // Shows which configuration the running process actually loaded, without keys.
    this.logger.log({
      event: 'wealth_ranking_provider_configured',
      enabled: this.config.get('WEALTH_RANKING_ENABLED', { infer: true }),
      model: this.models.wealthRanking.model,
      promptVersion: WEALTH_RANKING_PROMPT_VERSION,
      reasoningEffort:
        this.models.wealthRanking.reasoningEffort ?? 'provider_default',
      providerTimeoutMs: Math.min(
        this.config.get('WEALTH_RANKING_TIMEOUT_MS', { infer: true }),
        WEALTH_RANKING_AI_TIMEOUT_MS,
      ),
      jobTimeoutMs: WEALTH_RANKING_JOB_TIMEOUT_MS,
    });
  }

  async onModuleDestroy() {
    await this.dispatcher.destroy();
  }

  assertAvailable() {
    if (
      !this.config.get('WEALTH_RANKING_ENABLED', { infer: true }) ||
      !this.config.get('KIE_API_KEY', { infer: true })
    ) {
      throw new ServiceUnavailableException({ reason: 'READING_UNAVAILABLE' });
    }
  }

  async generate(
    context: WealthRankingContext,
    requestId?: string,
    deadline?: WealthRankingDeadline,
  ): Promise<unknown> {
    this.assertAvailable();
    const settings = this.models.wealthRanking;
    const body = JSON.stringify(
      buildKieWealthRankingRequest(context, settings),
    );
    const timeoutMs = Math.min(
      this.config.get('WEALTH_RANKING_TIMEOUT_MS', { infer: true }),
      WEALTH_RANKING_AI_TIMEOUT_MS,
      deadline?.remainingMs(WEALTH_RANKING_SAVE_RESERVE_MS) ??
        WEALTH_RANKING_AI_TIMEOUT_MS,
    );
    const requestTimeout = AbortSignal.timeout(timeoutMs);
    const signal = deadline
      ? AbortSignal.any([requestTimeout, deadline.signal])
      : requestTimeout;
    let stage: WealthRankingFailureStage = 'provider_transport';
    const startedAt = performance.now();
    let httpStatus: number | null = null;
    let headersAfterMs: number | null = null;
    let responseBytes = 0;
    let completionChars: number | null = null;
    let completionFormat: ReturnType<typeof wealthCompletionFormat> | null =
      null;
    const identity = {
      source: 'kie',
      method: 'POST',
      endpoint: `${KIE_ORIGIN}/${settings.model}/v1/chat/completions`,
      callId: randomUUID(),
      ...(requestId ? { requestId } : {}),
    };
    // Metadata only: never include messages, chart facts or authentication headers.
    const requestMetadata = {
      timeoutMs,
      promptVersion: WEALTH_RANKING_PROMPT_VERSION,
      participantCount: context.length,
      requestBytes: Buffer.byteLength(body, 'utf8'),
      reasoningEffort: settings.reasoningEffort ?? 'provider_default',
    };
    this.logger.debug({
      event: 'kie_request_started',
      ...identity,
      ...requestMetadata,
    });
    const waitingLog = setInterval(() => {
      this.logger.log({
        event: 'kie_request_waiting',
        ...identity,
        ...requestMetadata,
        stage:
          httpStatus === null
            ? 'waiting_response_headers'
            : 'waiting_response_body',
        httpStatus,
        responseBytes,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }, WAIT_LOG_INTERVAL_MS);
    waitingLog.unref();
    try {
      signal.throwIfAborted();
      const options: RequestInit & { dispatcher: Agent } = {
        method: 'POST',
        dispatcher: this.dispatcher,
        signal,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.config.get('KIE_API_KEY', { infer: true })}`,
          'Content-Type': 'application/json',
        },
        body,
      };
      const response = await fetch(
        `${KIE_ORIGIN}/${settings.model}/v1/chat/completions`,
        options,
      );
      httpStatus = response.status;
      headersAfterMs = Math.round(performance.now() - startedAt);
      this.logger.debug({
        event: 'kie_response_headers_received',
        ...identity,
        httpStatus,
        headersAfterMs,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw wealthRankingFailure('provider_http', response.status);
      }
      if (!response.body) throw wealthRankingFailure('provider_empty_body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          responseBytes += chunk.value.byteLength;
          if (responseBytes > MAX_RESPONSE_BYTES)
            throw wealthRankingFailure('provider_response_size');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      stage = 'provider_response_json';
      const raw: unknown = JSON.parse(
        Buffer.concat(chunks).toString('utf8').trim(),
      );
      stage = 'model_output_json';
      const content = extractCompletionText(raw);
      completionChars = content.length;
      completionFormat = wealthCompletionFormat(content);
      const output = parseWealthRankingCompletion(content);
      this.logger.debug({
        event: 'kie_request_completed',
        ...identity,
        ...requestMetadata,
        httpStatus,
        headersAfterMs,
        responseBytes,
        completionChars,
        completionFormat,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return output;
    } catch (error: unknown) {
      // Never log or expose request data, credentials or provider response text.
      const failure = signal.aborted
        ? wealthRankingFailure('provider_timeout')
        : error instanceof BadGatewayException
          ? error
          : wealthRankingFailure(stage);
      this.logger.error({
        event: 'kie_request_failed',
        ...identity,
        ...requestMetadata,
        httpStatus,
        headersAfterMs,
        responseBytes,
        completionChars,
        completionFormat,
        durationMs: Math.round(performance.now() - startedAt),
        ...getWealthRankingFailureDiagnostic(failure),
      });
      throw failure;
    } finally {
      clearInterval(waitingLog);
    }
  }
}
