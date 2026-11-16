import { pino, type Logger } from 'pino';

export type { Logger };

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface CreateLoggerOptions {
  /** Service name added to every log line, e.g. `api`. */
  service: string;
  level: LogLevel;
  version?: string;
}

/**
 * Structured JSON logger shared by all Node services. One JSON object per line with ISO
 * timestamps and string levels, so logs can be shipped to any aggregator without parsing rules.
 */
export function createLogger({ service, level, version }: CreateLoggerOptions): Logger {
  return pino({
    level,
    base: { service, ...(version ? { version } : {}) },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
