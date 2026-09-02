import { useMemo } from 'react';
import type { SentimentRollup } from '../lib/api.ts';

interface Props {
  series: SentimentRollup[];
}

export function SentimentChart({ series }: Props) {
  const data = useMemo(() => {
    const maxTotal = Math.max(...series.map((d) => d.total), 1);
    return series.map((d) => ({
      date: d.date.slice(5),
      positive: d.positive,
      neutral: d.neutral,
      negative: d.negative,
      total: d.total,
      maxTotal,
    }));
  }, [series]);

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] text-[length:var(--t-sm)] text-[var(--n-8)]">
        No sentiment data yet
      </div>
    );
  }

  return (
    <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-4 shadow-[var(--shadow-1)]">
      <div className="flex h-52 items-end gap-px">
        {data.map((d) => {
          const h = d.total > 0 ? (d.total / d.maxTotal) * 100 : 0;
          const pPct = d.total > 0 ? (d.positive / d.total) * 100 : 0;
          const nPct = d.total > 0 ? (d.neutral / d.total) * 100 : 0;
          return (
            <div
              key={d.date}
              className="group relative flex flex-1 flex-col justify-end"
              style={{ height: '100%' }}
              title={`${d.date}: +${d.positive} ~${d.neutral} -${d.negative}`}
            >
              <div
                className="flex w-full flex-col overflow-hidden rounded-t-sm transition-opacity hover:opacity-80"
                style={{ height: `${h}%`, minHeight: d.total > 0 ? 2 : 0 }}
              >
                <div
                  className="w-full"
                  style={{ height: `${pPct}%`, background: 'var(--success-9)' }}
                />
                <div className="w-full" style={{ height: `${nPct}%`, background: 'var(--n-6)' }} />
                <div className="w-full flex-1" style={{ background: 'var(--error-9)' }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[length:var(--t-xs)] text-[var(--n-7)]">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
      <div className="mt-2 flex gap-4 text-[length:var(--t-xs)] text-[var(--n-8)]">
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: 'var(--success-9)' }}
          />
          Positive
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: 'var(--n-6)' }}
          />
          Neutral
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: 'var(--error-9)' }}
          />
          Negative
        </span>
      </div>
    </div>
  );
}
