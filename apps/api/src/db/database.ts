import type pg from 'pg';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

/**
 * Runs `work` in a transaction on one pooled client: COMMIT on success, ROLLBACK on any error.
 * Everything `work` writes becomes visible together or not at all.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** PostgreSQL error codes this service reacts to. */
export const PG_ERROR = {
  uniqueViolation: '23505',
  undefinedTable: '42P01',
} as const;

export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}
