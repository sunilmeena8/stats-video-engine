'use client';

import type { MediaAssetType, RenderKind } from '@statsopedia/shared-types';
import { useQuery } from '@tanstack/react-query';

import { endpoints } from './endpoints';

/** Query keys in one place, so mutations invalidate exactly what they change. */
export const keys = {
  me: ['me'] as const,
  stats: ['stats'] as const,
  topics: ['topics'] as const,
  templates: ['templates'] as const,
  datasets: ['datasets'] as const,
  dataset: (id: string) => ['datasets', id] as const,
  versions: (id: string) => ['datasets', id, 'versions'] as const,
  preview: (id: string, query: object) => ['datasets', id, 'preview', query] as const,
  normalized: (datasetId: string, versionId: string) =>
    ['normalized', datasetId, versionId] as const,
  media: (type?: MediaAssetType) => ['media', type ?? 'all'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['projects', id] as const,
  jobs: ['jobs'] as const,
  job: (id: string) => ['job', id] as const,
  outputs: (kind?: RenderKind) => ['outputs', kind ?? 'all'] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: endpoints.me, staleTime: 300_000 });
export const useStats = () =>
  useQuery({ queryKey: keys.stats, queryFn: endpoints.stats, refetchInterval: 60_000 });
export const useTopics = () => useQuery({ queryKey: keys.topics, queryFn: endpoints.topics });
export const useTemplates = () =>
  useQuery({ queryKey: keys.templates, queryFn: endpoints.templates, staleTime: 300_000 });
export const useDatasets = () => useQuery({ queryKey: keys.datasets, queryFn: endpoints.datasets });
export const useDataset = (id: string) =>
  useQuery({ queryKey: keys.dataset(id), queryFn: () => endpoints.dataset(id) });
export const useVersions = (id: string | undefined) =>
  useQuery({
    queryKey: keys.versions(id ?? ''),
    queryFn: () => endpoints.versions(id!),
    enabled: Boolean(id),
  });
export const useMedia = (type?: MediaAssetType) =>
  useQuery({ queryKey: keys.media(type), queryFn: () => endpoints.media(type) });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: endpoints.projects });
export const useProject = (id: string) =>
  useQuery({ queryKey: keys.project(id), queryFn: () => endpoints.project(id) });
/** The render queue: kept live by the queue event stream (see useQueueStream). */
export const useJobs = () =>
  useQuery({ queryKey: keys.jobs, queryFn: () => endpoints.jobs({ limit: 200 }) });
export const useOutputs = (kind?: RenderKind) =>
  useQuery({
    queryKey: keys.outputs(kind),
    queryFn: () => endpoints.outputs(kind ? { kind } : {}),
  });

/** Versions are immutable, so their animation data is cached for the session. */
export const useNormalized = (datasetId: string | undefined, versionId: string | undefined) =>
  useQuery({
    queryKey: keys.normalized(datasetId ?? '', versionId ?? ''),
    queryFn: () => endpoints.normalized(datasetId!, versionId!),
    enabled: Boolean(datasetId && versionId),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
