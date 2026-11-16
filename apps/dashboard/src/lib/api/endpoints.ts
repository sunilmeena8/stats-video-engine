import {
  dashboardStatsSchema,
  datasetDetailResponseSchema,
  datasetListResponseSchema,
  datasetPreviewResponseSchema,
  datasetSchema,
  datasetVersionsResponseSchema,
  importResponseSchema,
  jobDetailResponseSchema,
  jobListResponseSchema,
  mediaAssetSchema,
  normalizedDatasetSchema,
  outputListResponseSchema,
  projectDetailResponseSchema,
  projectListResponseSchema,
  renderJobSchema,
  renderRequestDetailResponseSchema,
  renderRequestSchema,
  renderSubmissionResponseSchema,
  topicSchema,
  userSchema,
  validateResponseSchema,
  videoProjectSchema,
  videoTemplateSchema,
} from '@statsopedia/shared-schemas';
import type {
  CreateDatasetRequest,
  CreateProjectRequest,
  CreateTopicRequest,
  LicenseType,
  MediaAssetType,
  MusicCategory,
  UpdateMediaRequest,
  OutputFormat,
  RenderJobStatus,
  RenderKind,
  UpdateProjectRequest,
} from '@statsopedia/shared-types';
import { z } from 'zod';

import { api, apiVoid, local } from './client';

/** Every API call the dashboard makes, typed by the shared contracts. */
/** What `POST /api/media` records with a file; music needs its category and licensing. */
export interface MediaUploadMeta {
  type: MediaAssetType;
  name?: string;
  category?: MusicCategory;
  licenseType?: LicenseType;
  license?: string;
  commercialUse?: boolean;
  attributionRequired?: boolean;
  attribution?: string;
  licenseReference?: string;
}

export const endpoints = {
  // Session
  me: () => local('/api/session', userSchema),
  login: (email: string, password: string) =>
    local('/api/session', z.object({ user: userSchema }), {
      method: 'POST',
      json: { email, password },
    }),
  logout: () => fetch('/api/session', { method: 'DELETE' }),

  stats: () => api('/stats', dashboardStatsSchema),

  // Topics and templates
  topics: () => api('/topics', z.object({ topics: z.array(topicSchema) })).then((r) => r.topics),
  createTopic: (body: CreateTopicRequest) =>
    api('/topics', topicSchema, { method: 'POST', json: body }),
  templates: () =>
    api('/templates', z.object({ templates: z.array(videoTemplateSchema) })).then(
      (r) => r.templates,
    ),

  // Datasets
  datasets: () => api('/datasets', datasetListResponseSchema).then((r) => r.datasets),
  dataset: (id: string) => api(`/datasets/${id}`, datasetDetailResponseSchema),
  createDataset: (body: CreateDatasetRequest) =>
    api('/datasets', datasetSchema, { method: 'POST', json: body }),
  versions: (id: string) =>
    api(`/datasets/${id}/versions`, datasetVersionsResponseSchema).then((r) => r.versions),
  preview: (
    id: string,
    query: {
      versionId?: string | undefined;
      period?: string | undefined;
      top?: number;
      entity?: string | undefined;
      issuesOffset?: number;
      issuesLimit?: number;
      rowsOffset?: number;
      rowsLimit?: number;
    },
  ) => api(`/datasets/${id}/preview`, datasetPreviewResponseSchema, { query }),
  normalized: (datasetId: string, versionId: string) =>
    api(`/datasets/${datasetId}/versions/${versionId}/normalized`, normalizedDatasetSchema),
  importCsv: (id: string, file: File) =>
    api(`/datasets/${id}/import`, importResponseSchema, {
      method: 'POST',
      query: { filename: file.name },
      headers: { 'content-type': 'text/csv' },
      body: file,
    }),
  validateCsv: (id: string, file: File) =>
    api(`/datasets/${id}/validate`, validateResponseSchema, {
      method: 'POST',
      query: { filename: file.name },
      headers: { 'content-type': 'text/csv' },
      body: file,
    }),

  // Media
  media: (type?: MediaAssetType) =>
    api('/media', z.object({ assets: z.array(mediaAssetSchema) }), { query: { type } }).then(
      (r) => r.assets,
    ),
  uploadMedia: (file: File, meta: MediaUploadMeta) =>
    api('/media', mediaAssetSchema, {
      method: 'POST',
      query: { ...meta, filename: file.name },
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    }),
  updateMedia: (id: string, body: UpdateMediaRequest) =>
    api(`/media/${id}`, mediaAssetSchema, { method: 'PATCH', json: body }),

  // Projects
  projects: () => api('/projects', projectListResponseSchema).then((r) => r.projects),
  project: (id: string) => api(`/projects/${id}`, projectDetailResponseSchema),
  createProject: (body: CreateProjectRequest) =>
    api('/projects', videoProjectSchema, { method: 'POST', json: body }),
  updateProject: (id: string, body: UpdateProjectRequest) =>
    api(`/projects/${id}`, videoProjectSchema, { method: 'PUT', json: body }),
  duplicateProject: (id: string) =>
    api(`/projects/${id}/duplicate`, videoProjectSchema, { method: 'POST' }),
  deleteProject: (id: string) => apiVoid(`/projects/${id}`, { method: 'DELETE' }),
  submitRender: (
    id: string,
    kind: RenderKind,
    formats: OutputFormat[] | undefined,
    idempotencyKey: string,
  ) =>
    api(
      `/projects/${id}/${kind === 'final' ? 'render' : 'preview'}`,
      renderSubmissionResponseSchema,
      {
        method: 'POST',
        json: formats ? { formats } : {},
        headers: { 'idempotency-key': idempotencyKey },
      },
    ),

  // Render jobs and requests
  jobs: (filter: { projectId?: string; status?: RenderJobStatus; limit?: number } = {}) =>
    api('/jobs', jobListResponseSchema, { query: { limit: 100, ...filter } }).then((r) => r.jobs),
  job: (id: string) => api(`/jobs/${id}`, jobDetailResponseSchema),
  cancelJob: (id: string) =>
    api(`/jobs/${id}/cancel`, z.object({ job: renderJobSchema }), { method: 'POST' }),
  retryJob: (id: string) =>
    api(`/jobs/${id}/retry`, renderSubmissionResponseSchema, { method: 'POST' }),
  render: (id: string) => api(`/renders/${id}`, renderRequestDetailResponseSchema),
  cancelRender: (id: string) =>
    api(`/renders/${id}/cancel`, z.object({ request: renderRequestSchema }), { method: 'POST' }),

  // Generated videos
  outputs: (filter: { kind?: RenderKind; projectId?: string } = {}) =>
    api('/outputs', outputListResponseSchema, { query: { limit: 200, ...filter } }).then(
      (r) => r.outputs,
    ),
};
