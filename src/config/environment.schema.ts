import { z } from 'zod';

export const EnvironmentSchema = z.object({
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
