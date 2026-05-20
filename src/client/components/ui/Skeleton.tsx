// src/client/components/ui/Skeleton.tsx

export interface SkeletonProps {
  /** Height CSS value. Default: '1rem' */
  height?: string;
  /** Width CSS value. Default: '100%' */
  width?: string;
  className?: string;
}

export function Skeleton({ height = '1rem', width = '100%', className = '' }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{ height, width }}
      className={['animate-pulse rounded-[var(--r-2)] bg-[var(--n-4)]', className].join(' ')}
    />
  );
}

/** Stack of skeleton rows — convenience for list loading states. */
export function SkeletonList({
  rows = 3,
  rowHeight = '2.5rem',
}: {
  rows?: number;
  rowHeight?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={rowHeight} />
      ))}
    </div>
  );
}
