/**
 * OrdinalSummary — 3 colored stat blocks for ordinal pipelines
 * (sentiment / urgency). Values keyed by canonical labels: positive/neutral/negative
 * or high/medium/low, etc.
 */

import type { TagDistributionEntry } from '../lib/api.ts';

interface OrdinalSummaryProps {
  distribution: TagDistributionEntry[];
}

const LABEL_COLORS: Record<string, string> = {
  positive: 'text-[var(--success-11)]',
  high: 'text-[var(--success-11)]',
  neutral: 'text-[var(--n-8)]',
  medium: 'text-[var(--warn-11)]',
  negative: 'text-[var(--error-11)]',
  low: 'text-[var(--error-11)]',
};

const LABEL_BG: Record<string, string> = {
  positive: 'bg-[var(--success-3)] border-[var(--success-9)]',
  high: 'bg-[var(--success-3)] border-[var(--success-9)]',
  neutral: 'bg-[var(--n-2)] border-[var(--n-4)]',
  medium: 'bg-[var(--warn-3)] border-[var(--warn-9)]',
  negative: 'bg-[var(--error-3)] border-[var(--error-9)]',
  low: 'bg-[var(--error-3)] border-[var(--error-9)]',
};

export function OrdinalSummary({ distribution }: OrdinalSummaryProps) {
  if (distribution.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">No data yet — posts will appear here.</p>
    );
  }

  const shown = distribution.slice(0, 3);

  return (
    <div className="flex gap-2">
      {shown.map((entry) => {
        const lc = entry.value.toLowerCase();
        const textColor = LABEL_COLORS[lc] ?? 'text-[var(--text)]';
        const bgClass = LABEL_BG[lc] ?? 'bg-[var(--surface)] border-[var(--border)]';
        return (
          <div
            key={entry.value}
            className={`flex flex-1 flex-col items-center rounded-[var(--r-2)] border p-2 ${bgClass}`}
          >
            <span className={`text-[length:var(--t-xl)] font-bold tabular-nums ${textColor}`}>
              {entry.count}
            </span>
            <span className="mt-0.5 text-[length:var(--t-xs)] capitalize text-[var(--n-8)]">
              {entry.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
