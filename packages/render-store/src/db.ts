import type pg from 'pg';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

/** A pool that can hand out a client for a transaction. */
export type TransactionPool = Pick<pg.Pool, 'connect'>;

/** Runs `work` in one transaction: COMMIT on success, ROLLBACK on any error. */
export async function withTransaction<T>(
  pool: TransactionPool,
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

export const PG_ERROR = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  undefinedTable: '42P01',
} as const;

export function pgErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

export const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
