'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  PageHeader,
  Panel,
  QueryState,
  Select,
  StatusPill,
  Textarea,
  table,
} from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';
import { keys, useDatasets, useTopics } from '@/lib/api/queries';
import { VALIDATION_STATUS, VERSION_STATUS, formatCount, formatRelative } from '@/lib/format';

export default function DatasetsPage() {
  const datasets = useDatasets();
  const topics = useTopics();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [topicId, setTopicId] = useState('');
  const topicName = new Map(topics.data?.map((topic) => [topic.id, topic.name]));

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Versioned CSV datasets. Every upload is validated and kept as an immutable version."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New dataset
          </Button>
        }
      />
      <Panel flush>
        <div style={{ display: 'flex', gap: 10, padding: '0 18px 12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 360 }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 11,
                top: 11,
                color: 'var(--sp-color-text-muted)',
              }}
              aria-hidden
            />
            <Input
              placeholder="Search datasets"
              aria-label="Search datasets"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ paddingLeft: 34 }}
            />
          </div>
          <Select
            aria-label="Filter by topic"
            value={topicId}
            onChange={(event) => setTopicId(event.target.value)}
            style={{ width: 200 }}
          >
            <option value="">All topics</option>
            {topics.data?.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </Select>
        </div>
        <QueryState
          query={datasets}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState
              icon={Database}
              title="No datasets yet"
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  Create a dataset
                </Button>
              }
            >
              Create a dataset, then upload a CSV with <code>entity_id</code>,{' '}
              <code>entity_name</code>, <code>year</code>, <code>value</code>, <code>unit</code> and{' '}
              <code>source_id</code> columns.
            </EmptyState>
          }
        >
          {(data) => {
            const term = search.trim().toLowerCase();
            const rows = data.filter(
              (dataset) =>
                (!topicId || dataset.topicId === topicId) &&
                (!term || `${dataset.title} ${dataset.slug}`.toLowerCase().includes(term)),
            );
            if (rows.length === 0) {
              return (
                <EmptyState icon={Search} title="No matching datasets">
                  Try another search or topic.
                </EmptyState>
              );
            }
            return (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead>
                    <tr>
                      <th>Dataset</th>
                      <th>Topic</th>
                      <th>Latest version</th>
                      <th>Validation</th>
                      <th className={table.num}>Entities</th>
                      <th>Periods</th>
                      <th className={table.num}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((dataset) => {
                      const version = dataset.latestVersion;
                      return (
                        <tr key={dataset.id}>
                          <td>
                            <Link href={`/datasets/${dataset.id}`} className={table.link}>
                              {dataset.title}
                            </Link>
                            <div className={table.muted} style={{ fontSize: 12 }}>
                              {dataset.unit ?? 'Unit set on first import'}
                            </div>
                          </td>
                          <td className={table.muted}>
                            {dataset.topicId ? (topicName.get(dataset.topicId) ?? '—') : '—'}
                          </td>
                          <td>
                            {version ? (
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span className={table.strong}>v{version.version}</span>
                                <StatusPill {...VERSION_STATUS[version.status]} />
                              </div>
                            ) : (
                              <span className={table.muted}>No valid version</span>
                            )}
                            <div className={table.muted} style={{ fontSize: 12 }}>
                              {dataset.versionCount} version{dataset.versionCount === 1 ? '' : 's'}
                            </div>
                          </td>
                          <td>
                            {version ? (
                              <StatusPill {...VALIDATION_STATUS[version.validationStatus]} />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className={table.num}>{formatCount(version?.entityCount)}</td>
                          <td className={table.muted}>
                            {version?.periodRange
                              ? `${version.periodRange.start}–${version.periodRange.end}`
                              : '—'}
                          </td>
                          <td className={`${table.num} ${table.muted}`}>
                            {formatRelative(dataset.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        </QueryState>
      </Panel>
      <CreateDataset open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateDataset({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const router = useRouter();
  const topics = useTopics();
  const [form, setForm] = useState({ title: '', description: '', topicId: '', unit: '' });
  const create = useMutation({
    mutationFn: () =>
      endpoints.createDataset({
        title: form.title,
        description: form.description || null,
        topicId: form.topicId || null,
        unit: form.unit || null,
      }),
    onSuccess: (dataset) => {
      void client.invalidateQueries({ queryKey: keys.datasets });
      router.push(`/datasets/${dataset.id}?tab=upload`);
    },
  });
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New dataset"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="create-dataset" loading={create.isPending}>
            Create and upload CSV
          </Button>
        </>
      }
    >
      <form
        id="create-dataset"
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />
        <Field label="Title" hint="Shown in the dashboard and used as the default video title.">
          {(id) => <Input id={id} required value={form.title} onChange={set('title')} />}
        </Field>
        <Field label="Topic">
          {(id) => (
            <Select id={id} value={form.topicId} onChange={set('topicId')}>
              <option value="">No topic</option>
              {topics.data?.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unit" hint="Optional, e.g. “USD billions”. Every row's unit must match it.">
          {(id) => <Input id={id} value={form.unit} onChange={set('unit')} />}
        </Field>
        <Field label="Description" hint="Optional">
          {(id) => <Textarea id={id} value={form.description} onChange={set('description')} />}
        </Field>
      </form>
    </Modal>
  );
}
