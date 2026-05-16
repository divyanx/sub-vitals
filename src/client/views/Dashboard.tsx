/**
 * Dashboard view — full multi-tab analytics surface.
 *
 * Tabs: Overview, Drivers, Sentiment, Agents.
 * Future tabs (Settings, Response Analytics) will land here unchanged.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type Agent, api, type DashboardSummary } from '../lib/api.ts';

type Tab = 'overview' | 'drivers' | 'sentiment' | 'agents';

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <Nav tab={tab} setTab={setTab} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {tab === 'overview' && <Overview />}
        {tab === 'drivers' && <Drivers />}
        {tab === 'sentiment' && <SentimentTab />}
        {tab === 'agents' && <Agents />}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-neutral-800 bg-neutral-950/80 px-6 py-4 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <span className="block h-3 w-3 rounded-full bg-orange-500" />
        <h1 className="text-lg font-semibold tracking-tight">RedLattice</h1>
        <span className="ml-2 rounded-full border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
          analytics
        </span>
      </div>
    </header>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'drivers', label: 'Contact drivers' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'agents', label: 'Agents' },
];

function Nav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <nav className="border-b border-neutral-800 bg-neutral-950 px-6">
      <div className="mx-auto flex max-w-6xl gap-1">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition ${
              tab === t.id
                ? 'border-orange-500 text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview() {
  const summary = useQuery({ queryKey: ['summary'], queryFn: api.summary });

  if (summary.isPending) return <SkeletonGrid />;
  if (summary.isError)
    return <ErrorMsg msg="Couldn't load summary." retry={() => summary.refetch()} />;
  return <OverviewContent data={summary.data} />;
}

function OverviewContent({ data }: { data: DashboardSummary }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card
        label="Top driver today"
        value={data.drivers.topDriverId ?? '—'}
        sub={`${data.drivers.topDriverCount} posts`}
      />
      <Card
        label="Posts today"
        value={String(data.drivers.today?.totalPosts ?? 0)}
        sub="auto-tagged"
      />
      <Card
        label="Avg sentiment"
        value={data.sentiment ? data.sentiment.averageScore.toFixed(2) : '—'}
        sub={
          data.sentiment
            ? `${data.sentiment.negative} neg / ${data.sentiment.total} total`
            : 'no scores yet'
        }
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

function Drivers() {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const volumeQ = useQuery({ queryKey: ['drivers-volume'], queryFn: api.driverVolume });

  if (taxonomyQ.isPending || volumeQ.isPending) return <SkeletonGrid />;
  if (taxonomyQ.isError || volumeQ.isError)
    return (
      <ErrorMsg
        msg="Couldn't load drivers."
        retry={() => {
          taxonomyQ.refetch();
          volumeQ.refetch();
        }}
      />
    );

  const taxonomy = taxonomyQ.data.taxonomy;
  const totals: Record<string, number> = {};
  for (const day of volumeQ.data.series) {
    for (const [id, count] of Object.entries(day.counts ?? {})) {
      totals[id] = (totals[id] ?? 0) + count;
    }
  }
  const sorted = taxonomy
    .map((t) => ({ ...t, count: totals[t.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...sorted.map((s) => s.count));

  return (
    <section>
      <h2 className="mb-4 text-sm uppercase tracking-wide text-neutral-400">
        Contact drivers · last 30 days
      </h2>
      <ul className="space-y-2">
        {sorted.map((d) => (
          <li key={d.id} className="flex items-center gap-4">
            <span className="w-40 truncate text-sm" style={{ color: d.color }}>
              {d.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-900">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(d.count / max) * 100}%`, background: d.color ?? '#ff4500' }}
              />
            </span>
            <span className="w-12 text-right text-sm tabular-nums text-neutral-400">{d.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

function SentimentTab() {
  const sentQ = useQuery({ queryKey: ['sentiment-rollup'], queryFn: api.sentimentRollup });
  if (sentQ.isPending) return <SkeletonGrid />;
  if (sentQ.isError)
    return <ErrorMsg msg="Couldn't load sentiment." retry={() => sentQ.refetch()} />;

  const totals = sentQ.data.series.reduce(
    (acc, day) => {
      acc.positive += day.positive;
      acc.neutral += day.neutral;
      acc.negative += day.negative;
      acc.total += day.total;
      return acc;
    },
    { positive: 0, neutral: 0, negative: 0, total: 0 },
  );

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card label="Positive" value={String(totals.positive)} sub="last 30d" />
      <Card label="Neutral" value={String(totals.neutral)} sub="last 30d" />
      <Card label="Negative" value={String(totals.negative)} sub="last 30d" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function Agents() {
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: api.agents });
  if (agentsQ.isPending) return <SkeletonGrid />;
  if (agentsQ.isError)
    return <ErrorMsg msg="Couldn't load agents." retry={() => agentsQ.refetch()} />;
  return <AgentList agents={agentsQ.data.agents} />;
}

function AgentList({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
        No verified agents yet. Use the comment menu action "Mark as Verified Agent" to add one.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
      {agents.map((a) => (
        <li key={a.username} className="flex items-center justify-between px-4 py-3">
          <span className="font-medium">u/{a.username}</span>
          <span className="text-xs uppercase tracking-wide text-neutral-400">{a.role}</span>
          <span className="text-xs text-neutral-500">
            {new Date(a.verifiedAt).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{sub}</div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
        />
      ))}
    </div>
  );
}

function ErrorMsg({ msg, retry }: { msg: string; retry: () => void }) {
  return (
    <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
      {msg}{' '}
      <button type="button" onClick={retry} className="underline">
        Retry
      </button>
    </div>
  );
}
