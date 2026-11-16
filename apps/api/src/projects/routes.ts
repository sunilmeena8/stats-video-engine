import {
  createProjectRequestSchema,
  idempotencyKeySchema,
  submitRenderRequestSchema,
  updateProjectRequestSchema,
} from '@statsopedia/shared-schemas';
import { VIDEO_PROJECT_STATUSES, type RenderKind } from '@statsopedia/shared-types';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { currentUser } from '../auth/middleware.js';
import type { RenderOrchestrator } from '../render/orchestrator.js';
import type { ProjectService } from './projects.js';

const idParams = z.object({ id: z.uuid() });
const listQuery = z
  .object({ topicId: z.uuid().optional(), status: z.enum(VIDEO_PROJECT_STATUSES).optional() })
  .strict();

export function createProjectsRouter({
  projects,
  orchestrator,
}: {
  projects: ProjectService;
  orchestrator: RenderOrchestrator;
}): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ projects: await projects.list(listQuery.parse(req.query)) });
  });

  router.post('/', async (req, res) => {
    const body = createProjectRequestSchema.parse(req.body);
    res.status(201).json(await projects.create(body, currentUser(res).id));
  });

  router.get('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json(await projects.detail(id));
  });

  router.post('/:id/duplicate', async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.status(201).json(await projects.duplicate(id, currentUser(res).id));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    await projects.remove(id);
    res.status(204).end();
  });

  router.put('/:id', async (req, res) => {
    const { id } = idParams.parse(req.params);
    res.json(await projects.update(id, updateProjectRequestSchema.parse(req.body)));
  });

  const submit = (kind: RenderKind) => async (req: Request, res: Response) => {
    const { id } = idParams.parse(req.params);
    const { formats } = submitRenderRequestSchema.parse(req.body ?? {});
    const header = req.get('idempotency-key');
    const idempotencyKey = header === undefined ? null : idempotencyKeySchema.parse(header);
    const result = await orchestrator.submit({
      projectId: id,
      kind,
      formats,
      idempotencyKey,
      userId: currentUser(res).id,
    });
    res.status(result.replayed ? 200 : 202).json(result);
  };

  router.post('/:id/preview', submit('preview'));
  router.post('/:id/render', submit('final'));

  return router;
}
