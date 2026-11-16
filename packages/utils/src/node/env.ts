import { readFileSync } from 'node:fs';

import { z } from 'zod';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Validates environment variables against a Zod schema and returns typed config.
 * Empty strings are treated as unset so `.default()` values apply to `KEY=` lines.
 * Throws a ConfigError listing every problem, so services fail fast at start-up.
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  env: Record<string, string | undefined>,
): z.output<Schema> {
  const defined = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse(defined);
  if (!result.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Loads a dotenv file into `process.env` if it exists. Variables already set in the real
 * environment win, so deployments can override anything in the file.
 * @returns whether a file was loaded.
 */
export function loadEnvFile(filePath = '.env'): boolean {
  try {
    process.loadEnvFile(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

const packageJsonSchema = z.object({ version: z.string().min(1) });

/** Reads `version` from a package.json, e.g. `readPackageVersion(new URL('../package.json', import.meta.url))`. */
export function readPackageVersion(packageJsonUrl: URL): string {
  const raw: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf8'));
  return packageJsonSchema.parse(raw).version;
}
