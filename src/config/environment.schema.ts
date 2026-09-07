import { z } from 'zod';

export const EnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
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
