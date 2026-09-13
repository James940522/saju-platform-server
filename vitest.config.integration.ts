import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
      DIRECT_URL: 'postgresql://unused:unused@localhost:5432/unused',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    },
    globals: true,
    include: ['test/*.integration-spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
