'use client';

import { Suspense } from 'react';

import { RenderQueue } from './RenderQueue';

export default function RenderQueuePage() {
  return (
    <Suspense>
      <RenderQueue />
    </Suspense>
  );
}
