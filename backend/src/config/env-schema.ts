import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().regex(/^\d+$/).default('3000')
    .transform(Number).pipe(z.number().int().min(1).max(65535)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export function parseEnv(input: Record<string, string | undefined>) {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    // Report names only: configuration values may contain secrets.
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
