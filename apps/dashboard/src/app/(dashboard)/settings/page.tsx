'use client';

import { healthResponseSchema } from '@statsopedia/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import { LogOut, RotateCw, Server } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import {
  Button,
  DefinitionList,
  Grid,
  PageHeader,
  Panel,
  QueryState,
  StatusPill,
  table,
} from '@/components/ui';
import { local } from '@/lib/api/client';
import { useMe } from '@/lib/api/queries';
import { formatTimestamp } from '@/lib/format';
import { useLive } from '@/lib/live';
import { signOut } from '@/lib/session-client';

const probeSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('reachable'), httpStatus: z.number(), health: healthResponseSchema }),
  z.object({ state: z.literal('invalid-response'), httpStatus: z.number(), error: z.string() }),
  z.object({ state: z.literal('unreachable'), error: z.string() }),
]);
const systemSchema = z.object({
  services: z.array(z.object({ name: z.string(), probe: probeSchema })),
});

const ROLE_TEXT = {
  viewer: 'Can view everything, but not change or render.',
  editor: 'Can manage datasets, media and projects, and start or cancel renders.',
  admin: 'Full access.',
};

export default function SettingsPage() {
  const me = useMe();
  const { connected } = useLive();
  const [signingOut, setSigningOut] = useState(false);
  const system = useQuery({
    queryKey: ['system'],
    queryFn: () => local('/api/system', systemSchema),
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your account and the health of the Statsopedia services."
      />
      <Grid columns="repeat(auto-fit, minmax(min(100%, 380px), 1fr))">
        <Panel title="Account">
          <QueryState query={me}>
            {(user) => (
              <div style={{ display: 'grid', gap: 16 }}>
                <DefinitionList
                  items={[
                    ['Name', user.name],
                    ['Email', user.email],
                    [
                      'Role',
                      <span key="r">
                        {user.role} <span className={table.muted}>— {ROLE_TEXT[user.role]}</span>
                      </span>,
                    ],
                    ['Member since', formatTimestamp(user.createdAt)],
                  ]}
                />
                <div>
                  <Button
                    icon={LogOut}
                    loading={signingOut}
                    onClick={() => {
                      setSigningOut(true);
                      void signOut();
                    }}
                  >
                    Sign out
                  </Button>
                </div>
                <p className={table.muted} style={{ margin: 0, fontSize: 12.5 }}>
                  Accounts and passwords are managed by an administrator with the API seed script.
                </p>
              </div>
            )}
          </QueryState>
        </Panel>
        <Panel
          title="Services"
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={RotateCw}
              loading={system.isFetching}
              onClick={() => void system.refetch()}
            >
              Check
            </Button>
          }
        >
          <QueryState query={system}>
            {(data) => (
              <div style={{ display: 'grid', gap: 12 }}>
                {data.services.map(({ name, probe }) => {
                  const ok = probe.state === 'reachable' && probe.health.status === 'ok';
                  return (
                    <div key={name} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <Server
                        size={16}
                        color="var(--sp-color-accent-strong)"
                        aria-hidden
                        style={{ marginTop: 3 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <strong style={{ fontWeight: 600 }}>{name}</strong>
                          <StatusPill
                            tone={
                              ok ? 'good' : probe.state === 'reachable' ? 'warning' : 'critical'
                            }
                            label={
                              ok
                                ? 'Healthy'
                                : probe.state === 'reachable'
                                  ? 'Degraded'
                                  : 'Unreachable'
                            }
                          />
                        </div>
                        <div className={table.muted} style={{ fontSize: 12.5 }}>
                          {probe.state === 'reachable'
                            ? Object.entries(probe.health.checks)
                                .map(
                                  ([check, result]) =>
                                    `${check}: ${result.status}${result.error ? ` (${result.error})` : ''}`,
                                )
                                .join(' · ') || `Version ${probe.health.version}`
                            : probe.error}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Server size={16} color="var(--sp-color-accent-strong)" aria-hidden />
                  <strong style={{ fontWeight: 600, flex: 1 }}>Live render updates</strong>
                  <StatusPill
                    tone={connected ? 'good' : 'warning'}
                    label={connected ? 'Connected' : 'Connecting'}
                  />
                </div>
                <p className={table.muted} style={{ margin: 0, fontSize: 12.5 }}>
                  Render workers have no health endpoint; their activity shows in the render queue.
                </p>
              </div>
            )}
          </QueryState>
        </Panel>
        <Panel title="About">
          <DefinitionList
            items={[
              ['Product', 'Statsopedia'],
              ['Tagline', 'The World, By The Numbers'],
              ['Video engine', 'Remotion (bar chart race)'],
            ]}
          />
        </Panel>
      </Grid>
    </>
  );
}
