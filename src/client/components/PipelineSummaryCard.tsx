/**
 * PipelineSummaryCard — dispatches to kind-specific summary renderers.
 * Each card is ~300px wide, ~200px tall, and clickable → navigates to
 * the relevant pipeline instance in the Pipelines tab.
 *
 * Visual design: each card carries a per-template theme (hue + icon) so
 * mods can identify pipelines at a glance. See `lib/pipelineTheme.ts`.
 * The theme manifests as:
 *   - a soft radial glow in the top-right corner
 *   - a 1.5px left accent stripe
 *   - an emoji icon block at the top-left
 *   - a tinted kind chip
 *   - a hover border in the theme color
 */

import { useQuery } from '@tanstack/react-query';
import { api, type PipelineInstance } from '../lib/api.ts';
import { getPipelineTheme, pipelineThemeVars } from '../lib/pipelineTheme.ts';
import { BooleanSummary } from './BooleanSummary.tsx';
import { CategoricalSummary } from './CategoricalSummary.tsx';
import { ClusterSummary } from './ClusterSummary.tsx';
import { OrdinalSummary } from './OrdinalSummary.tsx';
import { ScalarSummary } from './ScalarSummary.tsx';
import { Tag, toneFromKind } from './ui/index.ts';

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
  const theme = getPipelineTheme(instance.templateId);
  const themeStyle = pipelineThemeVars(theme);

  return (
    <button
      type="button"
      onClick={() => onOpen(instance.id)}
      aria-label={`Open ${instance.name} pipeline — ${distribution.length} categories. Click to see full details.`}
      style={themeStyle}
      className="group relative flex min-h-[200px] w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-4 text-left shadow-[var(--shadow-1)] transition-[transform,border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease)] hover:-translate-y-px hover:border-[color:var(--pt-border-hover)] hover:shadow-[var(--shadow-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pt-border-hover)] active:translate-y-0"
    >
      {/* Decorative theme layers — pointer-events-none so the whole card stays clickable */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[2px]"
        style={{ background: 'var(--pt-edge)' }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full blur-2xl"
        style={{ background: 'var(--pt-glow)' }}
      />

      {/* Card header */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <span
            role="img"
            aria-label={theme.iconLabel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[length:var(--t-lg)]"
            style={{ background: 'var(--pt-icon-bg)' }}
          >
            {theme.icon}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[length:var(--t-sm)] font-semibold text-[var(--n-12)]">
              {instance.name}
            </h3>
            {instance.description && (
              <p className="mt-0.5 truncate text-[length:var(--t-xs)] text-[var(--n-8)]">
                {instance.description}
              </p>
            )}
          </div>
        </div>
        <Tag tone={toneFromKind(kind)} mono className="shrink-0 uppercase tracking-wider">
          {kind}
        </Tag>
      </div>

      {/* Content area */}
      <div className="relative flex-1">
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
      <p
        className="relative text-[length:var(--t-xs)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ color: 'var(--pt-text)' }}
      >
        View in Pipelines &rarr;
      </p>
    </button>
  );
}
