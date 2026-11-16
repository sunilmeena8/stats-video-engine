'use client';

import { Suspense } from 'react';

import { DatasetView } from './DatasetView';

export default function DatasetPage() {
  return (
    <Suspense>
      <DatasetView />
    </Suspense>
  );
}
