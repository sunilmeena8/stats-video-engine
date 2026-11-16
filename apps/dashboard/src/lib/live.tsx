'use client';

import { renderJobSchema } from '@statsopedia/shared-schemas';
import { isTerminalRenderStatus, type RenderJob } from '@statsopedia/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { backendUrl } from './api/client';
import { keys } from './api/queries';

/**
 * Subscribes to a Server-Sent Event stream while `url` is set. EventSource reconnects by itself
 * and sends Last-Event-ID, so streams resume where they stopped.
 */
export function useEventStream(
  url: string | null,
  listeners: Record<string, (data: unknown, event: MessageEvent<string>) => void>,
  onOpen?: () => void,
): void {
  const latest = useRef({ listeners, onOpen });
  useEffect(() => {
    latest.current = { listeners, onOpen };
  });
  const names = Object.keys(listeners).sort().join(',');

  useEffect(() => {
    if (!url) return;
    const source = new EventSource(url);
    source.onopen = () => latest.current.onOpen?.();
    const subscriptions = names
      .split(',')
      .filter(Boolean)
      .map((name) => {
        const handler = (event: MessageEvent<string>) => {
          try {
            latest.current.listeners[name]?.(JSON.parse(event.data), event);
          } catch {
            // A malformed event is ignored; the next state event corrects the view.
          }
        };
        source.addEventListener(name, handler);
        return () => source.removeEventListener(name, handler);
      });
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      source.close();
    };
  }, [url, names]);
}

export interface Notification {
  id: string;
  tone: 'good' | 'critical' | 'warning';
  title: string;
  detail: string;
  href: string;
  at: string;
  read: boolean;
}

interface LiveContext {
  notifications: Notification[];
  unread: number;
  markAllRead: () => void;
  /** True while the queue stream is connected. */
  connected: boolean;
}

const Live = createContext<LiveContext>({
  notifications: [],
  unread: 0,
  markAllRead: () => undefined,
  connected: false,
});

export const useLive = () => useContext(Live);

const FORMAT = { long: 'Long-form', short: 'Shorts' } as const;

/**
 * One stream for the whole dashboard: every job change from `GET /api/jobs/events` updates the
 * cached queue and job details in place, refreshes what a finished job affects, and raises a
 * notification. Pages never poll for render progress.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connected, setConnected] = useState(false);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onJob = useCallback(
    (data: unknown) => {
      const parsed = renderJobSchema.safeParse(data);
      if (!parsed.success) return;
      const job = parsed.data;
      let previous: RenderJob | undefined;
      client.setQueryData<RenderJob[]>(keys.jobs, (jobs) => {
        if (!jobs) return jobs;
        previous = jobs.find((item) => item.id === job.id);
        return previous ? jobs.map((item) => (item.id === job.id ? job : item)) : [job, ...jobs];
      });
      client.setQueryData(keys.job(job.id), (detail: { job: RenderJob } | undefined) =>
        detail ? { ...detail, job } : detail,
      );
      void client.invalidateQueries({ queryKey: keys.project(job.projectId) });
      clearTimeout(statsTimer.current);
      statsTimer.current = setTimeout(() => {
        void client.invalidateQueries({ queryKey: keys.stats });
      }, 2_000);

      const finishedNow =
        isTerminalRenderStatus(job.status) && (!previous || previous.status !== job.status);
      if (!finishedNow) return;
      void client.invalidateQueries({ queryKey: ['outputs'] });
      void client.invalidateQueries({ queryKey: keys.projects });
      const kind = job.kind === 'final' ? 'Final' : 'Preview';
      const tone: Notification['tone'] =
        job.status === 'completed' ? 'good' : job.status === 'failed' ? 'critical' : 'warning';
      const title =
        job.status === 'completed'
          ? `${kind} ${FORMAT[job.outputFormat]} render completed`
          : job.status === 'failed'
            ? `${kind} ${FORMAT[job.outputFormat]} render failed`
            : `${kind} ${FORMAT[job.outputFormat]} render cancelled`;
      setNotifications((items) =>
        [
          {
            id: `${job.id}:${job.status}`,
            tone,
            title,
            detail: job.errorMessage ?? `Version ${job.renderVersion}`,
            href: job.status === 'completed' ? '/videos' : `/renders?job=${job.id}`,
            at: job.updatedAt,
            read: false,
          },
          ...items.filter((item) => item.id !== `${job.id}:${job.status}`),
        ].slice(0, 30),
      );
    },
    [client],
  );

  useEventStream(backendUrl('/jobs/events'), { job: onJob }, () => {
    setConnected(true);
    // (Re)connected: changes may have been missed, so reload the queue once.
    void client.invalidateQueries({ queryKey: keys.jobs });
  });

  useEffect(() => {
    const offline = () => setConnected(false);
    window.addEventListener('offline', offline);
    return () => window.removeEventListener('offline', offline);
  }, []);

  const value = useMemo<LiveContext>(
    () => ({
      notifications,
      unread: notifications.filter((item) => !item.read).length,
      markAllRead: () =>
        setNotifications((items) => items.map((item) => ({ ...item, read: true }))),
      connected,
    }),
    [notifications, connected],
  );
  return <Live.Provider value={value}>{children}</Live.Provider>;
}
