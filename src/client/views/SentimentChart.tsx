/**
 * SentimentChart — lazy-loaded recharts area chart for the Sentiment tab.
 *
 * Kept in its own module so that recharts (and all its d3 transitive deps) are
 * code-split into a separate async chunk. The Sentiment tab is not shown on
 * first paint, so the ~180 KB of recharts only downloads when the user
 * actually navigates there.
 */

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SentimentRollup } from '../lib/api.ts';

interface Props {
  series: SentimentRollup[];
}

export function SentimentChart({ series }: Props) {
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
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" stroke="#525866" fontSize={11} tickMargin={6} />
            <YAxis stroke="#525866" fontSize={11} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: '#0a0a0a',
                border: '1px solid #262626',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: '#9ca3af' }}
            />
            <Area
              type="monotone"
              dataKey="positive"
              stackId="1"
              stroke="#10b981"
              fill="#10b98155"
            />
            <Area type="monotone" dataKey="neutral" stackId="1" stroke="#737373" fill="#73737355" />
            <Area
              type="monotone"
              dataKey="negative"
              stackId="1"
              stroke="#f43f5e"
              fill="#f43f5e55"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
