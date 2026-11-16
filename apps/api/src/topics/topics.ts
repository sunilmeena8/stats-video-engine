import { randomUUID } from 'node:crypto';

import { createTopicRequestSchema } from '@statsopedia/shared-schemas';
import type { Topic } from '@statsopedia/shared-types';
import { Router } from 'express';
import type pg from 'pg';

import { PG_ERROR, pgErrorCode, type Queryable } from '../db/database.js';
import { conflict } from '../errors.js';
import { slugify } from '../datasets/service.js';

interface TopicRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

const toTopic = (row: TopicRow): Topic => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export async function listTopics(db: Queryable): Promise<Topic[]> {
  const { rows } = await db.query<TopicRow>('SELECT * FROM topics ORDER BY name');
  return rows.map(toTopic);
}

export async function topicExists(db: Queryable, id: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM topics WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

export async function insertTopic(
  db: Queryable,
  input: { name: string; slug: string; description: string | null },
): Promise<Topic> {
  try {
    const { rows } = await db.query<TopicRow>(
      'INSERT INTO topics (id, slug, name, description) VALUES ($1, $2, $3, $4) RETURNING *',
      [randomUUID(), input.slug, input.name, input.description],
    );
    return toTopic(rows[0]!);
  } catch (error) {
    if (pgErrorCode(error) === PG_ERROR.uniqueViolation) {
      throw conflict('SLUG_TAKEN', 'A topic with this slug already exists');
    }
    throw error;
  }
}

export function createTopicsRouter(pool: pg.Pool): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    res.json({ topics: await listTopics(pool) });
  });
  router.post('/', async (req, res) => {
    const body = createTopicRequestSchema.parse(req.body);
    const topic = await insertTopic(pool, {
      name: body.name,
      slug: body.slug ?? slugify(body.name),
      description: body.description ?? null,
    });
    res.status(201).json(topic);
  });
  return router;
}
