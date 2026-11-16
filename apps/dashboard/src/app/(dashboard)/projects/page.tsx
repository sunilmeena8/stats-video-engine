'use client';

import { Clapperboard, Copy, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useProjectActions } from '@/components/projects/actions';
import {
  Button,
  ButtonLink,
  EmptyState,
  PageHeader,
  Panel,
  QueryState,
  Segmented,
  StatusPill,
  Tag,
  table,
} from '@/components/ui';
import { useDatasets, useProjects, useTopics } from '@/lib/api/queries';
import { formatRelative } from '@/lib/format';
import { PROJECT_STATUS } from '@/lib/status';

type Filter = 'all' | 'draft' | 'rendering' | 'rendered' | 'failed';

export default function ProjectsPage() {
  const projects = useProjects();
  const datasets = useDatasets();
  const topics = useTopics();
  const actions = useProjectActions();
  const [filter, setFilter] = useState<Filter>('all');
  const datasetTitle = new Map(datasets.data?.map((dataset) => [dataset.id, dataset.title]));
  const topicName = new Map(topics.data?.map((topic) => [topic.id, topic.name]));

  return (
    <>
      <PageHeader
        title="Video Projects"
        description="Each project pins one dataset version and one template, and holds the video configuration."
        actions={
          <ButtonLink href="/projects/new" variant="primary" icon={Plus}>
            New project
          </ButtonLink>
        }
      />
      <Panel flush>
        <div style={{ padding: '0 18px 12px' }}>
          <Segmented
            label="Filter projects"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'draft', label: 'Drafts' },
              { value: 'rendering', label: 'Rendering' },
              { value: 'rendered', label: 'Rendered' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </div>
        <QueryState
          query={projects}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState
              icon={Clapperboard}
              title="No video projects yet"
              action={
                <ButtonLink href="/projects/new" variant="primary" size="sm" icon={Plus}>
                  Create a project
                </ButtonLink>
              }
            >
              Start from a dataset version, choose the range and style, then preview and render.
            </EmptyState>
          }
        >
          {(data) => {
            const rows = data.filter((project) => filter === 'all' || project.status === filter);
            if (!rows.length)
              return <EmptyState icon={Clapperboard} title="No projects with this status" />;
            return (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Dataset</th>
                      <th>Outputs</th>
                      <th>Status</th>
                      <th className={table.num}>Updated</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((project) => (
                      <tr key={project.id}>
                        <td>
                          <Link href={`/projects/${project.id}`} className={table.link}>
                            {project.name}
                          </Link>
                          <div className={table.muted} style={{ fontSize: 12 }}>
                            {project.configuration.title}
                            {project.topicId ? ` · ${topicName.get(project.topicId) ?? ''}` : ''}
                          </div>
                        </td>
                        <td className={table.muted}>
                          {datasetTitle.get(project.datasetId) ?? '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {project.configuration.outputMode !== 'short' ? <Tag>16:9</Tag> : null}
                            {project.configuration.outputMode !== 'long' ? <Tag>9:16</Tag> : null}
                          </div>
                        </td>
                        <td>
                          <StatusPill
                            {...PROJECT_STATUS[project.status]}
                            live={project.status === 'rendering'}
                          />
                        </td>
                        <td className={`${table.num} ${table.muted}`}>
                          {formatRelative(project.updatedAt)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <ButtonLink
                              href={`/studio/${project.id}`}
                              size="sm"
                              variant="ghost"
                              icon={SlidersHorizontal}
                            >
                              Studio
                            </ButtonLink>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Copy}
                              loading={
                                actions.duplicate.isPending &&
                                actions.duplicate.variables?.id === project.id
                              }
                              onClick={() => actions.duplicate.mutate(project)}
                            >
                              Duplicate
                            </Button>
                            {project.status === 'draft' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={Trash2}
                                onClick={() => actions.requestDelete(project)}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }}
        </QueryState>
      </Panel>
      {actions.confirmDelete}
    </>
  );
}
