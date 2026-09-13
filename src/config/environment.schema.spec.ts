import { EnvironmentSchema } from './environment.schema.js';
const environment = {
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  DIRECT_URL: 'postgresql://test:test@localhost/test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test',
};
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
  it.each(['0', '60001', 'invalid'])(
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
