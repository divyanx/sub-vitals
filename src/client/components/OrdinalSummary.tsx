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
  positive: 'text-emerald-400',
  high: 'text-emerald-400',
  neutral: 'text-[var(--text-muted)]',
  medium: 'text-amber-400',
  negative: 'text-rose-400',
  low: 'text-rose-400',
};

const LABEL_BG: Record<string, string> = {
  positive: 'bg-emerald-500/10 border-emerald-500/20',
  high: 'bg-emerald-500/10 border-emerald-500/20',
  neutral: 'bg-[var(--surface)] border-[var(--border)]',
  medium: 'bg-amber-500/10 border-amber-500/20',
  negative: 'bg-rose-500/10 border-rose-500/20',
  low: 'bg-rose-500/10 border-rose-500/20',
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
            className={`flex flex-1 flex-col items-center rounded-lg border p-2 ${bgClass}`}
          >
            <span className={`text-xl font-bold tabular-nums ${textColor}`}>{entry.count}</span>
            <span className="mt-0.5 text-[10px] capitalize text-[var(--text-muted)]">
              {entry.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
