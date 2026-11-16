import { Skeleton, SkeletonRows } from '@/components/ui';

export default function Loading() {
  return (
    <div style={{ display: 'grid', gap: 20 }} aria-busy="true" aria-label="Loading">
      <Skeleton width={240} height={28} />
      <SkeletonRows rows={6} />
    </div>
  );
}
