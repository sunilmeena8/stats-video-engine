import { randomUUID } from 'node:crypto';

import type {
  CreateProjectRequest,
  MediaAsset,
  NormalizedDataset,
  ProjectDetailResponse,
  UpdateProjectRequest,
  VideoConfiguration,
  VideoProject,
  VideoProjectStatus,
  VideoTemplate,
} from '@statsopedia/shared-types';
import * as render from '@statsopedia/render-store';
import { storageKeys, type LocalStorage } from '@statsopedia/utils/node';
import {
  createVideoConfiguration,
  formatsForMode,
  referencedImageAssets,
  resolveMusicAsset,
  type ResolvedMusic,
} from '@statsopedia/video-config';
import type pg from 'pg';

import { withTransaction, type Queryable } from '../db/database.js';
import * as datasets from '../datasets/repository.js';
import type { DatasetVersionRecord } from '../datasets/repository.js';
import type { DatasetService } from '../datasets/service.js';
import { conflict, notFound, unprocessable } from '../errors.js';
import { getMediaRecord } from '../media/media.js';
import { getTemplate } from '../templates/templates.js';
import { topicExists } from '../topics/topics.js';

interface ProjectRow {
  id: string;
  name: string;
  topic_id: string | null;
  status: VideoProjectStatus;
  dataset_id: string;
  dataset_version_id: string;
  template_id: string;
  template_version: number;
  configuration: VideoConfiguration;
  revision: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const toProject = (row: ProjectRow): VideoProject => ({
  id: row.id,
  name: row.name,
  topicId: row.topic_id,
  status: row.status,
  datasetId: row.dataset_id,
  datasetVersionId: row.dataset_version_id,
  templateId: row.template_id,
  templateVersion: row.template_version,
  configuration: row.configuration,
  revision: row.revision,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export async function getProject(
  db: Queryable,
  id: string,
  lock = false,
): Promise<VideoProject | null> {
  const { rows } = await db.query<ProjectRow>(
    `SELECT * FROM video_projects WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ? toProject(rows[0]) : null;
}

/** Everything a project's configuration refers to, checked and loaded. */
export interface ProjectContext {
  version: DatasetVersionRecord;
  template: VideoTemplate;
  normalized: NormalizedDataset;
  /** The music for the composition (`storage:assets/music/<file>`), or null. */
  music: ResolvedMusic | null;
  /** The music asset with its licensing, or null. */
  musicAsset: MediaAsset | null;
  musicAssetId: string | null;
  /** `storage:assets/…` of each uploaded image the annotations use, by asset id. */
  images: Record<string, string>;
}

export class ProjectService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly datasetService: DatasetService,
    private readonly storage?: LocalStorage,
  ) {}

  /** Copies a project's name, topic and configuration into a new draft. */
  async duplicate(id: string, createdBy: string | null): Promise<VideoProject> {
    const source = await getProject(this.pool, id);
    if (!source) throw notFound('Project');
    return this.create(
      {
        name: `${source.name.slice(0, 112)} (copy)`,
        topicId: source.topicId,
        configuration: source.configuration,
      },
      createdBy,
    );
  }

  /**
   * Deletes a draft: a project without final renders or unfinished jobs. Its preview videos,
   * thumbnails and render logs are deleted with it.
   */
  async remove(id: string): Promise<void> {
    const files = await withTransaction(this.pool, async (client) => {
      const project = await getProject(client, id, true);
      if (!project) throw notFound('Project');
      const { rows: jobs } = await client.query<{
        id: string;
        kind: 'preview' | 'final';
        output_format: 'long' | 'short';
        render_version: number;
        status: string;
      }>(
        'SELECT id, kind, output_format, render_version, status FROM render_jobs WHERE project_id = $1',
        [id],
      );
      if (project.status !== 'draft' || jobs.some((job) => job.kind === 'final')) {
        throw conflict('PROJECT_NOT_DRAFT', 'Only drafts without final renders can be deleted');
      }
      if (jobs.some((job) => !['completed', 'failed', 'cancelled'].includes(job.status))) {
        throw conflict('RENDERS_IN_PROGRESS', 'Cancel or wait for the running previews first');
      }
      const { rows: outputs } = await client.query<{
        storage_key: string;
        thumbnail_key: string | null;
      }>('SELECT storage_key, thumbnail_key FROM video_outputs WHERE project_id = $1', [id]);
      // Children first: render jobs restrict deleting the manifests they point to.
      await client.query('DELETE FROM video_outputs WHERE project_id = $1', [id]);
      await client.query('DELETE FROM render_jobs WHERE project_id = $1', [id]);
      await client.query('DELETE FROM render_requests WHERE project_id = $1', [id]);
      await client.query('DELETE FROM render_manifests WHERE project_id = $1', [id]);
      await client.query('DELETE FROM video_projects WHERE id = $1', [id]);
      return [
        ...outputs.flatMap((output) => [output.storage_key, output.thumbnail_key]),
        ...jobs.map((job) =>
          storageKeys.renderLog({
            projectId: id,
            kind: job.kind,
            format: job.output_format,
            renderVersion: job.render_version,
          }),
        ),
      ].filter((key): key is string => key !== null);
    });
    for (const key of files) await this.storage?.remove(key).catch(() => undefined);
  }

  async list(filter: { topicId?: string | undefined; status?: VideoProjectStatus | undefined }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.topicId) {
      params.push(filter.topicId);
      where.push(`topic_id = $${params.length}`);
    }
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const { rows } = await this.pool.query<ProjectRow>(
      `SELECT * FROM video_projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY updated_at DESC LIMIT 200`,
      params,
    );
    return rows.map(toProject);
  }

  async detail(id: string): Promise<ProjectDetailResponse> {
    const project = await getProject(this.pool, id);
    if (!project) throw notFound('Project');
    const [requests, jobs, outputs] = await Promise.all([
      render.requestsForProject(this.pool, id, 20),
      render.listJobs(this.pool, { projectId: id, limit: 50 }),
      render.outputsForProject(this.pool, id),
    ]);
    const renders = await Promise.all(
      requests.map(async (request) =>
        render.publicRequest(request, await render.jobsForRequest(this.pool, request.id)),
      ),
    );
    return {
      project,
      renders,
      jobs: jobs.map(render.publicJob),
      outputs: outputs.map(render.publicOutput),
    };
  }

  /**
   * Creates a project in one transaction. The dataset version, template and music asset rows
   * are locked FOR SHARE while it is inserted, so none can change or disappear underneath it.
   */
  async create(request: CreateProjectRequest, createdBy: string | null): Promise<VideoProject> {
    const version = await datasets.getVersionById(
      this.pool,
      request.configuration.datasetVersionId,
    );
    if (!version) throw unprocessable('UNKNOWN_DATASET_VERSION', 'Dataset version not found');
    const dataset = await datasets.getDataset(this.pool, version.datasetId);
    if (!dataset) throw unprocessable('UNKNOWN_DATASET_VERSION', 'Dataset version not found');

    const configuration = createVideoConfiguration({
      title: dataset.title.slice(0, 100),
      metricLabel: null,
      unitLabel: dataset.unit,
      ...request.configuration,
    });
    const id = randomUUID();
    return withTransaction(this.pool, async (client) => {
      const context = await this.resolve(client, configuration, true);
      await this.checkTopic(client, request.topicId ?? null);
      const { rows } = await client.query<ProjectRow>(
        `INSERT INTO video_projects (id, name, topic_id, status, dataset_id, dataset_version_id,
           template_id, template_version, music_asset_id, configuration, created_by)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          id,
          request.name,
          request.topicId ?? null,
          context.version.datasetId,
          context.version.id,
          context.template.id,
          context.template.version,
          context.musicAssetId,
          JSON.stringify(configuration),
          createdBy,
        ],
      );
      return toProject(rows[0]!);
    });
  }

  /** Full replacement with optimistic locking: `revision` must match the stored one. */
  async update(id: string, request: UpdateProjectRequest): Promise<VideoProject> {
    return withTransaction(this.pool, async (client) => {
      const current = await getProject(client, id, true);
      if (!current) throw notFound('Project');
      if (current.revision !== request.revision) {
        throw conflict('REVISION_CONFLICT', 'The project changed since you loaded it', {
          currentRevision: current.revision,
        });
      }
      const context = await this.resolve(client, request.configuration, true);
      await this.checkTopic(client, request.topicId);
      const { rows } = await client.query<ProjectRow>(
        `UPDATE video_projects SET name = $2, topic_id = $3, dataset_id = $4, dataset_version_id = $5,
           template_id = $6, template_version = $7, music_asset_id = $8, configuration = $9,
           revision = revision + 1, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          id,
          request.name,
          request.topicId,
          context.version.datasetId,
          context.version.id,
          context.template.id,
          context.template.version,
          context.musicAssetId,
          JSON.stringify(request.configuration),
        ],
      );
      return toProject(rows[0]!);
    });
  }

  /**
   * Checks that a configuration can be rendered: the dataset version is processed and valid,
   * the template is active and supports the output mode, periods exist, and music is a music
   * asset. Pass `lock` inside a transaction to hold the rows FOR SHARE.
   */
  async resolve(
    db: Queryable,
    configuration: VideoConfiguration,
    lock = false,
  ): Promise<ProjectContext> {
    const version = await datasets.getVersionById(db, configuration.datasetVersionId, lock);
    if (!version) throw unprocessable('UNKNOWN_DATASET_VERSION', 'Dataset version not found');
    if (version.status !== 'ready' || !version.hasNormalizedOutput) {
      throw conflict(
        'VERSION_NOT_READY',
        `Dataset version ${version.version} is ${version.status}, not ready`,
      );
    }
    const template = await getTemplate(db, configuration.templateId, lock);
    if (!template?.isActive)
      throw unprocessable('UNKNOWN_TEMPLATE', 'Template not found or inactive');
    const unsupported = formatsForMode(configuration.outputMode).filter(
      (format) => !template.supportedFormats.includes(format),
    );
    if (unsupported.length) {
      throw unprocessable(
        'FORMAT_NOT_SUPPORTED',
        `Template does not support: ${unsupported.join(', ')}`,
      );
    }

    const normalized = await this.datasetService.loadNormalized(version);
    const periods = normalized.timeRange.periods;
    for (const [field, period] of [
      ['startPeriod', configuration.startPeriod],
      ['endPeriod', configuration.endPeriod],
    ] as const) {
      if (period !== null && !periods.includes(period)) {
        throw unprocessable(
          'UNKNOWN_PERIOD',
          `${field} ${period} is not in dataset version ${version.version}`,
        );
      }
    }
    const start =
      configuration.startPeriod === null ? 0 : periods.indexOf(configuration.startPeriod);
    const end =
      configuration.endPeriod === null
        ? periods.length - 1
        : periods.indexOf(configuration.endPeriod);
    if (end <= start)
      throw unprocessable('INVALID_PERIOD_RANGE', 'endPeriod must come after startPeriod');
    for (const annotation of configuration.annotations) {
      if (annotation.timing.kind === 'period' && !periods.includes(annotation.timing.period)) {
        throw unprocessable(
          'UNKNOWN_PERIOD',
          `Annotation "${annotation.id}" uses unknown period ${annotation.timing.period}`,
        );
      }
    }

    let music: ResolvedMusic | null = null;
    let musicAsset: MediaAsset | null = null;
    if (configuration.music) {
      const asset = await getMediaRecord(db, configuration.music.assetId, lock);
      if (!asset || asset.type !== 'music')
        throw unprocessable('UNKNOWN_MUSIC', 'Music asset not found');
      const { storageKey, ...publicAsset } = asset;
      musicAsset = publicAsset;
      music = resolveMusicAsset(publicAsset, `storage:${storageKey}`);
    }
    const images: Record<string, string> = {};
    for (const assetId of referencedImageAssets(configuration)) {
      const asset = await getMediaRecord(db, assetId, lock);
      if (!asset || (asset.type !== 'image' && asset.type !== 'logo')) {
        throw unprocessable('UNKNOWN_IMAGE', `Annotation image ${assetId} not found`);
      }
      images[assetId] = `storage:${asset.storageKey}`;
    }
    return {
      version,
      template,
      normalized,
      music,
      musicAsset,
      musicAssetId: configuration.music?.assetId ?? null,
      images,
    };
  }

  private async checkTopic(db: Queryable, topicId: string | null) {
    if (topicId !== null && !(await topicExists(db, topicId))) {
      throw unprocessable('UNKNOWN_TOPIC', 'Topic not found');
    }
  }
}
