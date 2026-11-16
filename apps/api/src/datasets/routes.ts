import {
  createDatasetRequestSchema,
  datasetPreviewQuerySchema,
  reprocessRequestSchema,
} from '@statsopedia/shared-schemas';
import type {
  DatasetListResponse,
  DatasetVersionsResponse,
  ValidateResponse,
} from '@statsopedia/shared-types';
import express, { Router, type Request } from 'express';
import { z } from 'zod';

import { currentUser } from '../auth/middleware.js';
import type { DatasetService } from './service.js';
import { CSV_CONTENT_TYPES, checkCsvUpload } from './uploads.js';

const datasetParamsSchema = z.object({ id: z.uuid() });
const versionParamsSchema = z.object({ id: z.uuid(), versionId: z.uuid() });
const uploadQuerySchema = z.object({ filename: z.string().max(1_000).optional() }).strict();

/** The CSV filename comes from `?filename=` (URL-encoded, so any Unicode name works). */
function readUpload(req: Request) {
  const { filename } = uploadQuerySchema.parse(req.query);
  return checkCsvUpload(req.body, filename);
}

export function createDatasetsRouter({
  service,
  maxUploadBytes,
}: {
  service: DatasetService;
  maxUploadBytes: number;
}): Router {
  const router = Router();
  // CSV bodies are buffered up to the limit; larger uploads get 413 before reaching handlers.
  const csvBody = express.raw({ type: [...CSV_CONTENT_TYPES], limit: maxUploadBytes });

  router.post('/', async (req, res) => {
    const request = createDatasetRequestSchema.parse(req.body);
    res.status(201).json(await service.createDataset(request, currentUser(res).id));
  });

  router.get('/', async (_req, res) => {
    const body: DatasetListResponse = { datasets: await service.listDatasets() };
    res.json(body);
  });

  router.get('/:id', async (req, res) => {
    const { id } = datasetParamsSchema.parse(req.params);
    res.json(await service.getDetail(id));
  });

  router.get('/:id/versions', async (req, res) => {
    const { id } = datasetParamsSchema.parse(req.params);
    const body: DatasetVersionsResponse = { versions: await service.listVersions(id) };
    res.json(body);
  });

  router.post('/:id/import', csvBody, async (req, res) => {
    const { id } = datasetParamsSchema.parse(req.params);
    const result = await service.importCsv(id, readUpload(req), currentUser(res).id);
    res.status(201).json(result);
  });

  router.post('/:id/validate', csvBody, async (req, res) => {
    const { id } = datasetParamsSchema.parse(req.params);
    const body: ValidateResponse = { report: await service.validateCsv(id, readUpload(req)) };
    res.json(body);
  });

  router.post('/:id/versions/:versionId/reprocess', async (req, res) => {
    const { id, versionId } = versionParamsSchema.parse(req.params);
    const overrides = reprocessRequestSchema.parse(req.body ?? {});
    res.status(201).json(await service.reprocess(id, versionId, overrides, currentUser(res).id));
  });

  router.get('/:id/versions/:versionId/normalized', async (req, res) => {
    const { id, versionId } = versionParamsSchema.parse(req.params);
    res.set('Cache-Control', 'private, max-age=3600'); // versions are immutable
    res.json(await service.normalized(id, versionId));
  });

  router.get('/:id/preview', async (req, res) => {
    const { id } = datasetParamsSchema.parse(req.params);
    const query = datasetPreviewQuerySchema.parse(req.query);
    res.json(await service.preview(id, query));
  });

  return router;
}
