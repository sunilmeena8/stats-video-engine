'use client';

import { checkRaceQuality, suggestAnnotations } from '@statsopedia/chart-components';
import { barChartRacePropsSchema } from '@statsopedia/shared-schemas';
import type {
  OutputFormat,
  QualityReport,
  VideoConfiguration,
  VideoProject,
} from '@statsopedia/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  buildRaceConfig,
  formatsForMode,
  planRaceRender,
  referencedImageAssets,
  resolveMusicAsset,
} from '@statsopedia/video-config';
import {
  Clapperboard,
  Eye,
  Film,
  Monitor,
  Music,
  Palette,
  RotateCcw,
  Rocket,
  Save,
  Smartphone,
  StickyNote,
  Timer,
  Type,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from 'zod';

import {
  OutputFields,
  PeriodFields,
  SpeedField,
  ThemeField,
  TopNField,
} from '@/components/projects/ConfigFields';
import { useProjectActions } from '@/components/projects/actions';
import { useBreadcrumb } from '@/components/shell/Shell';
import { AnnotationsEditor } from '@/components/studio/AnnotationsEditor';
import { MusicPanel } from '@/components/studio/MusicPanel';
import { QualityPanel, summary } from '@/components/studio/QualityPanel';
import styles from '@/components/studio/studio.module.css';
import {
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  ErrorBanner,
  Field,
  Input,
  PageHeader,
  Panel,
  QueryState,
  Range,
  Segmented,
  Skeleton,
  StatusPill,
  Textarea,
  useToast,
} from '@/components/ui';
import { ApiError, backendUrl } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { keys, useMedia, useNormalized, useProject, useTemplates } from '@/lib/api/queries';
import { FORMAT_LABEL, PROJECT_STATUS } from '@/lib/status';

const StudioPlayer = dynamic(() => import('@/components/studio/StudioPlayer'), {
  ssr: false,
  loading: () => <Skeleton height={360} />,
});

interface Draft {
  name: string;
  topicId: string | null;
  configuration: VideoConfiguration;
}

const draftOf = (project: VideoProject): Draft => ({
  name: project.name,
  topicId: project.topicId,
  configuration: project.configuration,
});

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function StudioWorkspacePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const detail = useProject(projectId);
  useBreadcrumb(`/studio/${projectId}`, detail.data?.project.name);
  return (
    <QueryState query={detail}>
      {({ project }) => <Workspace key={project.id} project={project} />}
    </QueryState>
  );
}

function Workspace({ project }: { project: VideoProject }) {
  const client = useQueryClient();
  const toast = useToast();
  const actions = useProjectActions();
  const templates = useTemplates();
  const music = useMedia('music');
  const imageAssets = useMedia('image');
  const logoAssets = useMedia('logo');
  const normalized = useNormalized(project.datasetId, project.datasetVersionId);

  // Local edits over the saved project (null: none). A save is checked against the revision
  // the edits started from, so changes made elsewhere meanwhile are never overwritten.
  const [edits, setEdits] = useState<{ draft: Draft; baseRevision: number } | null>(null);
  const draft = edits?.draft ?? draftOf(project);
  const dirty = edits !== null && JSON.stringify(edits.draft) !== JSON.stringify(draftOf(project));
  const edit = (update: (current: Draft) => Draft) =>
    setEdits((current) => ({
      draft: update(current?.draft ?? draftOf(project)),
      baseRevision: current?.baseRevision ?? project.revision,
    }));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const config = draft.configuration;
  const set = (patch: Partial<VideoConfiguration>) =>
    edit((current) => ({ ...current, configuration: { ...current.configuration, ...patch } }));

  const save = useMutation({
    mutationFn: () =>
      endpoints.updateProject(project.id, {
        revision: edits?.baseRevision ?? project.revision,
        name: draft.name,
        topicId: draft.topicId,
        configuration: draft.configuration,
      }),
    onSuccess: (updated) => {
      setEdits(null);
      client.setQueryData(
        keys.project(project.id),
        (current: { project: VideoProject } | undefined) =>
          current ? { ...current, project: updated } : current,
      );
      void client.invalidateQueries({ queryKey: keys.projects });
      toast({ tone: 'good', title: 'Saved', detail: `Revision ${updated.revision}` });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.code === 'REVISION_CONFLICT';

  // ── Live preview: the same props a render would get, rebuilt shortly after each edit.
  const formats = formatsForMode(config.outputMode);
  const [format, setFormat] = useState<OutputFormat>(formats[0]!);
  const previewConfig = useDebounced(config, 300);
  const images = useMemo(
    () => [...(imageAssets.data ?? []), ...(logoAssets.data ?? [])],
    [imageAssets.data, logoAssets.data],
  );
  const preview = useMemo(() => {
    if (!normalized.data || !music.data) return null;
    const proxied = (id: string) => `${window.location.origin}${backendUrl(`/media/${id}/file`)}`;
    try {
      // The same resolution the API does, with files served through the dashboard proxy.
      const musicAsset = previewConfig.music
        ? (music.data.find((asset) => asset.id === previewConfig.music!.assetId) ?? null)
        : null;
      if (previewConfig.music && !musicAsset) return { error: 'The music track no longer exists.' };
      const imageSources = Object.fromEntries(
        referencedImageAssets(previewConfig)
          .filter((id) => images.some((image) => image.id === id))
          .map((id) => [id, proxied(id)]),
      );
      const build = (target: OutputFormat) => {
        const raceConfig = buildRaceConfig(previewConfig, {
          format: target,
          kind: 'final',
          music: musicAsset ? resolveMusicAsset(musicAsset, proxied(musicAsset.id)) : null,
          images: imageSources,
        });
        return barChartRacePropsSchema.safeParse({ dataset: normalized.data, config: raceConfig });
      };
      const parsed = build(format);
      if (!parsed.success) return { error: z.prettifyError(parsed.error) };
      const reports: Partial<Record<OutputFormat, QualityReport>> = {};
      for (const target of new Set([format, ...formatsForMode(previewConfig.outputMode)])) {
        const props = target === format ? parsed : build(target);
        if (props.success) {
          reports[target] = checkRaceQuality({
            props: props.data,
            kind: 'final',
            requestedVolume: previewConfig.music?.volume ?? null,
            musicAsset,
          });
        }
      }
      return { props: parsed.data, plan: planRaceRender(parsed.data), reports };
    } catch (error) {
      return { error: error instanceof z.ZodError ? z.prettifyError(error) : String(error) };
    }
  }, [normalized.data, music.data, images, previewConfig, format]);
  const reports: Partial<Record<OutputFormat, QualityReport>> =
    (preview && 'reports' in preview ? preview.reports : undefined) ?? {};
  const blocked = formats.filter((target) => reports[target]?.status === 'fail');
  const currentReport = reports[format];

  const periods = normalized.data?.timeRange.periods ?? [];
  const datasetSources = useMemo(
    () => (normalized.data?.sources ?? []).map((source) => ({ name: source.id, url: source.url })),
    [normalized.data],
  );
  const template = templates.data?.find((item) => item.id === config.templateId);
  const status = PROJECT_STATUS[project.status];

  return (
    <>
      <PageHeader
        title={draft.name}
        description={
          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            Video Studio · {status.label} · revision {project.revision}
            {dirty ? <span className={styles.dirty}>Unsaved changes</span> : null}
          </span>
        }
        actions={
          <>
            <ButtonLink href={`/projects/${project.id}`} variant="ghost" icon={Clapperboard}>
              Project
            </ButtonLink>
            <Button
              icon={RotateCcw}
              variant="ghost"
              disabled={!dirty || save.isPending}
              onClick={() => setEdits(null)}
            >
              Discard
            </Button>
            <Button
              icon={Save}
              variant={dirty ? 'primary' : 'secondary'}
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            <Button
              icon={Eye}
              disabled={dirty || !formats.includes(format) || blocked.includes(format)}
              title={
                dirty
                  ? 'Save your changes first'
                  : !formats.includes(format)
                    ? `${FORMAT_LABEL[format]} is not an output of this project`
                    : blocked.includes(format)
                      ? 'Fix the problems found by the quality checks first'
                      : undefined
              }
              loading={actions.render.isPending && actions.render.variables?.kind === 'preview'}
              onClick={() => actions.render.mutate({ project, kind: 'preview', formats: [format] })}
            >
              Render {format === 'long' ? '16:9' : '9:16'} preview
            </Button>
            <Button
              icon={Rocket}
              variant={dirty ? 'secondary' : 'primary'}
              disabled={dirty || blocked.length > 0}
              title={
                dirty
                  ? 'Save your changes first'
                  : blocked.length
                    ? 'Fix the problems found by the quality checks first'
                    : undefined
              }
              loading={actions.render.isPending && actions.render.variables?.kind === 'final'}
              onClick={() => actions.render.mutate({ project, kind: 'final' })}
            >
              Final render
            </Button>
          </>
        }
      />
      {conflict ? (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="warning" title="This project was changed elsewhere since you opened it">
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button
                size="sm"
                onClick={() => {
                  void endpoints.project(project.id).then((fresh) => {
                    client.setQueryData(keys.project(project.id), fresh);
                    setEdits(null);
                    save.reset();
                  });
                }}
              >
                Load the latest version (discards your changes)
              </Button>
            </div>
          </Banner>
        </div>
      ) : save.error ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorBanner error={save.error} title="Not saved" />
        </div>
      ) : null}

      <div className={styles.workspace}>
        <div className={styles.controls}>
          <Section icon={Type} title="Titles" open>
            <Field label="Project name">
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(e) => edit((current) => ({ ...current, name: e.target.value }))}
                />
              )}
            </Field>
            <Field
              label="Video title"
              aside={`${config.title.length}/100`}
              hint="Shown on screen and used as the YouTube title."
            >
              {(id) => (
                <Input
                  id={id}
                  maxLength={100}
                  value={config.title}
                  onChange={(e) => set({ title: e.target.value })}
                />
              )}
            </Field>
            <Field label="Subtitle" hint="Shown under the title on the intro card.">
              {(id) => (
                <Input
                  id={id}
                  value={config.intro.subtitle ?? ''}
                  onChange={(e) =>
                    set({ intro: { ...config.intro, subtitle: e.target.value || null } })
                  }
                />
              )}
            </Field>
            <div className={styles.row}>
              <Field label="Metric name" hint="e.g. Net worth">
                {(id) => (
                  <Input
                    id={id}
                    value={config.metricLabel ?? ''}
                    onChange={(e) => set({ metricLabel: e.target.value || null })}
                  />
                )}
              </Field>
              <Field label="Unit" hint="e.g. USD billions">
                {(id) => (
                  <Input
                    id={id}
                    value={config.unitLabel ?? ''}
                    onChange={(e) => set({ unitLabel: e.target.value || null })}
                  />
                )}
              </Field>
            </div>
            <Field
              label="Metric description"
              aside={`${(config.metricDescription ?? '').length}/200`}
              hint="One sentence on what is measured, shown on the intro. Defaults to the dataset description."
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={200}
                  value={config.metricDescription ?? ''}
                  onChange={(e) => set({ metricDescription: e.target.value || null })}
                />
              )}
            </Field>
            <Field label="YouTube description">
              {(id) => (
                <Textarea
                  id={id}
                  value={config.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              )}
            </Field>
          </Section>

          <Section icon={Timer} title="Range and pacing" open>
            <PeriodFields
              periods={periods}
              startPeriod={config.startPeriod}
              endPeriod={config.endPeriod}
              onChange={(range) => set(range)}
            />
            <TopNField value={config.topN} onChange={(topN) => set({ topN })} />
            <SpeedField
              value={config.animationSpeed}
              onChange={(animationSpeed) => set({ animationSpeed })}
            />
          </Section>

          <Section icon={Film} title="Intro, outro and credits">
            <Checkbox
              label="Intro: branding, title, metric and period"
              checked={config.intro.enabled}
              onChange={(enabled) => set({ intro: { ...config.intro, enabled } })}
            />
            <Field label="Intro duration" aside={`${config.intro.durationSeconds} s`}>
              {(id) => (
                <Range
                  id={id}
                  min={0.5}
                  max={10}
                  step={0.5}
                  disabled={!config.intro.enabled}
                  value={config.intro.durationSeconds}
                  onChange={(e) =>
                    set({ intro: { ...config.intro, durationSeconds: Number(e.target.value) } })
                  }
                />
              )}
            </Field>
            <Checkbox
              label="Outro: final ranking, winner and end card"
              checked={config.outro.enabled}
              onChange={(enabled) => set({ outro: { ...config.outro, enabled } })}
            />
            <Field
              label="Outro duration"
              aside={`${config.outro.durationSeconds} s`}
              hint="From 3 s the final ranking is followed by the end card."
            >
              {(id) => (
                <Range
                  id={id}
                  min={0.5}
                  max={12}
                  step={0.5}
                  disabled={!config.outro.enabled}
                  value={config.outro.durationSeconds}
                  onChange={(e) =>
                    set({ outro: { ...config.outro, durationSeconds: Number(e.target.value) } })
                  }
                />
              )}
            </Field>
            <Field label="End card text" hint="e.g. a call to action">
              {(id) => (
                <Input
                  id={id}
                  disabled={!config.outro.enabled}
                  value={config.outro.text ?? ''}
                  onChange={(e) =>
                    set({ outro: { ...config.outro, text: e.target.value || null } })
                  }
                />
              )}
            </Field>
            <Checkbox
              label="Source credits scene"
              checked={config.credits.enabled}
              onChange={(enabled) => set({ credits: { ...config.credits, enabled } })}
            />
            <Field label="Credits duration" aside={`${config.credits.durationSeconds} s`}>
              {(id) => (
                <Range
                  id={id}
                  min={2}
                  max={12}
                  step={0.5}
                  disabled={!config.credits.enabled}
                  value={config.credits.durationSeconds}
                  onChange={(e) =>
                    set({
                      credits: { ...config.credits, durationSeconds: Number(e.target.value) },
                    })
                  }
                />
              )}
            </Field>
            <Checkbox
              label="Show source URLs in the credits"
              checked={config.credits.showUrls}
              disabled={!config.credits.enabled}
              onChange={(showUrls) => set({ credits: { ...config.credits, showUrls } })}
            />
            <Field
              label="Compact source label"
              hint="Shown under the chart. Defaults to “Source:” and the dataset's sources."
            >
              {(id) => (
                <Input
                  id={id}
                  maxLength={200}
                  placeholder={
                    datasetSources.length
                      ? `Source: ${datasetSources.map((source) => source.name).join(', ')}`
                      : 'Source: …'
                  }
                  value={config.sourceText ?? ''}
                  onChange={(e) => set({ sourceText: e.target.value || null })}
                />
              )}
            </Field>
          </Section>

          <Section icon={StickyNote} title={`Editorial annotations (${config.annotations.length})`}>
            <AnnotationsEditor
              annotations={config.annotations}
              periods={periods}
              images={images}
              datasetSources={datasetSources}
              suggest={
                normalized.data
                  ? () =>
                      suggestAnnotations(normalized.data, {
                        startPeriod: config.startPeriod,
                        endPeriod: config.endPeriod,
                        topN: config.topN,
                        valueFormat: config.valueFormat,
                      })
                  : null
              }
              onChange={(annotations) => set({ annotations })}
            />
          </Section>

          <Section icon={Music} title={config.music ? 'Music' : 'Music (none)'}>
            <MusicPanel
              music={config.music}
              assets={music.data ?? []}
              video={(preview && 'plan' in preview ? preview.plan : undefined) ?? null}
              onChange={(value) => set({ music: value })}
            />
          </Section>

          <Section icon={Palette} title="Style and outputs">
            <ThemeField value={config.theme} onChange={(theme) => set({ theme })} />
            <OutputFields
              mode={config.outputMode}
              supported={template?.supportedFormats ?? ['long', 'short']}
              onChange={(outputMode) => set({ outputMode })}
            />
            <Checkbox
              label="Show logos"
              checked={config.showLogos}
              onChange={(showLogos) => set({ showLogos })}
            />
            <Checkbox
              label="Mark estimated values"
              checked={config.markEstimates}
              onChange={(markEstimates) => set({ markEstimates })}
            />
          </Section>
        </div>

        <div className={styles.preview}>
          <Panel
            title="Preview"
            description="The production composition with the props a render would use"
            actions={
              <Segmented
                label="Layout"
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'long', label: 'Long-form', icon: Monitor },
                  { value: 'short', label: 'Shorts', icon: Smartphone },
                ]}
              />
            }
          >
            {!formats.includes(format) ? (
              <div style={{ marginBottom: 12 }}>
                <Banner
                  tone="info"
                  title={`${FORMAT_LABEL[format]} is not one of this project's outputs`}
                >
                  You can still preview its layout; enable it under Style and outputs to render it.
                </Banner>
              </div>
            ) : null}
            {normalized.error ? (
              <ErrorBanner
                error={normalized.error}
                title="The dataset version could not be loaded"
              />
            ) : !preview ? (
              <Skeleton height={360} />
            ) : 'error' in preview ? (
              <Banner tone="warning" title="This configuration cannot be previewed yet">
                <pre
                  style={{
                    margin: '6px 0 0',
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    color: 'var(--sp-color-text-secondary)',
                  }}
                >
                  {preview.error}
                </pre>
              </Banner>
            ) : (
              <StudioPlayer props={preview.props} plan={preview.plan} />
            )}
          </Panel>
          {currentReport ? (
            <Panel
              title="Quality checks"
              description="Run again on every change, and by the API before rendering"
              actions={
                <StatusPill
                  tone={
                    currentReport.status === 'fail'
                      ? 'critical'
                      : currentReport.status === 'warn'
                        ? 'warning'
                        : 'good'
                  }
                  label={summary(currentReport)}
                />
              }
            >
              <QualityPanel format={format} reports={reports} />
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  open = false,
  children,
}: {
  icon: typeof Type;
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={styles.section} open={open}>
      <summary>
        <Icon size={16} aria-hidden />
        {title}
      </summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  );
}
