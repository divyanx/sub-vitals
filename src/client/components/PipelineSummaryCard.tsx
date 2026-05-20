/**
 * PipelineSummaryCard — dispatches to kind-specific summary renderers.
 * Each card is ~300px wide, ~200px tall, and clickable → navigates to
 * the relevant pipeline instance in the Pipelines tab.
 */

import { useQuery } from '@tanstack/react-query';
import { api, type PipelineInstance } from '../lib/api.ts';
import { BooleanSummary } from './BooleanSummary.tsx';
import { CategoricalSummary } from './CategoricalSummary.tsx';
import { ClusterSummary } from './ClusterSummary.tsx';
import { OrdinalSummary } from './OrdinalSummary.tsx';
import { ScalarSummary } from './ScalarSummary.tsx';

interface PipelineSummaryCardProps {
  instance: PipelineInstance;
  /** Navigate to this instance in the Pipelines tab */
  onOpen: (instanceId: string) => void;
}

/** Resolve the PipelineKind from outputSchema since instances carry outputSchema not kind */
function kindFromSchema(
  outputSchema: string,
): 'categorical' | 'ordinal' | 'cluster' | 'scalar' | 'boolean' {
  switch (outputSchema) {
    case 'boolean':
      return 'boolean';
    case 'scalar':
      return 'scalar';
    case 'cluster':
      return 'cluster';
    default:
      return 'categorical';
  }
}

export function PipelineSummaryCard({ instance, onOpen }: PipelineSummaryCardProps) {
  const labels = instance.config.labels ?? [];

  const distQ = useQuery({
    queryKey: ['tag-distribution', instance.id, 7],
    queryFn: () => api.tags.distribution(instance.id, labels, 7),
    staleTime: 60_000,
    enabled: instance.enabled,
  });

  const distribution = distQ.data?.distribution ?? [];
  const kind = kindFromSchema(instance.config.outputSchema);

  return (
    <button
      type="button"
      onClick={() => onOpen(instance.id)}
      aria-label={`Open ${instance.name} pipeline — ${distribution.length} categories. Click to see full details.`}
      className="group flex min-h-[200px] w-full cursor-pointer flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm transition hover:border-orange-500/60 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--text)] group-hover:text-orange-300">
            {instance.name}
          </h3>
          {instance.description && (
            <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
              {instance.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-[var(--bg)] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
          {kind}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1">
        {distQ.isPending && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded bg-[var(--border)]" />
            ))}
          </div>
        )}
        {distQ.isError && (
          <p className="text-xs text-[var(--text-muted)]">Could not load distribution.</p>
        )}
        {!distQ.isPending && !distQ.isError && (
          <>
            {kind === 'categorical' && <CategoricalSummary distribution={distribution} />}
            {kind === 'ordinal' && <OrdinalSummary distribution={distribution} />}
            {kind === 'cluster' && <ClusterSummary distribution={distribution} />}
            {kind === 'scalar' && <ScalarSummary distribution={distribution} />}
            {kind === 'boolean' && <BooleanSummary distribution={distribution} />}
          </>
        )}
      </div>

      {/* Footer */}
      <p className="text-[10px] text-orange-400 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        View in Pipelines &rarr;
      </p>
    </button>
  );
}
