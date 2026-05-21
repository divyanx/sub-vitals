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
          className="block h-3 w-3 flex-shrink-0 rounded-full bg-[var(--accent-9)]"
          aria-hidden="true"
        />
        <h1 className="text-[length:var(--t-xl)] font-semibold tracking-tight text-[var(--n-12)]">
          RedLattice · Today's Pulse
        </h1>
        {stats.data && (
          <span className="ml-auto text-xs text-[var(--text-muted)]" title="Date">
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
          className="w-full rounded-[var(--r-2)] bg-[var(--accent-9)] px-4 py-3 font-medium text-white transition hover:bg-[var(--accent-10)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)]"
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
      ? 'text-[var(--success-11)]'
      : tone === 'negative'
        ? 'text-[var(--error-11)]'
        : tone === 'warn'
          ? 'text-[var(--warn-11)]'
          : 'text-[var(--n-12)]';

  return (
    <article className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-3 shadow-[var(--shadow-1)]">
      <div className="text-[length:var(--t-xs)] font-medium uppercase tracking-wide text-[var(--n-8)]">
        {label}
      </div>
      <div
        className={`mt-1.5 text-[length:var(--t-2xl)] font-semibold leading-none tabular-nums ${valueColor}`}
      >
        {value}
      </div>
      <div className="mt-1 truncate text-[length:var(--t-xs)] text-[var(--n-8)]">{sub}</div>
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
      className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-3 shadow-[var(--shadow-1)]"
      aria-label="Last 7 days sentiment"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[length:var(--t-xs)] font-medium uppercase tracking-wide text-[var(--n-8)]">
          Last 7 days — sentiment
        </span>
        <span className="flex items-center gap-3 text-[length:var(--t-xs)] text-[var(--n-8)]">
          <LegendDot color="bg-[var(--success-9)]" label="positive" />
          <LegendDot color="bg-[var(--n-6)]" label="neutral" />
          <LegendDot color="bg-[var(--error-9)]" label="negative" />
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
                    className="w-full bg-[var(--success-9)]"
                    style={{ height: `${posPct}%` }}
                    role="presentation"
                  />
                  <div
                    className="w-full bg-[var(--n-6)]"
                    style={{ height: `${neuPct}%` }}
                    role="presentation"
                  />
                  <div
                    className="w-full bg-[var(--error-9)]"
                    style={{ height: `${negPct}%` }}
                    role="presentation"
                  />
                </div>
              </div>
              <span className="text-[length:var(--t-xs)] text-[var(--n-8)]">{shortDate}</span>
            </div>
          );
        })}
      </div>

      {/* Numeric summary row */}
      <div className="mt-2 flex justify-around border-t border-[var(--n-4)] pt-2 text-[length:var(--t-xs)]">
        <TrendTotal
          label="positive"
          value={series.reduce((s, d) => s + d.positive, 0)}
          color="text-[var(--success-11)]"
        />
        <TrendTotal
          label="neutral"
          value={series.reduce((s, d) => s + d.neutral, 0)}
          color="text-[var(--n-8)]"
        />
        <TrendTotal
          label="negative"
          value={series.reduce((s, d) => s + d.negative, 0)}
          color="text-[var(--error-11)]"
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
      <span className="text-[var(--text-muted)]">{label}</span>
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
            className="h-20 animate-pulse rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)]"
          />
        ))}
      </section>
      <div className="h-32 animate-pulse rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)]" />
    </>
  );
}

function ErrorBlock({ retry }: { retry: () => void }) {
  return (
    <div className="rounded-[var(--r-3)] border border-[var(--error-9)] bg-[var(--error-3)] p-4 text-[length:var(--t-sm)] text-[var(--error-11)]">
      <p className="mb-2 font-medium">Couldn't load today's stats</p>
      <p className="mb-3 opacity-70">
        The dashboard is still accessible — click "Open full dashboard" below.
      </p>
      <button type="button" onClick={retry} className="text-[length:var(--t-sm)] underline">
        Retry
      </button>
    </div>
  );
}
