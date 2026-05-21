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
      <div className="flex flex-1 flex-col items-center rounded-[var(--r-2)] border border-[var(--error-9)] bg-[var(--error-3)] p-3">
        <span className="text-[length:var(--t-2xl)] font-bold tabular-nums text-[var(--error-11)]">
          {yesVal}
        </span>
        <span className="mt-0.5 text-[length:var(--t-xs)] text-[var(--n-8)]">{yesLabel}</span>
      </div>
      <div className="flex flex-1 flex-col items-center rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] p-3">
        <span className="text-[length:var(--t-2xl)] font-bold tabular-nums text-[var(--n-11)]">
          {noVal}
        </span>
        <span className="mt-0.5 text-[length:var(--t-xs)] text-[var(--n-8)]">{noLabel}</span>
      </div>
    </div>
  );
}
