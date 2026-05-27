/**
 * SentimentChart — lazy-loaded recharts area chart for the Sentiment tab.
 *
 * Kept in its own module so that recharts (and all its d3 transitive deps) are
 * code-split into a separate async chunk. The Sentiment tab is not shown on
 * first paint, so the ~180 KB of recharts only downloads when the user
 * actually navigates there.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import type { SentimentRollup } from '../lib/api.ts';

interface Props {
  series: SentimentRollup[];
}

export function SentimentChart({ series }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);

    if (typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () =>
      series.map((d) => ({
        date: d.date.slice(5),
        positive: d.positive,
        neutral: d.neutral,
        negative: d.negative,
      })),
    [series],
  );
  return (
    <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-4 shadow-[var(--shadow-1)]">
      <div ref={containerRef} className="h-64 w-full">
        <AreaChart
          width={width}
          height={256}
          data={data}
          margin={{ top: 6, right: 6, left: -16, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--n-4)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke="var(--n-7)" fontSize={11} tickMargin={6} />
          <YAxis stroke="var(--n-7)" fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: 'var(--n-2)',
              border: '1px solid var(--n-4)',
              borderRadius: 6,
              fontSize: 12,
            }}
            labelStyle={{ color: 'var(--n-8)' }}
          />
          <Area
            type="monotone"
            dataKey="positive"
            stackId="1"
            stroke="var(--success-9)"
            fill="var(--success-3)"
          />
          <Area
            type="monotone"
            dataKey="neutral"
            stackId="1"
            stroke="var(--n-7)"
            fill="var(--n-3)"
          />
          <Area
            type="monotone"
            dataKey="negative"
            stackId="1"
            stroke="var(--error-9)"
            fill="var(--error-3)"
          />
        </AreaChart>
      </div>
    </div>
  );
}
