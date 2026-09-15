import { createServer } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { Agent } from 'undici';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { KieWealthRankingProvider } from '../src/modules/readings/infrastructure/kie-wealth-ranking.provider.js';
import { buildWealthRankingContext } from '../src/modules/readings/wealth-ranking-context.js';
import {
  wealthCharts,
  wealthModelOutput,
} from './fixtures/wealth-ranking.fixture.js';

it('uses the AI dispatcher with native Node fetch and releases connections at shutdown', async () => {
  // Local HTTP fixture, no real provider or credentials. This checks the runtime
  // dispatcher contract in addition to the virtual five-minute deadline test.
  const server = createServer((request, response) => {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify(wealthModelOutput()),
            },
            finish_reason: 'stop',
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const provider = new KieWealthRankingProvider(
    new ConfigService<EnvironmentVariables, true>({
      WEALTH_RANKING_ENABLED: true,
      KIE_API_KEY: 'local-test-key',
      WEALTH_RANKING_TIMEOUT_MS: 300_000,
    }),
    {
      wealthRanking: {
        model: 'gemini-3-8-flash-openai',
        responseFormat: 'prompt_json',
        reasoningEffort: null,
      },
    },
  );
  const nativeFetch = globalThis.fetch;
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local address');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_input, init) => {
        const dispatcher =
          init && 'dispatcher' in init ? init.dispatcher : undefined;
        expect(dispatcher).toBeInstanceOf(Agent);
        return nativeFetch(`http://127.0.0.1:${address.port}/completion`, init);
      });
    expect(
      await provider.generate(buildWealthRankingContext(wealthCharts())),
    ).toEqual(wealthModelOutput());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.restoreAllMocks();
    await provider.onModuleDestroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
