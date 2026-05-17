/**
 * Daily Pulse view — the inline native-feeling panel for the pinned RedLattice post.
 *
 * Rendered at `?view=pulse` (the default when a mod opens the pinned post).
 * Designed to be glanceable — all critical metrics visible without scrolling.
 *
 * Layout:
 *   Header: "RedLattice · Today's Pulse" with orange accent dot
 *   Stat row (4 numbers): Posts today / Top driver / Negative share / Active incidents
 *   Mini trend: 7-day sentiment bar chart (positive / neutral / negative stacked bars)
 *   Footer: "Open full dashboard →" CTA
 */

import { useQuery } from '@tanstack/react-query';
import { api, type PulseStats } from '../lib/api.ts';

interface Props {
  onOpenDashboard: () => void;
}

export function Pulse({ onOpenDashboard }: Props) {
  const stats = useQuery({ queryKey: ['pulse-stats'], queryFn: api.pulseStats });

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col px-5 py-6">
      {/* Header */}
      <header className="mb-5 flex items-center gap-3">
        <span
          className="block h-3 w-3 flex-shrink-0 rounded-full bg-orange-500"
          aria-hidden="true"
        />
        <h1 className="text-xl font-semibold tracking-tight text-neutral-100">
          RedLattice · Today's Pulse
        </h1>
        {stats.data && (
          <span className="ml-auto text-xs text-neutral-500" title="Date">
            {stats.data.today}
          </span>
        )}
      </header>

      {/* Stat row */}
      {stats.isPending ? (
        <StatRowSkeleton />
      ) : stats.isError ? (
        <ErrorBlock retry={() => stats.refetch()} />
      ) : (
        <>
          <StatRow data={stats.data} />
          <TrendSection data={stats.data} />
        </>
      )}

      {/* Footer CTA */}
      <div className="mt-auto pt-6">
        <button
          type="button"
          onClick={onOpenDashboard}
          className="w-full rounded-md bg-orange-500 px-4 py-3 font-medium text-white transition hover:bg-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
        >
          Open full dashboard →
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Stat row — 4 numbers
// ---------------------------------------------------------------------------

function StatRow({ data }: { data: PulseStats }) {
  const negSharePct =
    data.negativeShare !== null ? `${Math.round(data.negativeShare * 100)}%` : '—';
  const negTone =
    data.negativeShare !== null && data.negativeShare >= 0.3
      ? 'negative'
      : data.negativeShare !== null && data.negativeShare >= 0.15
        ? 'warn'
        : 'neutral';

  return (
    <section
      className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
      aria-label="Today's key metrics"
    >
      <Stat label="Posts today" value={String(data.postsToday)} sub="auto-tagged" tone="neutral" />
      <Stat
        label="Top driver"
        value={data.topDriver.label ?? data.topDriver.id ?? '—'}
        sub={data.topDriver.count > 0 ? `${data.topDriver.count} posts` : 'none yet'}
        tone="neutral"
      />
      <Stat
        label="Negative share"
        value={negSharePct}
        sub={
          data.negativeShareTrend === 'up'
            ? '↑ vs yesterday'
            : data.negativeShareTrend === 'down'
              ? '↓ vs yesterday'
              : '— vs yesterday'
        }
        tone={negTone}
      />
      <Stat
        label="Active incidents"
        value={String(data.activeIncidents)}
        sub={data.activeIncidents > 0 ? 'needs attention' : 'all clear'}
        tone={data.activeIncidents > 0 ? 'negative' : 'neutral'}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'positive' | 'negative' | 'warn' | 'neutral';
}) {
  const valueColor =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : tone === 'warn'
          ? 'text-amber-400'
          : 'text-neutral-100';

  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold leading-none ${valueColor}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-neutral-500">{sub}</div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Mini 7-day sentiment trend
// ---------------------------------------------------------------------------

function TrendSection({ data }: { data: PulseStats }) {
  const series = data.sentimentTrend;
  if (series.length === 0) return null;

  // Compute the tallest bar for scaling
  const maxTotal = Math.max(...series.map((d) => d.total), 1);

  return (
    <section
      className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
      aria-label="Last 7 days sentiment"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Last 7 days — sentiment
        </span>
        <span className="flex items-center gap-3 text-xs text-neutral-600">
          <LegendDot color="bg-emerald-500" label="positive" />
          <LegendDot color="bg-neutral-600" label="neutral" />
          <LegendDot color="bg-rose-500" label="negative" />
        </span>
      </div>

      <div className="flex items-end gap-1.5" style={{ height: '64px' }} aria-hidden="true">
        {series.map((day) => {
          const heightPct = day.total > 0 ? (day.total / maxTotal) * 100 : 0;
          const negPct = day.total > 0 ? (day.negative / day.total) * 100 : 0;
          const neuPct = day.total > 0 ? (day.neutral / day.total) * 100 : 0;
          const posPct = day.total > 0 ? (day.positive / day.total) * 100 : 0;
          const shortDate = day.date.slice(5); // MM-DD

          return (
            <div
              key={day.date}
              className="flex flex-1 flex-col items-center gap-0.5"
              title={`${shortDate}: ${day.total} posts · ${day.positive}↑ ${day.neutral}― ${day.negative}↓`}
            >
              <div
                className="w-full overflow-hidden rounded-sm"
                style={{ height: `${Math.max(heightPct * 0.58, day.total > 0 ? 4 : 0)}px` }}
              >
                {/* Stacked from bottom: positive / neutral / negative */}
                <div className="flex h-full flex-col-reverse">
                  <div
                    className="w-full bg-emerald-500"
                    style={{ height: `${posPct}%` }}
                    role="presentation"
                  />
                  <div
                    className="w-full bg-neutral-600"
                    style={{ height: `${neuPct}%` }}
                    role="presentation"
                  />
                  <div
                    className="w-full bg-rose-500"
                    style={{ height: `${negPct}%` }}
                    role="presentation"
                  />
                </div>
              </div>
              <span className="text-[10px] text-neutral-600">{shortDate}</span>
            </div>
          );
        })}
      </div>

      {/* Numeric summary row */}
      <div className="mt-2 flex justify-around border-t border-neutral-800 pt-2 text-xs">
        <TrendTotal
          label="positive"
          value={series.reduce((s, d) => s + d.positive, 0)}
          color="text-emerald-400"
        />
        <TrendTotal
          label="neutral"
          value={series.reduce((s, d) => s + d.neutral, 0)}
          color="text-neutral-400"
        />
        <TrendTotal
          label="negative"
          value={series.reduce((s, d) => s + d.negative, 0)}
          color="text-rose-400"
        />
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function TrendTotal({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
      <span className="text-neutral-600">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading + error states
// ---------------------------------------------------------------------------

function StatRowSkeleton() {
  return (
    <>
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
          />
        ))}
      </section>
      <div className="h-32 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
    </>
  );
}

function ErrorBlock({ retry }: { retry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
      <p className="mb-2 font-medium">Couldn't load today's stats</p>
      <p className="mb-3 text-rose-300/70">
        The dashboard is still accessible — click "Open full dashboard" below.
      </p>
      <button type="button" onClick={retry} className="text-sm underline">
        Retry
      </button>
    </div>
  );
}
