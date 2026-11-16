'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Hash, Plus } from 'lucide-react';
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
  Textarea,
  table,
  useToast,
} from '@/components/ui';
import { endpoints } from '@/lib/api/endpoints';
import { keys, useDatasets, useProjects, useTopics } from '@/lib/api/queries';
import { formatDate } from '@/lib/format';

export default function TopicsPage() {
  const topics = useTopics();
  const datasets = useDatasets();
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  const count = (list: { topicId: string | null }[] | undefined, id: string) =>
    list?.filter((item) => item.topicId === id).length ?? 0;

  return (
    <>
      <PageHeader
        title="Topics"
        description="Group datasets and video projects by subject, such as economy or population."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New topic
          </Button>
        }
      />
      <Panel flush>
        <QueryState
          query={topics}
          isEmpty={(data) => data.length === 0}
          empty={
            <EmptyState
              icon={Hash}
              title="No topics yet"
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  Create a topic
                </Button>
              }
            />
          }
        >
          {(data) => (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>Slug</th>
                    <th className={table.num}>Datasets</th>
                    <th className={table.num}>Projects</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((topic) => (
                    <tr key={topic.id}>
                      <td>
                        <span className={table.strong}>{topic.name}</span>
                        {topic.description ? (
                          <div className={table.muted} style={{ fontSize: 12 }}>
                            {topic.description}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code>{topic.slug}</code>
                      </td>
                      <td className={table.num}>{count(datasets.data, topic.id)}</td>
                      <td className={table.num}>{count(projects.data, topic.id)}</td>
                      <td className={table.muted}>{formatDate(topic.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Panel>
      <CreateTopic open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateTopic({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => endpoints.createTopic({ name, description: description || null }),
    onSuccess: (topic) => {
      void client.invalidateQueries({ queryKey: keys.topics });
      toast({ tone: 'good', title: `Topic “${topic.name}” created` });
      setName('');
      setDescription('');
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New topic"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" form="create-topic" type="submit" loading={create.isPending}>
            Create topic
          </Button>
        </>
      }
    >
      <form
        id="create-topic"
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />
        <Field label="Name">
          {(id) => (
            <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Description" hint="Optional">
          {(id) => (
            <Textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
