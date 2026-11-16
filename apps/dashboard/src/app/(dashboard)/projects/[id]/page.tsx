'use client';

import type { RenderRequest } from '@statsopedia/shared-types';
import { formatsForMode } from '@statsopedia/video-config';
import { Copy, Eye, Film, Rocket, SlidersHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { JobProgress } from '@/components/renders/JobStatus';
import { useProjectActions } from '@/components/projects/actions';
import { useBreadcrumb } from '@/components/shell/Shell';
import {
  Button,
  ButtonLink,
  DefinitionList,
  EmptyState,
  Grid,
  PageHeader,
  Panel,
  ProgressBar,
  QueryState,
  StatusPill,
  Tag,
  table,
} from '@/components/ui';
import { VideoCard, VideoGrid } from '@/components/videos/VideoCard';
import { useDataset, useMedia, useProject, useTemplates, useVersions } from '@/lib/api/queries';
import { formatRelative } from '@/lib/format';
import { FORMAT_LABEL, PROJECT_STATUS, REQUEST_STATUS } from '@/lib/status';

const REQUEST_LABEL: Record<RenderRequest['type'], string> = {
  preview: 'Preview',
  long_form: 'Long-form',
  short: 'Shorts',
  both: 'Long-form + Shorts',
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useProject(id);
  const actions = useProjectActions();
  useBreadcrumb(`/projects/${id}`, detail.data?.project.name);

  return (
    <QueryState query={detail}>
      {({ project, renders, outputs }) => {
        const formats = formatsForMode(project.configuration.outputMode);
        const rendering = actions.render.isPending;
        return (
          <>
            <PageHeader
              title={
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  {project.name}
                  <StatusPill
                    {...PROJECT_STATUS[project.status]}
                    live={project.status === 'rendering'}
                  />
                </span>
              }
              description={project.configuration.title}
              actions={
                <>
                  <Button
                    icon={Copy}
                    loading={actions.duplicate.isPending}
                    onClick={() => actions.duplicate.mutate(project)}
                  >
                    Duplicate
                  </Button>
                  {project.status === 'draft' ? (
                    <Button
                      icon={Trash2}
                      variant="ghost"
                      onClick={() => actions.requestDelete(project)}
                    >
                      Delete
                    </Button>
                  ) : null}
                  <ButtonLink href={`/studio/${project.id}`} icon={SlidersHorizontal}>
                    Open in Studio
                  </ButtonLink>
                  <Button
                    icon={Eye}
                    loading={rendering && actions.render.variables?.kind === 'preview'}
                    onClick={() => actions.render.mutate({ project, kind: 'preview' })}
                  >
                    Render preview
                  </Button>
                  <Button
                    variant="primary"
                    icon={Rocket}
                    loading={rendering && actions.render.variables?.kind === 'final'}
                    onClick={() => actions.render.mutate({ project, kind: 'final' })}
                  >
                    Render {formats.length === 2 ? 'both formats' : FORMAT_LABEL[formats[0]!]}
                  </Button>
                </>
              }
            />
            <Grid columns="minmax(0, 1fr) minmax(300px, 380px)">
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                <Panel
                  title="Renders"
                  description="Every preview and final render of this project, newest first"
                  flush
                >
                  {renders.length === 0 ? (
                    <EmptyState icon={Rocket} title="Not rendered yet">
                      Render a preview to check the video, then render the final version.
                    </EmptyState>
                  ) : (
                    <div className={table.wrap}>
                      <table className={table.table}>
                        <tbody>
                          {renders.map((request) => (
                            <tr key={request.id}>
                              <td style={{ width: 200 }}>
                                <div className={table.strong}>
                                  {REQUEST_LABEL[request.type]} · v{request.renderVersion}
                                </div>
                                <div className={table.muted} style={{ fontSize: 12 }}>
                                  {formatRelative(request.createdAt)}
                                </div>
                              </td>
                              <td style={{ width: 180 }}>
                                <div style={{ display: 'grid', gap: 6 }}>
                                  <StatusPill
                                    {...REQUEST_STATUS[request.status]}
                                    live={request.status === 'in_progress'}
                                  />
                                  {request.status === 'in_progress' ||
                                  request.status === 'pending' ? (
                                    <ProgressBar
                                      value={request.percent}
                                      active
                                      label={`${request.percent}%`}
                                    />
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div style={{ display: 'grid', gap: 10 }}>
                                  {request.jobs.map((job) => (
                                    <div
                                      key={job.id}
                                      style={{
                                        display: 'grid',
                                        gridTemplateColumns: '120px 1fr',
                                        gap: 10,
                                        alignItems: 'start',
                                      }}
                                    >
                                      <Link
                                        href={`/renders?job=${job.id}`}
                                        className={table.link}
                                        style={{ fontSize: 12.5 }}
                                      >
                                        {FORMAT_LABEL[job.outputFormat]}
                                      </Link>
                                      <JobProgress job={job} />
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
                <Panel title="Videos" description="Finished previews and final renders">
                  {outputs.length === 0 ? (
                    <EmptyState icon={Film} title="No videos yet" />
                  ) : (
                    <VideoGrid>
                      {outputs.map((output) => (
                        <VideoCard
                          key={output.id}
                          output={output}
                          title={project.configuration.title}
                        />
                      ))}
                    </VideoGrid>
                  )}
                </Panel>
              </div>
              <ProjectSummary project={project} />
            </Grid>
            {actions.confirmDelete}
          </>
        );
      }}
    </QueryState>
  );
}

function ProjectSummary({
  project,
}: {
  project: NonNullable<ReturnType<typeof useProject>['data']>['project'];
}) {
  const dataset = useDataset(project.datasetId);
  const versions = useVersions(project.datasetId);
  const templates = useTemplates();
  const music = useMedia('music');
  const config = project.configuration;
  const version = versions.data?.find((item) => item.id === project.datasetVersionId);
  const template = templates.data?.find((item) => item.id === project.templateId);
  const track = config.music
    ? music.data?.find((asset) => asset.id === config.music?.assetId)
    : null;
  return (
    <Panel title="Configuration" actions={<Tag>revision {project.revision}</Tag>}>
      <DefinitionList
        items={[
          [
            'Dataset',
            <Link
              key="d"
              href={`/datasets/${project.datasetId}?version=${project.datasetVersionId}`}
              className={table.link}
            >
              {dataset.data?.dataset.title ?? '…'}
              {version ? ` · v${version.version}` : ''}
            </Link>,
          ],
          [
            'Template',
            template
              ? `${template.name} · v${project.templateVersion}`
              : `v${project.templateVersion}`,
          ],
          ['Periods', `${config.startPeriod ?? 'first'} → ${config.endPeriod ?? 'last'}`],
          ['Top N', config.topN],
          ['Speed', config.animationSpeed],
          ['Theme', config.theme],
          [
            'Outputs',
            formatsForMode(config.outputMode)
              .map((format) => FORMAT_LABEL[format])
              .join(', '),
          ],
          ['Resolution', `${config.resolution} · ${config.fps} fps`],
          [
            'Intro / outro',
            `${config.intro.enabled ? `${config.intro.durationSeconds} s` : 'off'} / ${config.outro.enabled ? `${config.outro.durationSeconds} s` : 'off'}`,
          ],
          [
            'Music',
            config.music
              ? `${track?.name ?? 'Track'} · ${Math.round(config.music.volume * 100)}%`
              : 'None',
          ],
          ['Annotations', config.annotations.length],
          ['Updated', formatRelative(project.updatedAt)],
        ]}
      />
    </Panel>
  );
}
