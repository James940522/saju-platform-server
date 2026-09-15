import { EnvironmentSchema } from './environment.schema.js';
import { loggingOptions } from './logging.config.js';
const environment = {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  DIRECT_URL: 'postgresql://test:test@localhost/test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test',
};
describe('Logging configuration', () => {
  it('defaults to detailed development logs and production JSON summaries', () => {
    const development = EnvironmentSchema.parse(environment);
    expect(loggingOptions(development).logLevels).toContain('debug');
    expect(loggingOptions(development).json).toBe(false);
    const production = EnvironmentSchema.parse({
      ...environment,
      NODE_ENV: 'production',
    });
    expect(loggingOptions(production).logLevels).toContain('log');
    expect(loggingOptions(production).logLevels).not.toContain('debug');
    expect(loggingOptions(production).json).toBe(true);
  });
  it('accepts an explicit level and rejects invalid configuration', () => {
    const config = EnvironmentSchema.parse({
      ...environment,
      LOG_LEVEL: 'warn',
    });
    expect(loggingOptions(config).logLevels).toEqual([
      'fatal',
      'error',
      'warn',
    ]);
    expect(
      EnvironmentSchema.safeParse({
        ...environment,
        LOG_LEVEL: 'verbose-secret',
      }).success,
    ).toBe(false);
  });
});
describe('Wealth ranking configuration', () => {
  it.each(['', '   '])(
    'allows an empty .env key only while disabled (%j)',
    (key) => {
      expect(
        EnvironmentSchema.parse({ ...environment, KIE_API_KEY: key })
          .KIE_API_KEY,
      ).toBeUndefined();
      expect(
        EnvironmentSchema.safeParse({
          ...environment,
          KIE_API_KEY: key,
          WEALTH_RANKING_ENABLED: 'true',
        }).success,
      ).toBe(false);
    },
  );
  it('defaults to disabled and requires a key only when enabled', () => {
    expect(EnvironmentSchema.parse(environment).WEALTH_RANKING_ENABLED).toBe(
      false,
    );
    expect(
      EnvironmentSchema.safeParse({
        ...environment,
        WEALTH_RANKING_ENABLED: 'true',
      }).success,
    ).toBe(false);
    expect(
      EnvironmentSchema.parse({
        ...environment,
        WEALTH_RANKING_ENABLED: 'true',
        KIE_API_KEY: 'test',
      }).WEALTH_RANKING_ENABLED,
    ).toBe(true);
  });
  it('defaults to and caps AI generation at 300 seconds', () => {
    expect(EnvironmentSchema.parse(environment).WEALTH_RANKING_TIMEOUT_MS).toBe(
      300_000,
    );
    expect(
      EnvironmentSchema.parse({
        ...environment,
        WEALTH_RANKING_TIMEOUT_MS: '300000',
      }).WEALTH_RANKING_TIMEOUT_MS,
    ).toBe(300_000);
    expect(EnvironmentSchema.parse(environment).KASI_TIMEOUT_MS).toBe(2000);
  });
  it.each(['0', '300001', '600000', 'invalid'])(
    'rejects unbounded timeout %s',
    (timeout) => {
      expect(
        EnvironmentSchema.safeParse({
          ...environment,
          WEALTH_RANKING_TIMEOUT_MS: timeout,
        }).success,
      ).toBe(false);
    },
  );
});
describe('Withdrawal configuration', () => {
  it('keeps withdrawal disabled without server-only credentials', () => {
    expect(
      EnvironmentSchema.parse(environment).ACCOUNT_WITHDRAWAL_ENABLED,
    ).toBe(false);
  });
  it('fails startup when enabled without both admin credentials', () => {
    const result = EnvironmentSchema.safeParse({
      ...environment,
      ACCOUNT_WITHDRAWAL_ENABLED: 'true',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        'SUPABASE_SERVICE_ROLE_KEY',
        'KAKAO_ADMIN_KEY',
      ]);
  });
});

describe('KASI calendar configuration', () => {
  it('requires a separate special-service key when solar term verification is enabled', () => {
    expect(
      EnvironmentSchema.parse(environment)
        .KASI_SOLAR_TERMS_VERIFICATION_ENABLED,
    ).toBe(false);
    expect(
      EnvironmentSchema.safeParse({
        ...environment,
        KASI_SERVICE_KEY: 'lunar-only',
        KASI_SOLAR_TERMS_VERIFICATION_ENABLED: 'true',
      }).success,
    ).toBe(false);
    const parsed = EnvironmentSchema.parse({
      ...environment,
      KASI_SPECIAL_SERVICE_KEY: 'special%2B%2F%3D',
      KASI_SOLAR_TERMS_VERIFICATION_ENABLED: 'true',
    });
    expect(parsed.KASI_SPECIAL_SERVICE_KEY).toBe('special+/=');
    expect(parsed.KASI_SERVICE_KEY).toBeUndefined();
  });
  it.each([' ', '%20', 'private%key'])(
    'rejects an unusable enabled special key: %j',
    (key) => {
      expect(
        EnvironmentSchema.safeParse({
          ...environment,
          KASI_SPECIAL_SERVICE_KEY: key,
          KASI_SOLAR_TERMS_VERIFICATION_ENABLED: 'true',
        }).success,
      ).toBe(false);
    },
  );
  it('rejects an encoded blank key', () => {
    expect(
      EnvironmentSchema.safeParse({ ...environment, KASI_SERVICE_KEY: '%20' })
        .success,
    ).toBe(false);
  });
  it('keeps optional verification off and accepts an empty key', () => {
    const parsed = EnvironmentSchema.parse({
      ...environment,
      KASI_SERVICE_KEY: ' ',
    });
    expect(parsed.KASI_CALENDAR_VERIFICATION_ENABLED).toBe(false);
    expect(parsed.KASI_SERVICE_KEY).toBeUndefined();
    expect(parsed.KASI_TIMEOUT_MS).toBe(2000);
  });
  it('requires a key when verification is enabled', () => {
    expect(
      EnvironmentSchema.safeParse({
        ...environment,
        KASI_CALENDAR_VERIFICATION_ENABLED: 'true',
      }).success,
    ).toBe(false);
  });
  it.each(['sample+/=', 'sample%2B%2F%3D'])(
    'accepts portal key form without double encoding: %s',
    (key) => {
      expect(
        EnvironmentSchema.parse({ ...environment, KASI_SERVICE_KEY: key })
          .KASI_SERVICE_KEY,
      ).toBe('sample+/=');
    },
  );
  it('rejects malformed percent encoding without printing the secret', () => {
    const result = EnvironmentSchema.safeParse({
      ...environment,
      KASI_SERVICE_KEY: 'private%key',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.message).not.toContain('private%key');
  });
  it.each(['499', '3001', 'NaN'])(
    'bounds the additional network wait: %s',
    (timeout) => {
      expect(
        EnvironmentSchema.safeParse({
          ...environment,
          KASI_TIMEOUT_MS: timeout,
        }).success,
      ).toBe(false);
    },
  );
});
