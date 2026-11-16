import type { OutputFormat, VideoTemplate } from '@statsopedia/shared-types';
import { Router } from 'express';
import type pg from 'pg';

import type { Queryable } from '../db/database.js';

interface TemplateRow {
  id: string;
  slug: string;
  version: number;
  name: string;
  description: string | null;
  composition_id: string;
  supported_formats: OutputFormat[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const toTemplate = (row: TemplateRow): VideoTemplate => ({
  id: row.id,
  slug: row.slug,
  version: row.version,
  name: row.name,
  description: row.description,
  compositionId: row.composition_id,
  supportedFormats: row.supported_formats,
  isActive: row.is_active,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Active templates: the latest version of each slug first. */
export async function listTemplates(db: Queryable): Promise<VideoTemplate[]> {
  const { rows } = await db.query<TemplateRow>(
    'SELECT * FROM templates WHERE is_active ORDER BY slug, version DESC',
  );
  return rows.map(toTemplate);
}

/** Locks the template row (FOR SHARE) when called inside a transaction. */
export async function getTemplate(
  db: Queryable,
  id: string,
  lock = false,
): Promise<VideoTemplate | null> {
  const { rows } = await db.query<TemplateRow>(
    `SELECT * FROM templates WHERE id = $1${lock ? ' FOR SHARE' : ''}`,
    [id],
  );
  return rows[0] ? toTemplate(rows[0]) : null;
}

export async function upsertTemplate(
  db: Queryable,
  template: Omit<VideoTemplate, 'createdAt' | 'updatedAt' | 'isActive'>,
): Promise<void> {
  // Template versions are immutable: an existing (slug, version) row is left untouched.
  await db.query(
    `INSERT INTO templates (id, slug, version, name, description, composition_id, supported_formats)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (slug, version) DO NOTHING`,
    [
      template.id,
      template.slug,
      template.version,
      template.name,
      template.description,
      template.compositionId,
      template.supportedFormats,
    ],
  );
}

export function createTemplatesRouter(pool: pg.Pool): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    res.json({ templates: await listTemplates(pool) });
  });
  return router;
}
