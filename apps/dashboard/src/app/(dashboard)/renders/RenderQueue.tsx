'use client';

import { renderJobEventSchema, renderJobSchema } from '@statsopedia/shared-schemas';
import type { RenderJob, RenderJobEvent } from '@statsopedia/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, FileText, ListVideo, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { JobProgress } from '@/components/renders/JobStatus';
import {
  Banner,
  Button,
  ButtonLink,
  DefinitionList,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  QueryState,
  SkeletonRows,
  StatusPill,
  TONE_COLOR,
  Tabs,
  Tag,
  table,
  useToast,
} from '@/components/ui';
import { QualityPanel } from '@/components/studio/QualityPanel';
import { backendUrl } from '@/lib/api/client';
import { endpoints } from '@/lib/api/endpoints';
import { keys, useJobs, useProjects } from '@/lib/api/queries';
import { useEventStream, useLive } from '@/lib/live';
import { formatRelative, formatTimestamp } from '@/lib/format';
import {
  FORMAT_LABEL,
  JOB_STATUS,
  KIND_LABEL,
  canRetry,
  isActive,
  queueGroup,
  type QueueGroup,
} from '@/lib/status';

const GROUPS: { value: QueueGroup; label: string }[] = [
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed & cancelled' },
];

export function RenderQueue() {
  const jobs = useJobs();
  const projects = useProjects();
  const { connected } = useLive();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [group, setGroup] = useState<QueueGroup | 'all'>('all');
  const openJob = params.get('job');
  const names = new Map(projects.data?.map((project) => [project.id, project.name]));
  const counts = Object.fromEntries(
    GROUPS.map(({ value }) => [
      value,
      jobs.data?.filter((job) => queueGroup(job.status) === value).length ?? 0,
    ]),
  ) as Record<QueueGroup, number>;
  const select = (id: string | null) =>
    router.replace(id ? `${pathname}?job=${id}` : pathname, { scroll: false });

  return (
    <>
      <PageHeader
        title="Render Queue"
        description={
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: connected ? TONE_COLOR.good : TONE_COLOR.warning,
              }}
              aria-hidden
            />
            {connected
              ? 'Live: progress streams from the render workers'
              : 'Connecting to live updates…'}
          </span>
        }
      />
      <Tabs
        value={group}
        onChange={setGroup}
        tabs={[
          { value: 'all' as const, label: 'All', count: jobs.data?.length },
          ...GROUPS.map((g) => ({ ...g, count: counts[g.value] })),
        ]}
      />
      <Panel flush>
        <QueryState
          query={jobs}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState icon={ListVideo} title="The queue is empty">
              Render a preview or a final video from a project to see it here.
            </EmptyState>
          }
        >
          {(data) => {
            const rows = data.filter((job) => group === 'all' || queueGroup(job.status) === group);
            if (!rows.length) return <EmptyState icon={ListVideo} title="No jobs here" />;
            return (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Render</th>
                      <th>Status and stage</th>
                      <th className={table.num}>Attempt</th>
                      <th className={table.num}>Updated</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        projectName={names.get(job.projectId) ?? 'Project'}
                        onOpen={() => select(job.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </QueryState>
      </Panel>
      <JobDetail
        jobId={openJob}
        projectName={
          openJob
            ? names.get(jobs.data?.find((job) => job.id === openJob)?.projectId ?? '')
            : undefined
        }
        onClose={() => select(null)}
      />
    </>
  );
}

function useJobActions() {
  const client = useQueryClient();
  const toast = useToast();
  const cancel = useMutation({
    mutationFn: (job: RenderJob) => endpoints.cancelJob(job.id),
    onSuccess: ({ job }) => {
      client.setQueryData<RenderJob[]>(keys.jobs, (jobs) =>
        jobs?.map((item) => (item.id === job.id ? job : item)),
      );
      toast({
        tone: 'info',
        title: job.status === 'cancelled' ? 'Render cancelled' : 'Cancellation requested',
      });
    },
    onError: (error) =>
      toast({ tone: 'critical', title: 'Could not cancel', detail: error.message }),
  });
  const retry = useMutation({
    mutationFn: (job: RenderJob) => endpoints.retryJob(job.id),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: keys.jobs });
      toast({
        tone: 'good',
        title: result.replayed
          ? 'Already queued'
          : `Queued again as v${result.request.renderVersion}`,
        detail: 'It uses the project’s current configuration.',
      });
    },
    onError: (error) =>
      toast({ tone: 'critical', title: 'Could not retry', detail: error.message }),
  });
  return { cancel, retry };
}

function JobRow({
  job,
  projectName,
  onOpen,
}: {
  job: RenderJob;
  projectName: string;
  onOpen: () => void;
}) {
  const { cancel, retry } = useJobActions();
  return (
    <tr>
      <td>
        <Link href={`/projects/${job.projectId}`} className={table.link}>
          {projectName}
        </Link>
        <div className={table.muted} style={{ fontSize: 12 }}>
          {formatTimestamp(job.createdAt)}
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag>{KIND_LABEL[job.kind]}</Tag>
          <Tag>{FORMAT_LABEL[job.outputFormat]}</Tag>
          <Tag>v{job.renderVersion}</Tag>
        </div>
      </td>
      <td style={{ minWidth: 260 }}>
        <JobProgress job={job} />
      </td>
      <td className={table.num}>
        {job.attempts}/{job.maxAttempts}
      </td>
      <td className={`${table.num} ${table.muted}`}>{formatRelative(job.updatedAt)}</td>
      <td>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" icon={FileText} onClick={onOpen}>
            Details
          </Button>
          {isActive(job) ? (
            <Button
              size="sm"
              variant="ghost"
              icon={Ban}
              disabled={Boolean(job.cancelRequestedAt)}
              loading={cancel.isPending}
              onClick={() => cancel.mutate(job)}
            >
              {job.cancelRequestedAt ? 'Cancelling' : 'Cancel'}
            </Button>
          ) : null}
          {canRetry(job) ? (
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCw}
              loading={retry.isPending}
              onClick={() => retry.mutate(job)}
            >
              Retry
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/** Job details with its render log, streamed live from GET /api/jobs/:id/events. */
function JobDetail({
  jobId,
  projectName,
  onClose,
}: {
  jobId: string | null;
  projectName: string | undefined;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { cancel, retry } = useJobActions();
  const detail = useQuery({
    queryKey: keys.job(jobId ?? ''),
    queryFn: () => endpoints.job(jobId!),
    enabled: Boolean(jobId),
  });
  const [log, setLog] = useState<{ jobId: string; events: RenderJobEvent[] }>({
    jobId: '',
    events: [],
  });
  const events = log.jobId === jobId ? log.events : (detail.data?.events ?? []);

  useEventStream(jobId ? backendUrl(`/jobs/${jobId}/events`) : null, {
    state: (data) => {
      const job = renderJobSchema.safeParse(data);
      if (job.success) {
        client.setQueryData(keys.job(job.data.id), (current: typeof detail.data) =>
          current ? { ...current, job: job.data } : current,
        );
      }
    },
    log: (data) => {
      const event = renderJobEventSchema.safeParse(data);
      if (!event.success || !jobId) return;
      setLog((current) => {
        const list = current.jobId === jobId ? current.events : [];
        return list.some((item) => item.id === event.data.id)
          ? current
          : { jobId, events: [...list, event.data].sort((a, b) => a.id - b.id) };
      });
    },
    end: () => {
      void client.invalidateQueries({ queryKey: keys.job(jobId ?? '') });
    },
  });

  const job = detail.data?.job;
  return (
    <Modal
      open={Boolean(jobId)}
      onClose={onClose}
      title={projectName ? `${projectName} · render details` : 'Render details'}
      wide
    >
      {detail.isPending ? (
        <SkeletonRows rows={6} />
      ) : detail.error || !job || !detail.data ? (
        <QueryState query={detail}>{() => null}</QueryState>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 20 }}>
            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <JobProgress job={job} />
              {job.status === 'failed' ? (
                <Banner
                  tone="critical"
                  title={`${job.errorCode ?? 'Error'} after ${job.attempts} attempt(s)`}
                >
                  <div style={{ color: 'var(--sp-color-text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {job.errorMessage}
                  </div>
                </Banner>
              ) : null}
              <div style={{ display: 'flex', gap: 8 }}>
                {isActive(job) ? (
                  <Button
                    size="sm"
                    icon={Ban}
                    disabled={Boolean(job.cancelRequestedAt)}
                    loading={cancel.isPending}
                    onClick={() => cancel.mutate(job)}
                  >
                    Cancel render
                  </Button>
                ) : null}
                {canRetry(job) ? (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={RotateCw}
                    loading={retry.isPending}
                    onClick={() => retry.mutate(job)}
                  >
                    Render again
                  </Button>
                ) : null}
                {job.outputId ? (
                  <ButtonLink size="sm" href="/videos">
                    View video
                  </ButtonLink>
                ) : null}
              </div>
            </div>
            <DefinitionList
              items={[
                [
                  'Render',
                  `${KIND_LABEL[job.kind]} · ${FORMAT_LABEL[job.outputFormat]} · v${job.renderVersion}`,
                ],
                ['Composition', detail.data.manifest.compositionId],
                [
                  'Resolution',
                  `${detail.data.manifest.raceConfig.resolution} · ${detail.data.manifest.raceConfig.fps} fps`,
                ],
                ['Template', `v${detail.data.manifest.templateVersion}`],
                ['Attempts', `${job.attempts} of ${job.maxAttempts}`],
                ['Started', formatTimestamp(job.startedAt)],
                ['Finished', formatTimestamp(job.finishedAt)],
                ...(detail.data.manifest.musicLicense
                  ? ([
                      [
                        'Music',
                        [
                          detail.data.manifest.musicLicense.name,
                          detail.data.manifest.musicLicense.license,
                          detail.data.manifest.musicLicense.commercialUse === false
                            ? 'non-commercial'
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · '),
                      ],
                    ] as [string, string][])
                  : []),
              ]}
            />
            {detail.data.manifest.quality || detail.data.output?.metadata?.qualityChecks.length ? (
              <div style={{ marginTop: 14 }}>
                <QualityPanel
                  format={job.outputFormat}
                  reports={{
                    [job.outputFormat]: {
                      status: detail.data.manifest.quality?.status ?? 'pass',
                      // Checks of the encoded audio replace the predicted ones they confirm.
                      checks: [
                        ...(detail.data.manifest.quality?.checks ?? []).filter(
                          (check) =>
                            !detail.data.output?.metadata?.qualityChecks.some(
                              (measured) => measured.id === check.id,
                            ),
                        ),
                        ...(detail.data.output?.metadata?.qualityChecks ?? []).map((check) => ({
                          ...check,
                          title: `${check.title} (measured)`,
                        })),
                      ],
                    },
                  }}
                />
              </div>
            ) : null}
          </div>
          <Panel
            title="Render log"
            description={isActive(job) ? 'Streaming live' : undefined}
            flush
          >
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: '0 0 8px',
                maxHeight: 320,
                overflow: 'auto',
                fontSize: 12.5,
              }}
            >
              {events.map((event) => {
                const tone =
                  event.level === 'error'
                    ? 'critical'
                    : event.level === 'warn'
                      ? 'warning'
                      : JOB_STATUS[event.status].tone;
                return (
                  <li
                    key={event.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '84px 120px 44px minmax(0, 1fr)',
                      gap: 10,
                      padding: '6px 18px',
                      borderTop: '1px solid var(--sp-color-border)',
                      alignItems: 'baseline',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--sp-color-text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {new Date(event.at).toLocaleTimeString()}
                    </span>
                    <span>
                      <StatusPill tone={tone} label={JOB_STATUS[event.status].label} />
                    </span>
                    <span
                      style={{
                        color: 'var(--sp-color-text-muted)',
                        fontVariantNumeric: 'tabular-nums',
                        textAlign: 'right',
                      }}
                    >
                      {Math.round(event.percent)}%
                    </span>
                    <span
                      style={{
                        color: event.level === 'error' ? '#ff9ba0' : 'var(--sp-color-text-primary)',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {event.message}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>
      )}
    </Modal>
  );
}
