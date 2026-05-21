/**
 * ScalarSummary — big number + inline SVG sparkline for scalar pipelines
 * (response time, spam score, etc.). Uses the distribution to build a mini line chart.
 */

import type { TagDistributionEntry } from '../lib/api.ts';

interface ScalarSummaryProps {
  distribution: TagDistributionEntry[];
}

/** Build a tiny 80×28 SVG polyline from numeric distribution counts. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 80;
  const H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  });

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ScalarSummary({ distribution }: ScalarSummaryProps) {
  if (distribution.length === 0) {
    return (
      <p className="text-xs text-[var(--text-muted)]">No data yet — posts will appear here.</p>
    );
  }

  // Latest value is the last entry; all counts form the sparkline series
  const values = distribution.map((e) => e.count);
  const latest = values[values.length - 1] ?? 0;

  return (
    <div className="flex items-end gap-4">
      <span className="text-[length:var(--t-2xl)] font-bold tabular-nums text-[var(--n-12)]">
        {latest}
      </span>
      <Sparkline values={values} />
    </div>
  );
}
