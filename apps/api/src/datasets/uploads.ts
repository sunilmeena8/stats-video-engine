import { createHash } from 'node:crypto';
import path from 'node:path';

import { HttpError } from '../errors.js';

/** Content types accepted for CSV uploads (browsers and OSes disagree on CSV's type). */
export const CSV_CONTENT_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
] as const;

const MAX_FILENAME_LENGTH = 120;

/**
 * Makes a client-supplied filename safe to store and display. It is metadata only: files are
 * always stored under server-generated names, so this never decides where anything is written.
 */
export function sanitizeFilename(raw: string | undefined): string {
  const base = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/_+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (!cleaned) return 'upload.csv';
  if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;
  const extension = path.extname(cleaned).slice(0, 10);
  return cleaned.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
}

export interface CsvUpload {
  data: Buffer;
  filename: string;
}

/**
 * Checks an uploaded body before it is stored: CSV filename, non-empty, and text (no NUL bytes).
 * Encoding and content are validated by the data-processor, which reports row-level problems.
 */
export function checkCsvUpload(body: unknown, rawFilename: string | undefined): CsvUpload {
  if (!Buffer.isBuffer(body)) {
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      `Send the CSV as the raw request body with Content-Type ${CSV_CONTENT_TYPES[0]}`,
    );
  }
  const filename = sanitizeFilename(rawFilename);
  if (path.extname(filename).toLowerCase() !== '.csv') {
    throw new HttpError(415, 'INVALID_FILE_TYPE', 'Only .csv files can be uploaded');
  }
  if (body.length === 0) {
    throw new HttpError(400, 'EMPTY_FILE', 'The uploaded file is empty');
  }
  if (body.subarray(0, 64 * 1024).includes(0)) {
    throw new HttpError(415, 'INVALID_FILE_TYPE', 'The file is binary, not a text CSV');
  }
  return { data: body, filename };
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
