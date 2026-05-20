/**
 * ClusterSummary — top-3 cluster names + post count each for cluster pipelines (themes).
 */

import type { TagDistributionEntry } from '../lib/api.ts';

interface ClusterSummaryProps {
  distribution: TagDistributionEntry[];
}

export function ClusterSummary({ distribution }: ClusterSummaryProps) {
  if (distribution.length === 0) {
    return <p className="text-xs text-[var(--text-muted)]">No clusters yet — check back soon.</p>;
  }

  const top3 = distribution.slice(0, 3);

  return (
    <ul className="space-y-2" role="list">
      {top3.map((entry, i) => (
        <li key={entry.value} className="flex items-center gap-2 text-xs">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-500/20 text-[10px] font-bold text-orange-400">
            {i + 1}
          </span>
          <span className="flex-1 truncate text-[var(--text)]">{entry.value}</span>
          <span className="tabular-nums text-[var(--text-muted)]">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}
