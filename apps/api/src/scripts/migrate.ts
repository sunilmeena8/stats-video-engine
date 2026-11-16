/** Applies pending database migrations: `pnpm --filter @statsopedia/api db:migrate`. */
import { createLogger, loadEnvFile } from '@statsopedia/utils/node';
import pg from 'pg';

import { loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';

loadEnvFile();
const config = loadConfig(process.env);
const logger = createLogger({ service: 'api-migrate', level: config.LOG_LEVEL });
const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });

try {
  const applied = await migrate(pool, logger);
  logger.info({ applied }, applied.length ? 'Migrations complete' : 'Database is up to date');
} catch (error) {
  logger.error({ err: error }, 'Migration failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
