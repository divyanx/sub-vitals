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
      className="group flex min-h-[200px] w-full cursor-pointer flex-col gap-3 rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-4 text-left shadow-[var(--shadow-1)] transition hover:border-[var(--accent-9)] hover:shadow-[var(--shadow-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
    >
      {/* Card header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[length:var(--t-sm)] font-semibold text-[var(--n-12)] group-hover:text-[var(--accent-11)]">
            {instance.name}
          </h3>
          {instance.description && (
            <p className="mt-0.5 truncate text-[length:var(--t-xs)] text-[var(--n-8)]">
              {instance.description}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-[var(--n-1)] px-2 py-0.5 text-[length:var(--t-xs)] uppercase tracking-wider text-[var(--n-8)]">
          {kind}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1">
        {distQ.isPending && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-3 animate-pulse rounded-[var(--r-1)] bg-[var(--n-4)]" />
            ))}
          </div>
        )}
        {distQ.isError && (
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
            Could not load distribution.
          </p>
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
      <p className="text-[length:var(--t-xs)] text-[var(--accent-11)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        View in Pipelines &rarr;
      </p>
    </button>
  );
}
