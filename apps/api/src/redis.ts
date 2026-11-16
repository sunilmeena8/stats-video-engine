import type { Logger } from '@statsopedia/utils/node';
import { Redis, type RedisOptions } from 'ioredis';

/**
 * Creates an ioredis connection that logs state changes once instead of on every retry.
 * The URL (which contains the password) is never logged.
 */
export function createRedisConnection(
  url: string,
  logger: Logger,
  options: RedisOptions = {},
): Redis {
  const connection = new Redis(url, options);
  let lastErrorMessage: string | undefined;

  connection.on('ready', () => {
    lastErrorMessage = undefined;
    logger.info('Redis connection ready');
  });
  connection.on('error', (error: Error) => {
    if (error.message === lastErrorMessage) return;
    lastErrorMessage = error.message;
    logger.warn({ err: error }, 'Redis connection error (retrying in background)');
  });

  return connection;
}

/** Closes gracefully when connected; otherwise stops reconnect attempts immediately. */
export async function closeRedisConnection(connection: Redis): Promise<void> {
  if (connection.status === 'ready') {
    await connection.quit();
  } else {
    connection.disconnect();
  }
}
