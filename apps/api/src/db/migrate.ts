import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import type { Logger } from '@statsopedia/utils/node';
import type pg from 'pg';

import { withTransaction } from './database.js';

/** apps/api/migrations, from both src/db and dist/db. */
export const MIGRATIONS_DIRECTORY = new URL('../../migrations/', import.meta.url);

// Arbitrary constant: serializes concurrent migration runs across processes.
const MIGRATION_LOCK_ID = 7_382_114;

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(directory: URL = MIGRATIONS_DIRECTORY): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name));
  names.sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(new URL(name, directory), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/**
 * Applies pending migrations in order, each in its own transaction. Refuses to run if an
 * already-applied migration file was edited (its checksum changed).
 * @returns names of the migrations applied by this call.
 */
export async function migrate(
  pool: pg.Pool,
  logger: Logger,
  migrations?: Migration[],
): Promise<string[]> {
  const pending = migrations ?? (await loadMigrations());
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await pool.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));

    const ran: string[] = [];
    for (const migration of pending) {
      const checksum = applied.get(migration.name);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after it was applied. ` +
              'Add a new migration instead of editing an applied one.',
          );
        }
        continue;
      }
      await withTransaction(pool, async (client) => {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
      });
      logger.info({ migration: migration.name }, 'Migration applied');
      ran.push(migration.name);
    }
    return ran;
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    lock.release();
  }
}
