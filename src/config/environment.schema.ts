import { z } from 'zod';

const KasiServiceKeySchema = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .transform((value, context) => {
      // Accept either the portal's Decoding key or its once-encoded Encoding key.
      try {
        return decodeURIComponent(value);
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'Invalid service key encoding',
        });
        return z.NEVER;
      }
    })
    .pipe(z.string().trim().min(1))
    .optional(),
);

export const EnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url()).min(1)),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
    ACCOUNT_WITHDRAWAL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1).optional(),
    KAKAO_ADMIN_KEY: z.string().trim().min(1).optional(),
    WEALTH_RANKING_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    KIE_API_KEY: z.preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().trim().min(1).optional(),
    ),
    WEALTH_RANKING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(60_000)
      .default(30_000),
    KASI_CALENDAR_VERIFICATION_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    KASI_SERVICE_KEY: KasiServiceKeySchema,
    KASI_TIMEOUT_MS: z.coerce.number().int().min(500).max(3000).default(2000),
  })
  .superRefine((environment, context) => {
    if (
      environment.KASI_CALENDAR_VERIFICATION_ENABLED &&
      !environment.KASI_SERVICE_KEY
    ) {
      context.addIssue({
        code: 'custom',
        path: ['KASI_SERVICE_KEY'],
        message: 'Required when KASI calendar verification is enabled',
      });
    }
    if (environment.WEALTH_RANKING_ENABLED && !environment.KIE_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['KIE_API_KEY'],
        message: 'Required when wealth ranking is enabled',
      });
    }
    if (!environment.ACCOUNT_WITHDRAWAL_ENABLED) return;
    for (const key of [
      'SUPABASE_SERVICE_ROLE_KEY',
      'KAKAO_ADMIN_KEY',
    ] as const) {
      if (!environment[key])
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when account withdrawal is enabled',
        });
    }
  });

export type EnvironmentVariables = z.output<typeof EnvironmentSchema>;

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  const result = EnvironmentSchema.safeParse(environment);

  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues
    .map(
      (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
    )
    .join('; ');

  throw new Error(`Invalid environment configuration: ${issues}`);
}
