/**
 * Seeds a fresh database. Idempotent: existing rows are left untouched.
 *
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a long passphrase' \
 *     pnpm --filter @statsopedia/api db:seed
 *
 * Creates the first admin (credentials only from the environment, never defaults), starter
 * topics, and version 1 of the bar chart race template.
 */
import { randomUUID } from 'node:crypto';

import { emailSchema, passwordSchema } from '@statsopedia/shared-schemas';
import { createLogger, loadEnvFile, parseEnv } from '@statsopedia/utils/node';
import pg from 'pg';
import { z } from 'zod';

import { hashPassword } from '../auth/passwords.js';
import { findUserByEmail, insertUser } from '../auth/repository.js';
import { loadConfig } from '../config.js';
import { upsertTemplate } from '../templates/templates.js';

/** Stable id, so projects and documentation can refer to the template. */
export const BAR_CHART_RACE_TEMPLATE_ID = '6f1c2a54-0d1e-4b8a-9b3c-5e7f2a1d4c01';

const TOPICS = [
  ['economy', 'Economy', 'GDP, trade, companies and wealth.'],
  ['population', 'Population', 'People, cities and demographics.'],
  ['technology', 'Technology', 'Products, platforms and adoption.'],
  ['sports', 'Sports', 'Records, rankings and results.'],
] as const;

loadEnvFile();
const config = loadConfig(process.env);
const seed = parseEnv(
  z.object({
    SEED_ADMIN_EMAIL: emailSchema.optional(),
    SEED_ADMIN_PASSWORD: passwordSchema.optional(),
    SEED_ADMIN_NAME: z.string().min(1).max(200).default('Administrator'),
    // Optional editor account for the dashboard server (DASHBOARD_API_EMAIL / _PASSWORD).
    SEED_DASHBOARD_EMAIL: emailSchema.optional(),
    SEED_DASHBOARD_PASSWORD: passwordSchema.optional(),
  }),
  process.env,
);
const logger = createLogger({ service: 'api-seed', level: config.LOG_LEVEL });
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });

try {
  await upsertTemplate(pool, {
    id: BAR_CHART_RACE_TEMPLATE_ID,
    slug: 'bar-chart-race',
    version: 1,
    name: 'Bar chart race',
    description: 'Animated horizontal ranking with editorial annotations (16:9 and 9:16).',
    compositionId: 'BarChartRace',
    supportedFormats: ['long', 'short'],
  });
  for (const [slug, name, description] of TOPICS) {
    await pool.query(
      'INSERT INTO topics (id, slug, name, description) VALUES ($1, $2, $3, $4) ON CONFLICT (slug) DO NOTHING',
      [randomUUID(), slug, name, description],
    );
  }

  const ensureUser = async (
    email: string,
    password: string,
    name: string,
    role: 'admin' | 'editor',
  ) => {
    if (await findUserByEmail(pool, email)) {
      logger.info({ email }, 'User already exists; password unchanged');
      return;
    }
    await insertUser(pool, {
      id: randomUUID(),
      email,
      name,
      role,
      passwordHash: await hashPassword(password),
    });
    logger.info({ email, role }, 'User created');
  };
  if (seed.SEED_ADMIN_EMAIL && seed.SEED_ADMIN_PASSWORD) {
    await ensureUser(
      seed.SEED_ADMIN_EMAIL,
      seed.SEED_ADMIN_PASSWORD,
      seed.SEED_ADMIN_NAME,
      'admin',
    );
  } else {
    logger.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no admin account created');
  }
  if (seed.SEED_DASHBOARD_EMAIL && seed.SEED_DASHBOARD_PASSWORD) {
    await ensureUser(
      seed.SEED_DASHBOARD_EMAIL,
      seed.SEED_DASHBOARD_PASSWORD,
      'Dashboard service',
      'editor',
    );
  }
  logger.info({ templateId: BAR_CHART_RACE_TEMPLATE_ID, topics: TOPICS.length }, 'Seed complete');
} catch (error) {
  logger.error({ err: error }, 'Seed failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
