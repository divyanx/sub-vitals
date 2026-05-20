/**
 * CategoricalSummary — mini horizontal bar chart for categorical pipelines
 * (intent / root-cause). Shows top-3 labels + counts; "+N more" if longer.
 */

import type { TagDistributionEntry } from '../lib/api.ts';

interface CategoricalSummaryProps {
  distribution: TagDistributionEntry[];
}

export function CategoricalSummary({ distribution }: CategoricalSummaryProps) {
  if (distribution.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">No data yet — posts will appear here.</p>
    );
  }

  const top3 = distribution.slice(0, 3);
  const rest = distribution.length - 3;
  const max = top3[0]?.count ?? 1;

  return (
    <div className="space-y-2">
      {top3.map((entry) => {
        const pct = Math.round((entry.count / max) * 100);
        return (
          <div key={entry.value} className="space-y-0.5">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate pr-2 text-[var(--text)]">{entry.value}</span>
              <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{entry.count}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full rounded-full bg-orange-500 transition-all"
                style={{ width: `${pct}%` }}
                role="presentation"
              />
            </div>
          </div>
        );
      })}
      {rest > 0 && (
        <p className="text-xs text-[var(--text-muted)]">+{rest} more</p>
      )}
    </div>
  );
}
