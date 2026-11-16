'use client';

import { Clapperboard, Monitor, Plus, SlidersHorizontal, Smartphone } from 'lucide-react';
import Link from 'next/link';

import {
  ButtonLink,
  EmptyState,
  PageHeader,
  Panel,
  QueryState,
  StatusPill,
  Tag,
} from '@/components/ui';
import { useProjects } from '@/lib/api/queries';
import { formatRelative } from '@/lib/format';
import { PROJECT_STATUS } from '@/lib/status';

export default function StudioIndexPage() {
  const projects = useProjects();
  return (
    <>
      <PageHeader
        title="Video Studio"
        description="Pick a project to edit its titles, pacing, annotations and music with a live preview."
        actions={
          <ButtonLink href="/projects/new" variant="primary" icon={Plus}>
            New project
          </ButtonLink>
        }
      />
      <QueryState
        query={projects}
        isEmpty={(data) => data.length === 0}
        empty={
          <Panel>
            <EmptyState
              icon={Clapperboard}
              title="No projects to open"
              action={
                <ButtonLink href="/projects/new" variant="primary" size="sm" icon={Plus}>
                  Create a project
                </ButtonLink>
              }
            />
          </Panel>
        }
      >
        {(data) => (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 14,
            }}
          >
            {data.map((project) => (
              <Link
                key={project.id}
                href={`/studio/${project.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Panel style={{ height: '100%' }}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        alignItems: 'center',
                      }}
                    >
                      <SlidersHorizontal
                        size={16}
                        color="var(--sp-color-accent-strong)"
                        aria-hidden
                      />
                      <StatusPill {...PROJECT_STATUS[project.status]} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{project.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--sp-color-text-muted)' }}>
                        {project.configuration.title}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {project.configuration.outputMode !== 'short' ? (
                        <Tag icon={Monitor}>16:9</Tag>
                      ) : null}
                      {project.configuration.outputMode !== 'long' ? (
                        <Tag icon={Smartphone}>9:16</Tag>
                      ) : null}
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 12,
                          color: 'var(--sp-color-text-muted)',
                        }}
                      >
                        {formatRelative(project.updatedAt)}
                      </span>
                    </div>
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </>
  );
}
