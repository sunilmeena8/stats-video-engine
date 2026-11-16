'use client';

import type { OutputFormat, RenderKind, VideoProject } from '@statsopedia/shared-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { ConfirmDialog, useToast } from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';
import { keys } from '@/lib/api/queries';
import { newIdempotencyKey } from '@/lib/format';

/** Duplicate, delete (drafts, with confirmation) and render actions for one project. */
export function useProjectActions() {
  const client = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [deleting, setDeleting] = useState<VideoProject | null>(null);
  // One key per render action, so a double click or network retry never renders twice.
  const renderKey = useRef<string>(newIdempotencyKey());

  const duplicate = useMutation({
    mutationFn: (project: VideoProject) => endpoints.duplicateProject(project.id),
    onSuccess: (copy) => {
      void client.invalidateQueries({ queryKey: keys.projects });
      toast({ tone: 'good', title: 'Project duplicated', detail: copy.name });
      router.push(`/projects/${copy.id}`);
    },
    onError: (error) =>
      toast({ tone: 'critical', title: 'Could not duplicate', detail: error.message }),
  });

  const remove = useMutation({
    mutationFn: (project: VideoProject) => endpoints.deleteProject(project.id),
    onSuccess: (_, project) => {
      void client.invalidateQueries({ queryKey: keys.projects });
      void client.invalidateQueries({ queryKey: keys.stats });
      toast({ tone: 'good', title: 'Draft deleted', detail: project.name });
      setDeleting(null);
      router.push('/projects');
    },
  });

  const render = useMutation({
    mutationFn: ({
      project,
      kind,
      formats,
    }: {
      project: VideoProject;
      kind: RenderKind;
      formats?: OutputFormat[];
    }) => endpoints.submitRender(project.id, kind, formats, renderKey.current),
    onSuccess: (result, { project }) => {
      renderKey.current = newIdempotencyKey();
      void client.invalidateQueries({ queryKey: keys.jobs });
      void client.invalidateQueries({ queryKey: keys.project(project.id) });
      toast({
        tone: 'good',
        title: result.replayed
          ? 'This render is already in the queue'
          : `${result.request.kind === 'final' ? 'Final render' : 'Preview'} queued (v${result.request.renderVersion})`,
        detail: 'Follow its progress in the render queue.',
      });
    },
    onError: (error) => {
      renderKey.current = newIdempotencyKey();
      toast({ tone: 'critical', title: 'Render not started', detail: error.message });
    },
  });

  const confirmDelete = (
    <ConfirmDialog
      open={deleting !== null}
      title="Delete this draft?"
      confirmLabel="Delete draft"
      danger
      busy={remove.isPending}
      error={remove.error}
      onCancel={() => {
        setDeleting(null);
        remove.reset();
      }}
      onConfirm={() => deleting && remove.mutate(deleting)}
    >
      <p style={{ margin: 0 }}>
        <strong style={{ color: 'var(--sp-color-text-primary)' }}>{deleting?.name}</strong> and its
        preview videos will be deleted permanently. Datasets and media are not affected.
      </p>
    </ConfirmDialog>
  );

  return { duplicate, remove, render, requestDelete: setDeleting, confirmDelete };
}
