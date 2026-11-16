'use client';

import { ErrorState, Panel } from '@/components/ui';

/** Unexpected errors inside a page keep the shell (navigation) usable. */
export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <Panel>
      <ErrorState error={error} title="This page hit an unexpected error" onRetry={reset} />
    </Panel>
  );
}
