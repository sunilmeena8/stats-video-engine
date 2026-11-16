import {
  isTerminalRenderStatus,
  type RenderJob,
  type RenderJobStatus,
  type RenderRequestStatus,
  type VideoProjectStatus,
} from '@statsopedia/shared-types';

export type Tone = 'good' | 'warning' | 'critical' | 'info' | 'neutral' | 'accent';

/** Queue groups shown on the render queue. */
export type QueueGroup = 'queued' | 'processing' | 'completed' | 'failed';

export const JOB_STATUS: Record<RenderJobStatus, { label: string; tone: Tone; stage: string }> = {
  pending: { label: 'Queued', tone: 'neutral', stage: 'Waiting for a render worker' },
  validating: { label: 'Validating', tone: 'info', stage: 'Checking dataset, manifest and assets' },
  preparing: { label: 'Preparing', tone: 'info', stage: 'Building input and loading the renderer' },
  rendering: { label: 'Rendering', tone: 'accent', stage: 'Rendering frames' },
  post_processing: {
    label: 'Post-processing',
    tone: 'accent',
    stage: 'Checking and finalizing the file',
  },
  completed: { label: 'Completed', tone: 'good', stage: 'Done' },
  failed: { label: 'Failed', tone: 'critical', stage: 'Failed' },
  cancelled: { label: 'Cancelled', tone: 'warning', stage: 'Cancelled' },
};

export const REQUEST_STATUS: Record<RenderRequestStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Queued', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'accent' },
  completed: { label: 'Completed', tone: 'good' },
  partial: { label: 'Partly completed', tone: 'warning' },
  failed: { label: 'Failed', tone: 'critical' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
};

export const PROJECT_STATUS: Record<VideoProjectStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'info' },
  rendering: { label: 'Rendering', tone: 'accent' },
  rendered: { label: 'Rendered', tone: 'good' },
  failed: { label: 'Failed', tone: 'critical' },
  archived: { label: 'Archived', tone: 'neutral' },
};

export function queueGroup(status: RenderJobStatus): QueueGroup {
  if (status === 'pending') return 'queued';
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'processing';
}

export const isActive = (job: Pick<RenderJob, 'status'>) => !isTerminalRenderStatus(job.status);
export const canRetry = (job: Pick<RenderJob, 'status'>) =>
  job.status === 'failed' || job.status === 'cancelled';

export const FORMAT_LABEL = { long: 'Long-form 16:9', short: 'Shorts 9:16' } as const;
export const KIND_LABEL = { preview: 'Preview', final: 'Final' } as const;
