'use client';

import type { AnimationSpeed, OutputMode, VideoThemeId } from '@statsopedia/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_VIDEO_CONFIGURATION } from '@statsopedia/video-config';
import { Database, Save, SlidersHorizontal } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import {
  OutputFields,
  PeriodFields,
  SpeedField,
  ThemeField,
  TopNField,
  useVersionPeriods,
} from '@/components/projects/ConfigFields';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Panel,
  Select,
  SkeletonRows,
} from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';
import { keys, useDatasets, useTemplates, useTopics, useVersions } from '@/lib/api/queries';
import { formatDate } from '@/lib/format';

export function NewProjectForm() {
  const params = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const datasets = useDatasets();
  const templates = useTemplates();
  const topics = useTopics();

  // null = untouched: follows the chosen dataset (its title and topic).
  const [nameInput, setName] = useState<string | null>(null);
  const [topicInput, setTopicId] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState(params.get('dataset') ?? '');
  const [versionInput, setVersionId] = useState(params.get('version') ?? '');
  const [templateInput, setTemplateId] = useState('');
  const [range, setRange] = useState<{ startPeriod: string | null; endPeriod: string | null }>({
    startPeriod: null,
    endPeriod: null,
  });
  const [topN, setTopN] = useState(DEFAULT_VIDEO_CONFIGURATION.topN);
  const [speed, setSpeed] = useState<AnimationSpeed>(DEFAULT_VIDEO_CONFIGURATION.animationSpeed);
  const [theme, setTheme] = useState<VideoThemeId>(DEFAULT_VIDEO_CONFIGURATION.theme);
  const [mode, setMode] = useState<OutputMode>(DEFAULT_VIDEO_CONFIGURATION.outputMode);

  const dataset = datasets.data?.find((item) => item.id === datasetId);
  const versions = useVersions(datasetId || undefined);
  const usable = useMemo(
    () =>
      versions.data?.filter(
        (version) => version.status === 'ready' && version.hasNormalizedOutput,
      ) ?? [],
    [versions.data],
  );
  // Selections fall back sensibly as data arrives: the dataset's latest valid version (or its
  // newest usable one), the first template, the dataset's title and topic.
  const isUsable = (id: string | null | undefined) =>
    Boolean(id && usable.some((v) => v.id === id));
  const versionId = isUsable(versionInput)
    ? versionInput
    : isUsable(dataset?.latestVersionId)
      ? dataset!.latestVersionId!
      : (usable[0]?.id ?? '');
  const templateId = templateInput || templates.data?.[0]?.id || '';
  const name = nameInput ?? dataset?.title ?? '';
  const topicId = topicInput ?? dataset?.topicId ?? '';
  const periods = useVersionPeriods(datasetId || undefined, versionId || undefined);
  const template = templates.data?.find((item) => item.id === templateId);

  const create = useMutation({
    mutationFn: () =>
      endpoints.createProject({
        name,
        topicId: topicId || null,
        configuration: {
          datasetVersionId: versionId,
          templateId,
          startPeriod: range.startPeriod,
          endPeriod: range.endPeriod,
          topN,
          animationSpeed: speed,
          theme,
          outputMode: mode,
        },
      }),
  });
  const save = (then: 'project' | 'studio') =>
    create.mutate(undefined, {
      onSuccess: (project) => {
        void client.invalidateQueries({ queryKey: keys.projects });
        router.push(then === 'studio' ? `/studio/${project.id}` : `/projects/${project.id}`);
      },
    });

  if (datasets.isPending || templates.isPending) return <SkeletonRows rows={8} />;
  const withVersions = datasets.data?.filter((item) => item.latestVersion) ?? [];
  if (!withVersions.length) {
    return (
      <Panel>
        <EmptyState
          icon={Database}
          title="No dataset is ready yet"
          action={
            <ButtonLink href="/datasets" variant="primary" size="sm">
              Go to datasets
            </ButtonLink>
          }
        >
          A video project needs a dataset with at least one valid, processed version.
        </EmptyState>
      </Panel>
    );
  }

  const ready = Boolean(name.trim() && versionId && templateId);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save('project');
      }}
    >
      <PageHeader
        title="New video project"
        description="Pick the data and the essentials now; titles, music and annotations are set in the Video Studio."
        actions={
          <>
            <Button type="submit" icon={Save} disabled={!ready} loading={create.isPending}>
              Save draft
            </Button>
            <Button
              variant="primary"
              icon={SlidersHorizontal}
              disabled={!ready}
              loading={create.isPending}
              onClick={() => save('studio')}
            >
              Save and open Studio
            </Button>
          </>
        }
      />
      <div style={{ display: 'grid', gap: 16, maxWidth: 980 }}>
        <ErrorBanner error={create.error} title="The project could not be saved" />
        <Panel title="Project">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            <Field label="Name">
              {(id) => (
                <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Topic">
              {(id) => (
                <Select id={id} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                  <option value="">No topic</option>
                  {topics.data?.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </Panel>
        <Panel
          title="Data"
          description="The project stays on the version you pick, even when newer versions are uploaded."
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            <Field label="Dataset">
              {(id) => (
                <Select
                  id={id}
                  required
                  value={datasetId}
                  onChange={(e) => {
                    setDatasetId(e.target.value);
                    setVersionId('');
                    setRange({ startPeriod: null, endPeriod: null });
                  }}
                >
                  <option value="">Choose a dataset</option>
                  {withVersions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Dataset version">
              {(id) => (
                <Select
                  id={id}
                  required
                  value={versionId}
                  disabled={!datasetId}
                  onChange={(e) => {
                    setVersionId(e.target.value);
                    setRange({ startPeriod: null, endPeriod: null });
                  }}
                >
                  {!usable.length ? <option value="">No usable versions</option> : null}
                  {usable.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.version} ·{' '}
                      {version.periodRange
                        ? `${version.periodRange.start}–${version.periodRange.end}`
                        : ''}{' '}
                      · {formatDate(version.createdAt)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Template"
              hint={
                template
                  ? `Version ${template.version} · ${template.description ?? template.compositionId}`
                  : undefined
              }
            >
              {(id) => (
                <Select
                  id={id}
                  required
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                >
                  {templates.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} (v{item.version})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <PeriodFields periods={periods.data} {...range} onChange={setRange} />
          </div>
        </Panel>
        <Panel title="Video">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 18,
            }}
          >
            <TopNField value={topN} onChange={setTopN} />
            <SpeedField value={speed} onChange={setSpeed} />
            <ThemeField value={theme} onChange={setTheme} />
            <OutputFields
              mode={mode}
              supported={template?.supportedFormats ?? ['long', 'short']}
              onChange={setMode}
            />
          </div>
        </Panel>
      </div>
    </form>
  );
}
