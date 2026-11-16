import { validationReportSchema } from '@statsopedia/shared-schemas';
import type {
  MetricConfiguration,
  NormalizedDatasetInfo,
  ProcessingOptions,
  ValidationReport,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { HttpError } from '../errors.js';

export interface ProcessCsvInput {
  sourceFilePath: string;
  outputFilePath: string;
  reportFilePath: string;
  dataset: NormalizedDatasetInfo;
  metric: MetricConfiguration;
  processing: ProcessingOptions;
  expectedUnit: string | null;
}

export interface ProcessCsvResult {
  report: ValidationReport;
  outputFilePath: string | null;
  reportFilePath: string;
}

/** The data-processor operations the API uses. Injected so tests can run without Python. */
export interface DataProcessorClient {
  processCsv(input: ProcessCsvInput): Promise<ProcessCsvResult>;
  validateCsv(input: {
    sourceFilePath: string;
    metric: MetricConfiguration;
    expectedUnit: string | null;
  }): Promise<ValidationReport>;
}

const processResponseSchema = z.object({
  report: validationReportSchema,
  outputFilePath: z.string().nullable(),
  reportFilePath: z.string(),
});

/** The data-processor could not be reached or returned something unusable. */
export class ProcessorError extends HttpError {
  constructor(message: string) {
    super(502, 'PROCESSOR_UNAVAILABLE', message);
  }
}

export function createDataProcessorClient({
  baseUrl,
  timeoutMs,
  fetchImpl = fetch,
}: {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): DataProcessorClient {
  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ProcessorError(`Data processor request failed: ${reason}`);
    }
    const text = await response.text();
    if (!response.ok) {
      throw new ProcessorError(
        `Data processor returned HTTP ${response.status}: ${text.slice(0, 300)}`,
      );
    }
    // Responses from another service are external input: validate them.
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProcessorError('Data processor returned invalid JSON');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ProcessorError(
        `Data processor response does not match the contract: ${z.prettifyError(parsed.error)}`,
      );
    }
    return parsed.data;
  }

  return {
    processCsv: (input) => post('/process/csv', input, processResponseSchema),
    validateCsv: (input) => post('/validate', input, validationReportSchema),
  };
}
