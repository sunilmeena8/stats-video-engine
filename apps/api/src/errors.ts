/** An error with a safe, client-facing status, code and message. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new HttpError(422, code, message, details);
