'use client';

import type { RenderJob } from '@statsopedia/shared-types';

import { ProgressBar, StatusPill } from '@/components/ui';
import { JOB_STATUS, isActive } from '@/lib/status';

/** Status pill, current stage and progress of one job. */
export function JobProgress({ job, compact = false }: { job: RenderJob; compact?: boolean }) {
  const status = JOB_STATUS[job.status];
  const active = isActive(job);
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: compact ? 140 : 200 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}
      >
        <StatusPill
          tone={status.tone}
          label={status.label}
          live={active && job.status !== 'pending'}
        />
        {active ? (
          <span
            style={{
              fontSize: 12,
              color: 'var(--sp-color-text-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.round(job.percent)}%
          </span>
        ) : null}
      </div>
      {active ? (
        <ProgressBar
          value={job.percent}
          active={job.status !== 'pending'}
          label={`${status.label} ${Math.round(job.percent)}%`}
        />
      ) : null}
      {!compact && (active || job.status === 'failed') ? (
        <span
          style={{
            fontSize: 12,
            color: job.status === 'failed' ? '#ff9ba0' : 'var(--sp-color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 360,
          }}
          title={job.errorMessage ?? job.message ?? status.stage}
        >
          {job.status === 'failed'
            ? `${job.errorCode ?? 'Error'}: ${job.errorMessage ?? 'Render failed'}`
            : (job.message ?? status.stage)}
        </span>
      ) : null}
    </div>
  );
}
