import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    env: {
      NODE_ENV: 'test',
      KASI_CALENDAR_VERIFICATION_ENABLED: 'false',
      KASI_SOLAR_TERMS_VERIFICATION_ENABLED: 'false',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    },
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
});
