import {
  BadGatewayException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService, type ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { aiModelConfig } from '../../../config/ai-model.config.js';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import type { WealthRankingContext } from '../wealth-ranking-context.js';
import { invalidWealthRankingOutput } from '../wealth-ranking-result.js';
import {
  buildWealthRankingMessages,
  WealthRankingModelOutputSchema,
} from './wealth-ranking.prompt.js';

const KIE_ORIGIN = 'https://api.kie.ai';
const MAX_RESPONSE_BYTES = 65_536;
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
  throw invalidWealthRankingOutput();
}

@Injectable()
export class KieWealthRankingProvider {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(aiModelConfig.KEY)
    private readonly models: ConfigType<typeof aiModelConfig>,
  ) {}

  assertAvailable() {
    if (
      !this.config.get('WEALTH_RANKING_ENABLED', { infer: true }) ||
      !this.config.get('KIE_API_KEY', { infer: true })
    ) {
      throw new ServiceUnavailableException({ reason: 'READING_UNAVAILABLE' });
    }
  }

  async generate(context: WealthRankingContext): Promise<unknown> {
    this.assertAvailable();
    const settings = this.models.wealthRanking;
    const schema = z.toJSONSchema(WealthRankingModelOutputSchema);
    const messages = buildWealthRankingMessages(context);
    if (settings.responseFormat === 'prompt_json') {
      messages.unshift({
        role: 'system',
        content: `출력은 다음 JSON Schema를 따르는 JSON 객체 하나여야 합니다. 코드 펜스 없이 JSON만 출력하세요.\n${JSON.stringify(schema)}`,
      });
    }
    const signal = AbortSignal.timeout(
      this.config.get('WEALTH_RANKING_TIMEOUT_MS', { infer: true }),
    );
    try {
      const response = await fetch(
        `${KIE_ORIGIN}/${settings.model}/v1/chat/completions`,
        {
          method: 'POST',
          signal,
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${this.config.get('KIE_API_KEY', { infer: true })}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
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
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new BadGatewayException({ reason: 'READING_PROVIDER_FAILED' });
      }
      if (!response.body) throw invalidWealthRankingOutput();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw invalidWealthRankingOutput();
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const output: unknown = JSON.parse(extractCompletionText(raw));
      return output;
    } catch (error: unknown) {
      if (signal.aborted)
        throw new GatewayTimeoutException({ reason: 'READING_TIMEOUT' });
      if (error instanceof BadGatewayException) throw error;
      // Never log or expose request data, credentials or provider response text.
      throw new BadGatewayException({ reason: 'READING_PROVIDER_FAILED' });
    }
  }
}
