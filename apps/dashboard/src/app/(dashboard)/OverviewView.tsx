'use client';

import type { DashboardStats } from '@statsopedia/shared-types';
import {
  CheckCircle2,
  Clapperboard,
  Database,
  HardDrive,
  Hourglass,
  ListVideo,
  Plus,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

import { JobProgress } from '@/components/renders/JobStatus';
import {
  ButtonLink,
  EmptyState,
  Grid,
  PageHeader,
  Panel,
  QueryState,
  StatTile,
  StatusPill,
  Tag,
  table,
} from '@/components/ui';
import { useJobs, useMe, useProjects, useStats } from '@/lib/api/queries';
import { formatBytes, formatCount, formatRelative } from '@/lib/format';
import { FORMAT_LABEL, KIND_LABEL, PROJECT_STATUS } from '@/lib/status';

const AREA_COLORS: Record<string, string> = {
  renders: '#3d8bff',
  datasets: '#7aa7ff',
  processed: '#4fc3c7',
  assets: '#b48cff',
  thumbnails: '#f5b324',
  logs: '#8d99b6',
  temp: '#f0525a',
};

export function OverviewView() {
  const me = useMe();
  const stats = useStats();
  const s = stats.data;
  const loading = stats.isPending;
  return (
    <>
      <PageHeader
        title={me.data ? `Welcome back, ${me.data.name.split(' ')[0] || me.data.name}` : 'Overview'}
        description="Your datasets, projects and renders at a glance."
        actions={
          <>
            <ButtonLink href="/datasets" icon={Database}>
              Datasets
            </ButtonLink>
            <ButtonLink href="/projects/new" variant="primary" icon={Plus}>
              New video project
            </ButtonLink>
          </>
        }
      />
      {stats.error ? (
        <Panel>
          <QueryState query={stats}>{() => null}</QueryState>
        </Panel>
      ) : (
        <Grid columns="repeat(auto-fit, minmax(180px, 1fr))">
          <StatTile
            label="Datasets"
            icon={Database}
            value={formatCount(s?.datasets)}
            loading={loading}
          />
          <StatTile
            label="Video projects"
            icon={Clapperboard}
            value={formatCount(s?.projects)}
            loading={loading}
          />
          <StatTile
            label="Completed renders"
            icon={CheckCircle2}
            tone="good"
            value={formatCount(s?.renders.completed)}
            hint={s ? `${formatCount(s.outputs)} videos stored` : undefined}
            loading={loading}
          />
          <StatTile
            label="Pending jobs"
            icon={Hourglass}
            tone="info"
            value={formatCount(s?.renders.pending)}
            hint="Queued or rendering"
            loading={loading}
          />
          <StatTile
            label="Failed jobs"
            icon={XCircle}
            tone={s?.renders.failed ? 'critical' : 'neutral'}
            value={formatCount(s?.renders.failed)}
            hint={s ? `${formatCount(s.renders.cancelled)} cancelled` : undefined}
            loading={loading}
          />
        </Grid>
      )}

      <Grid columns="repeat(auto-fit, minmax(min(100%, 420px), 1fr))" style={{ marginTop: 16 }}>
        <RecentProjects />
        <RecentActivity />
      </Grid>
      <div style={{ marginTop: 16 }}>
        <Panel
          title="Storage usage"
          description={s ? `Measured ${formatRelative(s.storage.measuredAt)}` : undefined}
        >
          <QueryState query={stats}>{(data) => <StorageUsage storage={data.storage} />}</QueryState>
        </Panel>
      </div>
    </>
  );
}

function RecentProjects() {
  const projects = useProjects();
  return (
    <Panel
      title="Recent projects"
      actions={
        <Link href="/projects" className={table.link} style={{ fontSize: 12.5 }}>
          View all
        </Link>
      }
      flush
    >
      <QueryState
        query={projects}
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState
            icon={Clapperboard}
            title="No video projects yet"
            action={
              <ButtonLink href="/projects/new" variant="primary" icon={Plus} size="sm">
                Create a project
              </ButtonLink>
            }
          >
            A project turns a dataset version into long-form and Shorts videos.
          </EmptyState>
        }
      >
        {(data) => (
          <div className={table.wrap}>
            <table className={table.table}>
              <tbody>
                {data.slice(0, 6).map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/projects/${project.id}`} className={table.link}>
                        {project.name}
                      </Link>
                      <div className={table.muted} style={{ fontSize: 12 }}>
                        {project.configuration.title}
                      </div>
                    </td>
                    <td>
                      <StatusPill {...PROJECT_STATUS[project.status]} />
                    </td>
                    <td className={`${table.muted} ${table.num}`}>
                      {formatRelative(project.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

function RecentActivity() {
  const jobs = useJobs();
  const projects = useProjects();
  const names = new Map(projects.data?.map((project) => [project.id, project.name]));
  return (
    <Panel
      title="Recent rendering activity"
      description="Updates live as workers report progress"
      actions={
        <Link href="/renders" className={table.link} style={{ fontSize: 12.5 }}>
          Render queue
        </Link>
      }
      flush
    >
      <QueryState
        query={jobs}
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState icon={ListVideo} title="Nothing rendered yet">
            Previews and final renders started from a project appear here.
          </EmptyState>
        }
      >
        {(data) => (
          <div className={table.wrap}>
            <table className={table.table}>
              <tbody>
                {data.slice(0, 7).map((job) => (
                  <tr key={job.id}>
                    <td>
                      <Link href={`/renders?job=${job.id}`} className={table.link}>
                        {names.get(job.projectId) ?? 'Project'}
                      </Link>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <Tag>{KIND_LABEL[job.kind]}</Tag>
                        <Tag>{FORMAT_LABEL[job.outputFormat]}</Tag>
                      </div>
                    </td>
                    <td>
                      <JobProgress job={job} compact />
                    </td>
                    <td className={`${table.muted} ${table.num}`}>
                      {formatRelative(job.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}

function StorageUsage({ storage }: { storage: DashboardStats['storage'] }) {
  const areas = storage.areas.filter((area) => area.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const total = Math.max(storage.usedBytes, 1);
  const volumeShare =
    storage.volumeBytes && storage.freeBytes !== null
      ? (storage.volumeBytes - storage.freeBytes) / storage.volumeBytes
      : null;
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <HardDrive size={18} color="var(--sp-color-accent-strong)" aria-hidden />
        <span style={{ fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em' }}>
          {formatBytes(storage.usedBytes)}
        </span>
        <span style={{ color: 'var(--sp-color-text-secondary)' }}>
          used by Statsopedia
          {storage.freeBytes !== null
            ? ` · ${formatBytes(storage.freeBytes)} free on the volume`
            : ''}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          height: 12,
          borderRadius: 999,
          overflow: 'hidden',
          gap: 2,
          background: 'rgba(148,170,255,0.08)',
        }}
        role="img"
        aria-label={areas.map((area) => `${area.area} ${formatBytes(area.bytes)}`).join(', ')}
      >
        {areas.map((area) => (
          <div
            key={area.area}
            style={{
              width: `${(area.bytes / total) * 100}%`,
              minWidth: 3,
              background: AREA_COLORS[area.area] ?? '#8d99b6',
            }}
            title={`${area.area}: ${formatBytes(area.bytes)}`}
          />
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
          gap: 12,
        }}
      >
        {storage.areas.map((area) => (
          <div key={area.area} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                marginTop: 5,
                background: AREA_COLORS[area.area] ?? '#8d99b6',
              }}
              aria-hidden
            />
            <div>
              <div style={{ fontWeight: 550, textTransform: 'capitalize' }}>{area.area}</div>
              <div style={{ fontSize: 12, color: 'var(--sp-color-text-muted)' }}>
                {formatBytes(area.bytes)} · {formatCount(area.files)} files
              </div>
            </div>
          </div>
        ))}
      </div>
      {volumeShare !== null ? (
        <div style={{ fontSize: 12, color: 'var(--sp-color-text-muted)' }}>
          The storage volume is {Math.round(volumeShare * 100)}% full (
          {formatBytes(storage.volumeBytes!)} total).
        </div>
      ) : null}
    </div>
  );
}
