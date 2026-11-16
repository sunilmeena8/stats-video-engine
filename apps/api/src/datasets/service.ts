import { randomUUID } from 'node:crypto';

import {
  DEFAULT_METRIC_CONFIGURATION,
  DEFAULT_PROCESSING_OPTIONS,
  normalizedDatasetSchema,
  validationReportSchema,
} from '@statsopedia/shared-schemas';
import {
  DATASET_ENTITY_TYPES,
  type CreateDatasetRequest,
  type Dataset,
  type DatasetDetailResponse,
  type DatasetEntityType,
  type DatasetListItem,
  type DatasetPreviewResponse,
  type DatasetVersion,
  type ImportResponse,
  type NormalizedDataset,
  type ReprocessRequest,
  type ValidationReport,
} from '@statsopedia/shared-types';
import { storageKeys, type LocalStorage, type Logger } from '@statsopedia/utils/node';
import type pg from 'pg';
import type { z } from 'zod';

import { PG_ERROR, pgErrorCode, withTransaction } from '../db/database.js';
import { HttpError, conflict, notFound } from '../errors.js';
import type { DataProcessorClient } from './processor-client.js';
import * as repo from './repository.js';
import { topicExists } from '../topics/topics.js';
import { publicVersion, type DatasetVersionRecord } from './repository.js';
import { sha256, type CsvUpload } from './uploads.js';

export interface PreviewQuery {
  versionId?: string | undefined;
  period?: string | undefined;
  top: number;
  issuesOffset: number;
  issuesLimit: number;
  rowsOffset: number;
  rowsLimit: number;
  entity?: string | undefined;
}

export interface DatasetServiceDependencies {
  pool: pg.Pool;
  storage: LocalStorage;
  processor: DataProcessorClient;
  logger: Logger;
}

/** Lowercase kebab-case slug from a title ("Café GDP (2024)" → "cafe-gdp-2024"). */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || 'dataset';
}

function entityType(category: string | null): DatasetEntityType {
  const normalized = category?.trim().toLowerCase();
  return DATASET_ENTITY_TYPES.find((type) => type === normalized) ?? 'other';
}

function yearOf(period: string): number {
  // Yearly periods are plain (possibly negative) integers; others start with YYYY.
  return /^-?\d+$/.test(period) ? Number(period) : Number(period.slice(0, 4));
}

/** Small cache for immutable JSON files (normalized outputs and reports never change). */
class ImmutableJsonCache<T> {
  readonly #entries = new Map<string, Promise<T>>();

  constructor(
    private readonly capacity: number,
    private readonly load: (path: string) => Promise<T>,
  ) {}

  get(path: string): Promise<T> {
    let entry = this.#entries.get(path);
    if (entry) {
      this.#entries.delete(path); // refresh LRU position
    } else {
      entry = this.load(path);
      entry.catch(() => this.#entries.delete(path));
    }
    this.#entries.set(path, entry);
    while (this.#entries.size > this.capacity) {
      this.#entries.delete(this.#entries.keys().next().value!);
    }
    return entry;
  }
}

export class DatasetService {
  readonly #pool: pg.Pool;
  readonly #storage: LocalStorage;
  readonly #processor: DataProcessorClient;
  readonly #logger: Logger;
  readonly #normalized: ImmutableJsonCache<NormalizedDataset>;
  readonly #reports: ImmutableJsonCache<ValidationReport>;

  constructor({ pool, storage, processor, logger }: DatasetServiceDependencies) {
    this.#pool = pool;
    this.#storage = storage;
    this.#processor = processor;
    this.#logger = logger;
    this.#normalized = new ImmutableJsonCache(4, (path) =>
      this.#readJson(path, normalizedDatasetSchema),
    );
    this.#reports = new ImmutableJsonCache(8, (path) =>
      this.#readJson(path, validationReportSchema),
    );
  }

  async createDataset(request: CreateDatasetRequest, createdBy: string | null): Promise<Dataset> {
    const processing = request.processing ?? {};
    const topicId = request.topicId ?? null;
    if (topicId !== null && !(await topicExists(this.#pool, topicId))) {
      throw new HttpError(422, 'UNKNOWN_TOPIC', 'Topic not found');
    }
    try {
      return await repo.insertDataset(this.#pool, {
        id: randomUUID(),
        slug: request.slug ?? slugify(request.title),
        title: request.title,
        description: request.description ?? null,
        topicId,
        createdBy,
        unit: request.unit ?? null,
        metric: { ...DEFAULT_METRIC_CONFIGURATION, ...request.metric },
        processing: {
          ...DEFAULT_PROCESSING_OPTIONS,
          ...processing,
          interpolation: {
            ...DEFAULT_PROCESSING_OPTIONS.interpolation,
            ...processing.interpolation,
          },
        },
      });
    } catch (error) {
      if (pgErrorCode(error) === PG_ERROR.uniqueViolation) {
        throw new HttpError(409, 'SLUG_TAKEN', 'A dataset with this slug already exists');
      }
      throw error;
    }
  }

  listDatasets(): Promise<DatasetListItem[]> {
    return repo.listDatasets(this.#pool);
  }

  async getDetail(datasetId: string): Promise<DatasetDetailResponse> {
    const dataset = await this.#requireDataset(datasetId);
    const [versions, lastUpload] = await Promise.all([
      repo.listVersions(this.#pool, datasetId),
      repo.latestUpload(this.#pool, datasetId),
    ]);
    return {
      dataset,
      latestVersion: (() => {
        const latest = versions.find((v) => v.id === dataset.latestVersionId);
        return latest ? publicVersion(latest) : null;
      })(),
      lastUpload: lastUpload ? publicVersion(lastUpload) : null,
      versionCount: versions.length,
    };
  }

  async listVersions(datasetId: string): Promise<DatasetVersion[]> {
    await this.#requireDataset(datasetId);
    return (await repo.listVersions(this.#pool, datasetId)).map(publicVersion);
  }

  /** Stores the upload as a new version and processes it. */
  async importCsv(
    datasetId: string,
    upload: CsvUpload,
    createdBy: string | null,
  ): Promise<ImportResponse> {
    const dataset = await this.#requireDataset(datasetId);
    const versionId = randomUUID();
    const sourceKey = storageKeys.datasetSource(datasetId, versionId);
    await this.#storage.writeNew(sourceKey, upload.data);

    let version: DatasetVersionRecord | null;
    try {
      version = await withTransaction(this.#pool, (client) =>
        repo.createVersion(client, {
          id: versionId,
          datasetId,
          sourceVersionId: null,
          createdBy,
          originalFilename: upload.filename,
          sourceKey,
          sizeBytes: upload.data.length,
          checksumSha256: sha256(upload.data),
          metric: dataset.metric,
          processing: dataset.processing,
        }),
      );
    } catch (error) {
      await this.#storage.remove(sourceKey);
      throw error;
    }
    if (!version) {
      await this.#storage.remove(sourceKey);
      throw notFound('Dataset');
    }
    this.#logger.info(
      { datasetId, versionId, version: version.version, bytes: upload.data.length },
      'Dataset version uploaded',
    );
    return this.#process(dataset, version);
  }

  /**
   * Processes a stored version's original file again as a new version, optionally with other
   * settings. The original file and the earlier version are left untouched.
   */
  async reprocess(
    datasetId: string,
    sourceVersionId: string,
    overrides: ReprocessRequest,
    createdBy: string | null,
  ): Promise<ImportResponse> {
    const dataset = await this.#requireDataset(datasetId);
    const source = await repo.getVersion(this.#pool, datasetId, sourceVersionId);
    if (!source) throw notFound('Dataset version');

    const original = await this.#storage.read(source.sourceKey);
    if (sha256(original) !== source.checksumSha256) {
      throw new HttpError(
        409,
        'ORIGINAL_FILE_CHANGED',
        'The stored original file no longer matches its checksum; upload it again',
      );
    }

    const version = await withTransaction(this.#pool, (client) =>
      repo.createVersion(client, {
        id: randomUUID(),
        datasetId,
        sourceVersionId: source.id,
        createdBy,
        originalFilename: source.originalFilename,
        sourceKey: source.sourceKey,
        sizeBytes: source.sizeBytes,
        checksumSha256: source.checksumSha256,
        metric: overrides.metric ?? dataset.metric,
        processing: overrides.processing ?? dataset.processing,
      }),
    );
    if (!version) throw notFound('Dataset');
    return this.#process(dataset, version);
  }

  /** Validates an upload without storing it as a version (a dry run). */
  async validateCsv(datasetId: string, upload: CsvUpload): Promise<ValidationReport> {
    const dataset = await this.#requireDataset(datasetId);
    const path = storageKeys.validationUpload(randomUUID());
    await this.#storage.writeNew(path, upload.data);
    try {
      return await this.#processor.validateCsv({
        sourceFilePath: path,
        metric: dataset.metric,
        expectedUnit: dataset.unit,
      });
    } finally {
      await this.#storage.remove(path);
    }
  }

  async preview(datasetId: string, query: PreviewQuery): Promise<DatasetPreviewResponse> {
    const dataset = await this.#requireDataset(datasetId);
    const version = query.versionId
      ? await repo.getVersion(this.#pool, datasetId, query.versionId)
      : dataset.latestVersionId
        ? await repo.getVersion(this.#pool, datasetId, dataset.latestVersionId)
        : await repo.latestUpload(this.#pool, datasetId);
    if (!version)
      throw notFound(query.versionId ? 'Dataset version' : 'Dataset version to preview');

    const report = version.reportKey ? await this.#reports.get(version.reportKey) : null;
    const issues = report?.issues ?? [];
    const observations = await repo.listObservations(
      this.#pool,
      version.id,
      query.rowsOffset,
      query.rowsLimit,
      query.entity,
    );

    let periods: string[] = [];
    let period: string | null = null;
    let ranking: DatasetPreviewResponse['ranking'] = [];
    let unit = dataset.unit;
    if (version.normalizedKey) {
      const normalized = await this.#normalized.get(version.normalizedKey);
      unit = normalized.metric.unit;
      periods = normalized.timeRange.periods;
      if (query.period !== undefined && !periods.includes(query.period)) {
        throw new HttpError(400, 'UNKNOWN_PERIOD', `Period ${query.period} is not in this version`);
      }
      period =
        query.period ??
        normalized.rankings.findLast((r) => r.entries.length > 0)?.period ??
        periods.at(-1) ??
        null;
      const entities = new Map(normalized.entities.map((e) => [e.id, e]));
      ranking = (normalized.rankings.find((r) => r.period === period)?.entries ?? [])
        .slice(0, query.top)
        .map((entry) => ({
          ...entry,
          name: entities.get(entry.entityId)?.name ?? entry.entityId,
          category: entities.get(entry.entityId)?.category ?? null,
        }));
    }

    return {
      dataset,
      version: publicVersion(version),
      unit,
      periods,
      period,
      top: query.top,
      ranking,
      issues: {
        total: issues.length,
        offset: query.issuesOffset,
        limit: query.issuesLimit,
        items: issues.slice(query.issuesOffset, query.issuesOffset + query.issuesLimit),
      },
      observations,
    };
  }

  /** The validated normalized dataset of a version (cached; files are immutable). */
  /** The animation-ready JSON of a ready version (what renders and the studio preview use). */
  async normalized(datasetId: string, versionId: string): Promise<NormalizedDataset> {
    await this.#requireDataset(datasetId);
    const version = await repo.getVersion(this.#pool, datasetId, versionId);
    if (!version) throw notFound('Dataset version');
    if (!version.normalizedKey) {
      throw conflict(
        'VERSION_NOT_READY',
        `Dataset version ${version.version} has no processed data`,
      );
    }
    return this.loadNormalized(version);
  }

  loadNormalized(version: DatasetVersionRecord): Promise<NormalizedDataset> {
    if (!version.normalizedKey) {
      throw new HttpError(
        409,
        'VERSION_NOT_READY',
        'This dataset version has no normalized output',
      );
    }
    return this.#normalized.get(version.normalizedKey);
  }

  async #process(dataset: Dataset, version: DatasetVersionRecord): Promise<ImportResponse> {
    const outputFilePath = storageKeys.datasetNormalized(dataset.id, version.id);
    const reportFilePath = storageKeys.datasetReport(dataset.id, version.id);

    let result;
    try {
      result = await this.#processor.processCsv({
        sourceFilePath: version.sourceKey,
        outputFilePath,
        reportFilePath,
        dataset: {
          id: dataset.id,
          slug: dataset.slug,
          title: dataset.title,
          description: dataset.description,
          versionId: version.id,
          version: version.version,
          originalFilename: version.originalFilename,
          checksumSha256: version.checksumSha256,
        },
        metric: version.metric,
        processing: version.processing,
        expectedUnit: dataset.unit,
      });
    } catch (error) {
      await this.#fail(version, null, `Processing failed: ${message(error)}`);
      throw error;
    }

    const { report } = result;
    if (result.outputFilePath === null) {
      const failed = await repo.finishVersion(this.#pool, version.id, {
        status: 'failed',
        validationStatus: 'invalid',
        normalizedKey: null,
        reportKey: reportFilePath,
        summary: report.summary,
        periodRange: null,
        yearRange: null,
        errorMessage: `The CSV has ${report.summary.errorCount} blocking error(s)`,
      });
      this.#logger.info(
        { datasetId: dataset.id, versionId: version.id, errors: report.summary.errorCount },
        'Dataset version is invalid',
      );
      return { version: publicVersion(failed), report };
    }

    try {
      const normalized = await this.#normalized.get(result.outputFilePath);
      if (normalized.dataset.versionId !== version.id) {
        throw new Error('Normalized output belongs to a different version');
      }
      const finished = await withTransaction(this.#pool, (client) =>
        this.#importNormalized(client, dataset, version, normalized, {
          normalizedKey: result.outputFilePath!,
          reportKey: reportFilePath,
          report,
        }),
      );
      this.#logger.info(
        {
          datasetId: dataset.id,
          versionId: version.id,
          version: version.version,
          rows: report.summary.rowCount,
          entities: report.summary.entityCount,
          warnings: report.summary.warningCount,
        },
        'Dataset version imported',
      );
      return { version: publicVersion(finished), report };
    } catch (error) {
      await this.#fail(version, report, `Import failed: ${message(error)}`);
      throw error;
    }
  }

  /** Runs inside one transaction: the version's data is imported completely or not at all. */
  async #importNormalized(
    client: pg.PoolClient,
    dataset: Dataset,
    version: DatasetVersionRecord,
    normalized: NormalizedDataset,
    files: { normalizedKey: string; reportKey: string; report: ValidationReport },
  ): Promise<DatasetVersionRecord> {
    const sourceIds = await repo.upsertSources(
      client,
      dataset.id,
      normalized.sources.map((source) => ({ id: randomUUID(), key: source.id, url: source.url })),
    );
    const entityIds = new Map(normalized.entities.map((entity) => [entity.id, randomUUID()]));
    await repo.insertEntities(
      client,
      version.id,
      normalized.entities.map((entity) => ({
        id: entityIds.get(entity.id)!,
        key: entity.id,
        name: entity.name,
        type: entityType(entity.category),
        category: entity.category,
        imageUrl: entity.imageUrl,
      })),
    );

    const positions = new Map(normalized.timeRange.periods.map((p, i) => [p, i]));
    await repo.insertDataPoints(
      client,
      version.id,
      normalized.observations.map((observation) => {
        const entityId = entityIds.get(observation.entityId);
        const dataSourceId = sourceIds.get(observation.sourceId);
        const periodPosition = positions.get(observation.period);
        if (!entityId || !dataSourceId || periodPosition === undefined) {
          throw new Error(
            `Observation on row ${observation.row} references an unknown entity, source or period`,
          );
        }
        return {
          entityId,
          period: observation.period,
          periodPosition,
          year: yearOf(observation.period),
          value: observation.value,
          dataSourceId,
          sourceRow: observation.row,
          notes: observation.notes,
        };
      }),
    );

    const { start, end } = normalized.timeRange;
    const finished = await repo.finishVersion(client, version.id, {
      status: 'ready',
      validationStatus: files.report.status,
      normalizedKey: files.normalizedKey,
      reportKey: files.reportKey,
      summary: files.report.summary,
      periodRange: { start, end },
      yearRange: { startYear: yearOf(start), endYear: yearOf(end) },
      errorMessage: null,
    });
    await repo.setLatestVersion(client, dataset.id, version.id, normalized.metric.unit);
    return finished;
  }

  async #fail(version: DatasetVersionRecord, report: ValidationReport | null, reason: string) {
    this.#logger.error({ versionId: version.id, reason }, 'Dataset version failed');
    await repo
      .finishVersion(this.#pool, version.id, {
        status: 'failed',
        validationStatus: report?.status ?? 'pending',
        normalizedKey: null,
        reportKey: report ? storageKeys.datasetReport(version.datasetId, version.id) : null,
        summary: report?.summary ?? null,
        periodRange: null,
        yearRange: null,
        errorMessage: reason.slice(0, 1_000),
      })
      .catch((error: unknown) => {
        this.#logger.error({ err: error, versionId: version.id }, 'Could not mark version failed');
      });
  }

  async #requireDataset(datasetId: string): Promise<Dataset> {
    const dataset = await repo.getDataset(this.#pool, datasetId);
    if (!dataset) throw notFound('Dataset');
    return dataset;
  }

  async #readJson<T>(relativePath: string, schema: z.ZodType<T>): Promise<T> {
    // Files written by another service are validated against the shared contract on read.
    return schema.parse(await this.#storage.readJson(relativePath));
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
