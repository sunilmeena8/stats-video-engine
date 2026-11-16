import { randomBytes } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  datasetDetailResponseSchema,
  datasetListResponseSchema,
  datasetPreviewResponseSchema,
  datasetVersionsResponseSchema,
  importResponseSchema,
  validateResponseSchema,
} from '@statsopedia/shared-schemas';
import { storageKeys } from '@statsopedia/utils/node';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadMigrations, migrate } from '../src/db/migrate.js';
import { createHarness, integrationEnabled, logger, type Harness } from './harness.js';

const CSV = 'entity_id,entity_name,year,value,unit,source_id\nA,Alpha,2015,1,units,s\n';
const errorBodySchema = z.object({ error: z.object({ code: z.string() }) });
const errorCode = (body: unknown) => errorBodySchema.parse(body).error.code;

describe.skipIf(!integrationEnabled)('dataset endpoints (PostgreSQL + Redis)', () => {
  let h: Harness;
  let api: ReturnType<typeof request.agent>;
  let pool: Harness['pool'];
  let storageRoot: string;
  let processor: Harness['processor'];

  beforeAll(async () => {
    h = await createHarness();
    ({ pool, storageRoot, processor } = h);
    api = request.agent(h.app).set(h.auth('editor'));
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(() => {
    processor.corrupt = false;
    processor.unavailable = false;
  });

  async function createDataset(title = `Dataset ${randomBytes(3).toString('hex')}`) {
    const response = await api
      .post('/api/datasets')
      .send({ title, metric: { rankingOrder: 'desc' }, processing: { topN: 4 } })
      .expect(201);
    return response.body as { id: string; slug: string };
  }

  function upload(id: string, csv: string | Buffer = CSV, filename = 'data.csv') {
    return api
      .post(`/api/datasets/${id}/import`)
      .query({ filename })
      .set('content-type', 'text/csv')
      .send(Buffer.isBuffer(csv) ? csv : Buffer.from(csv));
  }

  async function count(table: string, versionId: string) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE dataset_version_id = $1`,
      [versionId],
    );
    return rows[0]!.n;
  }

  it('migrations are idempotent and refuse edited files', async () => {
    expect(await migrate(pool, logger)).toEqual([]);
    const [first] = await loadMigrations();
    await expect(migrate(pool, logger, [{ ...first!, checksum: 'f'.repeat(64) }])).rejects.toThrow(
      /modified after it was applied/,
    );
  });

  it('creates datasets with defaults and validates input', async () => {
    const response = await api
      .post('/api/datasets')
      .send({ title: 'Café Exports (USD)', processing: { interpolation: { stepsPerPeriod: 3 } } })
      .expect(201);
    expect(response.body).toMatchObject({
      slug: 'cafe-exports-usd',
      unit: null,
      metric: { frequency: 'yearly', rankingOrder: 'desc', allowNegative: false },
      processing: {
        topN: null,
        missingValues: 'exclude',
        interpolation: { method: 'linear', stepsPerPeriod: 3, maxGapPeriods: 1 },
      },
      latestVersionId: null,
    });

    await api.post('/api/datasets').send({ title: 'Café Exports (USD)' }).expect(409);
    await api.post('/api/datasets').send({ title: '' }).expect(400);
    await api.post('/api/datasets').send({ title: 'x', isAdmin: true }).expect(400);
    await api
      .post('/api/datasets')
      .send({ title: 'x', processing: { topN: 1000 } })
      .expect(400);
  });

  it('imports a valid CSV atomically and exposes it through every endpoint', async () => {
    const dataset = await createDataset();
    const response = await upload(dataset.id, CSV, '../../etc/report.csv').expect(201);
    const { version, report: result } = importResponseSchema.parse(response.body);

    expect(version).toMatchObject({
      version: 1,
      status: 'ready',
      validationStatus: 'valid_with_warnings',
      originalFilename: 'report.csv',
      hasNormalizedOutput: true,
      periodRange: { start: '2015', end: '2020' },
      yearRange: { startYear: 2015, endYear: 2020 },
      rowCount: 25,
    });
    expect(result.status).toBe('valid_with_warnings');
    // The original upload is stored byte for byte under the server-generated name, and no
    // storage path ever appears in a response.
    const sourceKey = storageKeys.datasetSource(dataset.id, version.id);
    expect(await readFile(path.join(storageRoot, sourceKey), 'utf8')).toBe(CSV);
    expect(JSON.stringify(response.body)).not.toMatch(/datasets\/|processed\/|FilePath/);
    expect(await count('data_entities', version.id)).toBe(5);
    expect(await count('data_points', version.id)).toBe(25);

    const detail = datasetDetailResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}`).expect(200)).body,
    );
    expect(detail.dataset.latestVersionId).toBe(version.id);
    expect(detail.dataset.unit).toBe('units');
    expect(detail.dataset.dataSourceIds).toHaveLength(1);

    const list = datasetListResponseSchema.parse((await api.get('/api/datasets').expect(200)).body);
    expect(list.datasets.find((d) => d.id === dataset.id)?.latestVersion?.id).toBe(version.id);

    const preview = datasetPreviewResponseSchema.parse(
      (
        await api
          .get(`/api/datasets/${dataset.id}/preview`)
          .query({ period: '2015', top: 3, rowsLimit: 5 })
          .expect(200)
      ).body,
    );
    expect(preview.periods).toEqual(['2015', '2016', '2017', '2018', '2019', '2020']);
    expect(preview.ranking.map((r) => [r.entityId, r.name, r.rank, r.position])).toEqual([
      ['AUR', 'Aurora', 1, 1],
      ['BRK', 'Brookfield, Upper', 2, 2],
      ['CDR', 'Cedar Côte', 2, 3],
    ]);
    expect(preview.observations.total).toBe(25);
    expect(preview.observations.items.map((o) => o.row)).toEqual([2, 3, 4, 5, 6]);
    expect(preview.observations.items[1]).toMatchObject({
      entityName: 'Brookfield, Upper',
      sourceId: 'statsopedia-synthetic',
    });

    // Defaults to the latest period that has a ranking.
    const latest = (await api.get(`/api/datasets/${dataset.id}/preview`).expect(200)).body as {
      period: string;
    };
    expect(latest.period).toBe('2020');
    await api.get(`/api/datasets/${dataset.id}/preview`).query({ period: '1999' }).expect(400);
  });

  it('records invalid uploads as failed versions with row-numbered issues', async () => {
    const dataset = await createDataset();
    const response = await upload(dataset.id, `${CSV}B,Beta,2016,abc,units,s\n`).expect(201);
    const { version, report: result } = importResponseSchema.parse(response.body);

    expect(version).toMatchObject({
      status: 'failed',
      validationStatus: 'invalid',
      errorCount: 1,
      hasNormalizedOutput: false,
      errorMessage: 'The CSV has 1 blocking error(s)',
    });
    expect(result.issues[0]).toMatchObject({ row: 7, code: 'INVALID_VALUE' });
    expect(await count('data_points', version.id)).toBe(0);

    const preview = datasetPreviewResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}/preview`).expect(200)).body,
    );
    expect(preview.version.id).toBe(version.id);
    expect(preview.issues.items[0]?.row).toBe(7);
    expect(preview.ranking).toEqual([]);
  });

  it('numbers concurrent uploads without gaps or duplicates', async () => {
    const dataset = await createDataset();
    const responses = await Promise.all(Array.from({ length: 6 }, () => upload(dataset.id)));
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));

    const versions = datasetVersionsResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}/versions`).expect(200)).body,
    ).versions;
    expect(versions.map((v) => v.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(versions.every((v) => v.status === 'ready')).toBe(true);
  });

  it('rolls back the whole import when any row fails to insert', async () => {
    const dataset = await createDataset();
    processor.corrupt = true;
    const response = await upload(dataset.id).expect(500);
    expect(errorCode(response.body)).toBe('INTERNAL_ERROR');

    const [version] = datasetVersionsResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}/versions`)).body,
    ).versions;
    expect(version).toMatchObject({ status: 'failed', validationStatus: 'valid_with_warnings' });
    expect(version!.errorMessage).toMatch(/unknown entity/);
    // Entities were inserted before the failing data point: the rollback removed them too.
    expect(await count('data_entities', version!.id)).toBe(0);
    const detail = datasetDetailResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}`)).body,
    );
    expect(detail.dataset.latestVersionId).toBeNull();
  });

  it('marks the version failed when the processor is unavailable', async () => {
    const dataset = await createDataset();
    processor.unavailable = true;
    const response = await upload(dataset.id).expect(502);
    expect(errorCode(response.body)).toBe('PROCESSOR_UNAVAILABLE');
    const [version] = datasetVersionsResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}/versions`)).body,
    ).versions;
    expect(version).toMatchObject({ status: 'failed' });
    expect(version!.errorMessage).toMatch(/ECONNREFUSED/);
  });

  it('reprocesses from the untouched original as a new version', async () => {
    const dataset = await createDataset();
    const first = importResponseSchema.parse((await upload(dataset.id).expect(201)).body).version;
    const response = await api
      .post(`/api/datasets/${dataset.id}/versions/${first.id}/reprocess`)
      .send({
        processing: {
          topN: 2,
          missingValues: 'zero',
          interpolation: {
            method: 'none',
            stepsPerPeriod: 1,
            maxGapPeriods: 0,
            allowLargeGaps: false,
          },
        },
      })
      .expect(201);
    const second = importResponseSchema.parse(response.body).version;

    expect(second).toMatchObject({
      version: 2,
      sourceVersionId: first.id,
      checksumSha256: first.checksumSha256,
      processing: { topN: 2, missingValues: 'zero' },
    });
    expect(processor.calls.at(-1)?.processing.topN).toBe(2);
    // Reprocessing reads the same original file.
    expect(processor.calls.at(-1)?.sourceFilePath).toBe(
      storageKeys.datasetSource(dataset.id, first.id),
    );
    expect(await count('data_points', first.id)).toBe(25);

    // A tampered original is detected instead of silently reprocessed.
    await writeFile(
      path.join(storageRoot, storageKeys.datasetSource(dataset.id, first.id)),
      'tampered',
    );
    await api
      .post(`/api/datasets/${dataset.id}/versions/${first.id}/reprocess`)
      .send({})
      .expect(409);
  });

  it('validates without creating a version or leaving files', async () => {
    const dataset = await createDataset();
    const response = await api
      .post(`/api/datasets/${dataset.id}/validate`)
      .query({ filename: 'check.csv' })
      .set('content-type', 'text/csv')
      .send(Buffer.from(CSV))
      .expect(200);
    expect(validateResponseSchema.parse(response.body).report.status).toBe('valid');
    const versions = datasetVersionsResponseSchema.parse(
      (await api.get(`/api/datasets/${dataset.id}/versions`)).body,
    );
    expect(versions.versions).toEqual([]);
    expect(
      (await readdir(path.join(storageRoot, 'temp'))).filter((f) => f.endsWith('.csv')),
    ).toEqual([]);
  });

  it('enforces upload limits and input validation', async () => {
    const dataset = await createDataset();
    const tooBig = await upload(dataset.id, Buffer.alloc(65 * 1024, 'a')).expect(413);
    expect(errorCode(tooBig.body)).toBe('FILE_TOO_LARGE');
    await upload(dataset.id, CSV, 'data.xlsx').expect(415);
    await upload(dataset.id, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])).expect(415);
    await api
      .post(`/api/datasets/${dataset.id}/import`)
      .set('content-type', 'application/json')
      .send({ csv: 'x' })
      .expect(415);
    await api.get('/api/datasets/not-a-uuid').expect(400);
    await api.get('/api/datasets/0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d').expect(404);
    await upload('0b7d6c2e-58f4-4c4b-9a8e-5d1f2a3b4c5d').expect(404);
    await api.get(`/api/datasets/${dataset.id}/preview`).query({ top: 500 }).expect(400);
    await api.get(`/api/datasets/${dataset.id}/preview`).query({ unknown: 1 }).expect(400);
    // Nothing from the rejected uploads reached storage.
    const stored = await readdir(path.join(storageRoot, 'datasets')).catch(() => []);
    expect(stored).not.toContain(dataset.id);
  });
});
