/**
 * Pulse view — the Daily Pulse pinned post.
 *
 * Glanceable: top driver, today's volume, sentiment label, CTA to dashboard.
 * Same React bundle as the full dashboard; routed via `?view=pulse`.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';

interface Props {
  onOpenDashboard: () => void;
}

export function Pulse({ onOpenDashboard }: Props) {
  const summary = useQuery({ queryKey: ['summary'], queryFn: api.summary });

  return (
    <main className="mx-auto flex h-full max-w-2xl flex-col px-6 py-8">
      <header className="mb-6 flex items-center gap-3">
        <span className="block h-3 w-3 rounded-full bg-orange-500" />
        <h1 className="text-2xl font-semibold tracking-tight">RedLattice · Today's Pulse</h1>
      </header>

      {summary.isPending ? (
        <PulseSkeleton />
      ) : summary.isError ? (
        <ErrorBlock retry={() => summary.refetch()} />
      ) : (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Top contact driver"
            value={summary.data.drivers.topDriverLabel ?? summary.data.drivers.topDriverId ?? '—'}
            sub={
              summary.data.drivers.topDriverCount > 0
                ? `${summary.data.drivers.topDriverCount} posts today`
                : 'no data yet'
            }
          />
          <Stat
            label="Today's posts"
            value={String(summary.data.drivers.today?.totalPosts ?? 0)}
            sub="auto-tagged"
          />
          <Stat
            label="Sentiment"
            value={summary.data.sentiment ? summary.data.sentiment.averageScore.toFixed(2) : '—'}
            sub={
              summary.data.sentiment
                ? `${summary.data.sentiment.negative} neg / ${summary.data.sentiment.total} total`
                : 'no scores yet'
            }
            tone={sentimentTone(summary.data.sentiment?.averageScore ?? 0)}
          />
        </section>
      )}

      <div className="mt-auto pt-8">
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

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'positive' | 'negative' | 'neutral';
}) {
  const accent =
    tone === 'positive'
      ? 'text-emerald-400'
      : tone === 'negative'
        ? 'text-rose-400'
        : 'text-neutral-100';
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{sub}</div>
    </article>
  );
}

function PulseSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
        />
      ))}
    </section>
  );
}

function ErrorBlock({ retry }: { retry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
      Couldn't load today's pulse.{' '}
      <button type="button" onClick={retry} className="underline">
        Retry
      </button>
    </div>
  );
}

function sentimentTone(avg: number): 'positive' | 'negative' | 'neutral' {
  if (avg > 0.05) return 'positive';
  if (avg < -0.05) return 'negative';
  return 'neutral';
}
