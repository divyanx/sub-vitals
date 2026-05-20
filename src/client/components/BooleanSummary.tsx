/**
 * BooleanSummary — two large stat blocks (Yes / No) for boolean pipelines
 * (impostor detection, PII, etc.).
 */

import type { TagDistributionEntry } from '../lib/api.ts';

interface BooleanSummaryProps {
  distribution: TagDistributionEntry[];
}

export function BooleanSummary({ distribution }: BooleanSummaryProps) {
  if (distribution.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">No data yet — posts will appear here.</p>
    );
  }

  // Find yes/true and no/false entries (case-insensitive)
  const find = (keys: string[]) =>
    distribution.find((e) => keys.includes(e.value.toLowerCase()))?.count ?? 0;

  const yes = find(['yes', 'true', '1']);
  const no = find(['no', 'false', '0']);
  // Fall back to first two entries if canonical names not found
  const first = distribution[0];
  const second = distribution[1];
  const yesVal = yes === 0 && no === 0 ? (first?.count ?? 0) : yes;
  const noVal = yes === 0 && no === 0 ? (second?.count ?? 0) : no;
  const yesLabel = yes === 0 && no === 0 ? (first?.value ?? 'Yes') : 'Yes';
  const noLabel = yes === 0 && no === 0 ? (second?.value ?? 'No') : 'No';

  return (
    <div className="flex gap-3">
      <div className="flex flex-1 flex-col items-center rounded-lg border border-rose-500/20 bg-rose-500/10 p-3">
        <span className="text-2xl font-bold tabular-nums text-rose-400">{yesVal}</span>
        <span className="mt-0.5 text-[10px] text-[var(--text-muted)]">{yesLabel}</span>
      </div>
      <div className="flex flex-1 flex-col items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className="text-2xl font-bold tabular-nums text-[var(--text)]">{noVal}</span>
        <span className="mt-0.5 text-[10px] text-[var(--text-muted)]">{noLabel}</span>
      </div>
    </div>
  );
}
