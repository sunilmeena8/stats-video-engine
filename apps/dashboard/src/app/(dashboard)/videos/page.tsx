'use client';

import type { RenderKind } from '@statsopedia/shared-types';
import { Database, Film, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import {
  EmptyState,
  Input,
  PageHeader,
  Panel,
  QueryState,
  Segmented,
  SkeletonRows,
  table,
} from '@/components/ui';
import { VideoCard, VideoGrid } from '@/components/videos/VideoCard';
import { useOutputs } from '@/lib/api/queries';

export default function VideosPage() {
  const [kind, setKind] = useState<RenderKind | 'all'>('final');
  const [format, setFormat] = useState<'all' | 'long' | 'short'>('all');
  const [search, setSearch] = useState('');
  const outputs = useOutputs(kind === 'all' ? undefined : kind);

  return (
    <>
      <PageHeader
        title="Generated Videos"
        description="Every finished render, with the dataset version it was made from."
      />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <Segmented
          label="Render kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'final', label: 'Final' },
            { value: 'preview', label: 'Previews' },
            { value: 'all', label: 'All' },
          ]}
        />
        <Segmented
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'all', label: 'All formats' },
            { value: 'long', label: 'Long-form' },
            { value: 'short', label: 'Shorts' },
          ]}
        />
        <div style={{ position: 'relative', flex: '0 1 300px', marginLeft: 'auto' }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 11, top: 11, color: 'var(--sp-color-text-muted)' }}
            aria-hidden
          />
          <Input
            placeholder="Search titles and projects"
            aria-label="Search videos"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ paddingLeft: 34 }}
          />
        </div>
      </div>
      <QueryState
        query={outputs}
        loading={<SkeletonRows rows={6} height={28} />}
        isEmpty={(data) => data.length === 0}
        empty={
          <Panel>
            <EmptyState icon={Film} title="No videos yet">
              Final renders appear here when they finish. Start one from a video project.
            </EmptyState>
          </Panel>
        }
      >
        {(data) => {
          const term = search.trim().toLowerCase();
          const rows = data.filter(
            (output) =>
              (format === 'all' || output.format === format) &&
              (!term ||
                `${output.title} ${output.projectName} ${output.datasetTitle}`
                  .toLowerCase()
                  .includes(term)),
          );
          if (!rows.length) {
            return (
              <Panel>
                <EmptyState icon={Search} title="No matching videos" />
              </Panel>
            );
          }
          return (
            <VideoGrid>
              {rows.map((output) => (
                <VideoCard
                  key={output.id}
                  output={output}
                  title={output.title}
                  meta={
                    <>
                      <Link
                        href={`/projects/${output.projectId}`}
                        className={table.link}
                        style={{ fontWeight: 500 }}
                      >
                        {output.projectName}
                      </Link>
                      <Link
                        href={`/datasets/${output.datasetId}?version=${output.datasetVersionId}`}
                        style={{
                          color: 'var(--sp-color-text-muted)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          gap: 5,
                          alignItems: 'center',
                        }}
                      >
                        <Database size={12} aria-hidden /> {output.datasetTitle} · v
                        {output.datasetVersion}
                      </Link>
                    </>
                  }
                />
              ))}
            </VideoGrid>
          );
        }}
      </QueryState>
    </>
  );
}
