/**
 * Endpoints added for the dashboard: overview stats, the generated-videos list, project
 * duplicate/delete, job retry, the queue-wide event stream, normalized data and the entity
 * filter. Real PostgreSQL, Redis and worker runtime (Remotion and FFmpeg faked).
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  dashboardStatsSchema,
  datasetPreviewResponseSchema,
  normalizedDatasetSchema,
  outputListResponseSchema,
  renderSubmissionResponseSchema,
  videoProjectSchema,
} from '@statsopedia/shared-schemas';
import type { RenderJob } from '@statsopedia/shared-types';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  FakeRenderer,
  TEMPLATE_ID,
  createHarness,
  integrationEnabled,
  startWorker,
  type Harness,
} from './harness.js';

const CSV = 'entity_id,entity_name,year,value,unit,source_id\nA,Alpha,2015,1,units,s\n';
const errorCode = (body: unknown) =>
  z.object({ error: z.object({ code: z.string() }) }).parse(body).error.code;

describe.skipIf(!integrationEnabled)('dashboard endpoints', () => {
  let h: Harness;
  let editor: ReturnType<typeof request.agent>;
  let datasetId: string;
  let datasetVersionId: string;
  let workers: Awaited<ReturnType<typeof startWorker>>[] = [];

  async function createProject(overrides: Record<string, unknown> = {}) {
    const response = await editor
      .post('/api/projects')
      .send({
        name: `Project ${randomUUID().slice(0, 6)}`,
        configuration: {
          datasetVersionId,
          templateId: TEMPLATE_ID,
          outputMode: 'long',
          ...overrides,
        },
      })
      .expect(201);
    return videoProjectSchema.parse(response.body);
  }

  async function waitForStatus(id: string, status: RenderJob['status']) {
    await vi.waitFor(
      async () => {
        const job = (await editor.get(`/api/jobs/${id}`)).body as { job: RenderJob };
        if (job.job.status !== status) throw new Error(job.job.status);
      },
      { timeout: 15_000, interval: 100 },
    );
  }

  beforeAll(async () => {
    h = await createHarness();
    editor = request.agent(h.app).set(h.auth('editor'));
    const dataset = await editor.post('/api/datasets').send({ title: 'Dash fixture' }).expect(201);
    datasetId = (dataset.body as { id: string }).id;
    const imported = await editor
      .post(`/api/datasets/${datasetId}/import`)
      .query({ filename: 'data.csv' })
      .set('content-type', 'text/csv')
      .send(Buffer.from(CSV))
      .expect(201);
    datasetVersionId = (imported.body as { version: { id: string } }).version.id;
  });

  afterEach(async () => {
    await Promise.all(workers.map((worker) => worker.close({ force: true })));
    workers = [];
  });

  afterAll(async () => {
    await h?.close();
  });

  it('serves the normalized data of a version and filters records by entity', async () => {
    const normalized = await editor
      .get(`/api/datasets/${datasetId}/versions/${datasetVersionId}/normalized`)
      .expect(200);
    expect(normalizedDatasetSchema.parse(normalized.body).timeRange.periods.length).toBeGreaterThan(
      1,
    );
    expect(normalized.headers['cache-control']).toContain('max-age');

    const all = datasetPreviewResponseSchema.parse(
      (await editor.get(`/api/datasets/${datasetId}/preview`)).body,
    );
    const name = all.observations.items[0]!.entityName;
    const filtered = datasetPreviewResponseSchema.parse(
      (await editor.get(`/api/datasets/${datasetId}/preview`).query({ entity: name.slice(1, 4) }))
        .body,
    );
    expect(filtered.observations.total).toBeLessThan(all.observations.total);
    expect(filtered.observations.items.every((o) => o.entityName === name)).toBe(true);
    // Wildcards are literal.
    const literal = datasetPreviewResponseSchema.parse(
      (await editor.get(`/api/datasets/${datasetId}/preview`).query({ entity: '%' })).body,
    );
    expect(literal.observations.total).toBe(0);
  });

  it('reports overview totals and storage usage', async () => {
    const stats = dashboardStatsSchema.parse((await editor.get('/api/stats').expect(200)).body);
    expect(stats.datasets).toBeGreaterThanOrEqual(1);
    expect(stats.storage.areas.map((area) => area.area)).toContain('renders');
    expect(stats.storage.usedBytes).toBeGreaterThan(0); // the uploaded CSV
  });

  it('duplicates a project and deletes drafts only', async () => {
    const project = await createProject();
    const copy = videoProjectSchema.parse(
      (await editor.post(`/api/projects/${project.id}/duplicate`).expect(201)).body,
    );
    expect(copy).toMatchObject({ name: `${project.name} (copy)`, status: 'draft', revision: 1 });
    expect(copy.configuration).toEqual(project.configuration);
    expect(copy.id).not.toBe(project.id);

    await editor.delete(`/api/projects/${copy.id}`).expect(204);
    await editor.get(`/api/projects/${copy.id}`).expect(404);
    await request(h.app).delete(`/api/projects/${project.id}`).set(h.auth('viewer')).expect(403);

    // A draft with a finished preview is deleted with its files.
    workers.push(await startWorker(h));
    const preview = renderSubmissionResponseSchema.parse(
      (await editor.post(`/api/projects/${project.id}/preview`).send({}).expect(202)).body,
    ).request;
    await waitForStatus(preview.jobs[0]!.id, 'completed');
    const { rows } = await h.pool.query<{ storage_key: string }>(
      'SELECT storage_key FROM video_outputs WHERE project_id = $1',
      [project.id],
    );
    expect(await h.storage.size(rows[0]!.storage_key)).not.toBeNull();
    await editor.delete(`/api/projects/${project.id}`).expect(204);
    expect(await h.storage.size(rows[0]!.storage_key)).toBeNull();

    // A project with a final render is not a draft any more.
    const rendered = await createProject();
    const final = renderSubmissionResponseSchema.parse(
      (await editor.post(`/api/projects/${rendered.id}/render`).send({}).expect(202)).body,
    ).request;
    await waitForStatus(final.jobs[0]!.id, 'completed');
    const refused = await editor.delete(`/api/projects/${rendered.id}`).expect(409);
    expect(errorCode(refused.body)).toBe('PROJECT_NOT_DRAFT');
  });

  it('lists generated videos with their dataset version', async () => {
    const outputs = outputListResponseSchema.parse((await editor.get('/api/outputs')).body).outputs;
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    expect(outputs[0]).toMatchObject({
      datasetId,
      datasetVersionId,
      datasetTitle: 'Dash fixture',
      datasetVersion: 1,
      title: 'Dash fixture',
    });
    const finals = outputListResponseSchema.parse(
      (await editor.get('/api/outputs').query({ kind: 'final' })).body,
    ).outputs;
    expect(finals.every((output) => output.kind === 'final')).toBe(true);
    expect(JSON.stringify(outputs)).not.toMatch(/storageKey|renders\//);
  });

  it('retries failed jobs as a new request, and only failed or cancelled ones', async () => {
    const renderer = new FakeRenderer();
    renderer.behaviour = 'wrong-frame-count';
    workers.push(await startWorker(h, { renderer }));
    const project = await createProject();
    const first = renderSubmissionResponseSchema.parse(
      (await editor.post(`/api/projects/${project.id}/render`).send({}).expect(202)).body,
    ).request;
    await waitForStatus(first.jobs[0]!.id, 'failed');
    renderer.behaviour = 'succeed';
    const retried = renderSubmissionResponseSchema.parse(
      (await editor.post(`/api/jobs/${first.jobs[0]!.id}/retry`).expect(202)).body,
    ).request;
    expect(retried).toMatchObject({ type: 'long_form', renderVersion: first.renderVersion + 1 });
    await waitForStatus(retried.jobs[0]!.id, 'completed');
    const again = await editor.post(`/api/jobs/${retried.jobs[0]!.id}/retry`).expect(409);
    expect(errorCode(again.body)).toBe('JOB_NOT_RETRYABLE');
  });

  it('streams every job change on the queue stream', async () => {
    const server = h.app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const controller = new AbortController();
    try {
      const response = await fetch(`${base}/api/jobs/events`, {
        headers: { Authorization: `Bearer ${h.tokens.viewer}` },
        signal: controller.signal,
      });
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const project = await createProject();
      const submitted = renderSubmissionResponseSchema.parse(
        (await editor.post(`/api/projects/${project.id}/preview`).send({}).expect(202)).body,
      ).request;
      workers.push(await startWorker(h));
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = '';
      const seen: string[] = [];
      while (!seen.includes('completed')) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        for (const block of text.split('\n\n').slice(0, -1)) {
          const data = block.split('\n').find((line) => line.startsWith('data: '));
          if (block.includes('event: job') && data) {
            const job = JSON.parse(data.slice(6)) as RenderJob;
            if (job.id === submitted.jobs[0]!.id && seen.at(-1) !== job.status)
              seen.push(job.status);
          }
        }
        text = text.slice(text.lastIndexOf('\n\n') + 2);
      }
      // Bursts are coalesced (one event per job per 250 ms), so fast jobs may skip states.
      expect(seen.at(-1)).toBe('completed');
    } finally {
      controller.abort();
      server.close();
    }
  });
});
