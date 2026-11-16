import type { RenderErrorCode } from '@statsopedia/shared-types';
import { ZodError } from 'zod';

/** A render failure with a stable code and a decision on whether retrying can help. */
export class RenderError extends Error {
  override name = 'RenderError';

  constructor(
    readonly code: RenderErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Bad input or state that no retry can fix: fail at once. */
export const permanentError = (code: RenderErrorCode, message: string, cause?: unknown) =>
  new RenderError(code, message, false, { cause });

/** A transient problem (crashed browser, timeout, I/O hiccup): retry if attempts remain. */
export const retryableError = (code: RenderErrorCode, message: string, cause?: unknown) =>
  new RenderError(code, message, true, { cause });

/** The job was cancelled or finished elsewhere while this attempt ran; stop quietly. */
export class JobSupersededError extends Error {
  override name = 'JobSupersededError';
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Node errors that mean the disk or permissions are wrong: retrying will not help. */
const PERMANENT_IO = new Set(['EACCES', 'EPERM', 'EROFS']);
/** Database errors worth retrying (connection loss, serialization, admin shutdown). */
const TRANSIENT_DB = /^(08|40|53|57P)/;

/**
 * Classifies any error thrown while rendering. Unknown errors are treated as retryable: a
 * render is deterministic, so a genuine bug fails every attempt and still ends as `failed`,
 * while a flaky browser or a full disk that was cleaned up gets another chance.
 */
export function classifyError(error: unknown): RenderError {
  if (error instanceof RenderError) return error;
  if (error instanceof ZodError) {
    return permanentError('INVALID_PROPS', `Render input is invalid: ${error.message}`, error);
  }
  const message = messageOf(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (PERMANENT_IO.has(code)) return permanentError('STORAGE_FAILED', message, error);
  if (code === 'ENOSPC' || code === 'EMFILE' || code === 'EIO') {
    return retryableError('STORAGE_FAILED', message, error);
  }
  if (TRANSIENT_DB.test(code) || /ECONNREFUSED|Connection terminated/i.test(message)) {
    return retryableError('DATABASE_FAILED', message, error);
  }
  if (/timed? ?out|delayRender/i.test(message)) {
    return retryableError('RENDER_TIMEOUT', message, error);
  }
  return retryableError('RENDER_FAILED', message, error);
}
