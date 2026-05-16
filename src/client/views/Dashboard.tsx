/**
 * Dashboard view — full multi-tab analytics surface.
 *
 * Tabs: Overview · Drivers · Sentiment · Agents.
 * Each tab pulls its own data via TanStack Query. Drivers tab has
 * click-through to the per-driver post list; Overview shows a live recent-
 * activity feed with deep links back to the actual Reddit posts.
 */

import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  type Agent,
  api,
  type DashboardSummary,
  type DriverPost,
  type RecentPost,
  type SentimentRollup,
  type TaxonomyNode,
} from '../lib/api.ts';

type Tab = 'overview' | 'drivers' | 'sentiment' | 'agents' | 'export';

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
        {tab === 'export' && <ExportTab />}
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
  { id: 'export', label: 'Export' },
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
  const recent = useQuery({ queryKey: ['recent-posts'], queryFn: () => api.recentPosts(15) });

  if (summary.isPending) return <SkeletonGrid />;
  if (summary.isError)
    return <ErrorMsg msg="Couldn't load summary." retry={() => summary.refetch()} />;
  return (
    <div className="space-y-8">
      <OverviewCards data={summary.data} />
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">Recent activity</h2>
        {recent.isPending ? (
          <SkeletonList />
        ) : recent.isError ? (
          <ErrorMsg msg="Couldn't load recent posts." retry={() => recent.refetch()} />
        ) : recent.data.items.length === 0 ? (
          <EmptyHint>
            No posts processed yet — submit a post in the subreddit and it'll appear here within a
            second.
          </EmptyHint>
        ) : (
          <RecentList items={recent.data.items} />
        )}
      </section>
    </div>
  );
}

function OverviewCards({ data }: { data: DashboardSummary }) {
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <Card
        label="Top driver today"
        value={data.drivers.topDriverLabel ?? '—'}
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
        tone={
          data.sentiment
            ? data.sentiment.averageScore > 0.05
              ? 'positive'
              : data.sentiment.averageScore < -0.05
                ? 'negative'
                : 'neutral'
            : 'neutral'
        }
      />
      <Card
        label="AI spend this month"
        value={`$${(data.llm.monthCents / 100).toFixed(3)}`}
        sub={`${(data.llm.monthTokensIn + data.llm.monthTokensOut).toLocaleString()} tokens`}
      />
    </section>
  );
}

function RecentList({ items }: { items: RecentPost[] }) {
  return (
    <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
      {items.map((p) => (
        <li key={p.postId} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <a
              href={p.url}
              target="_top"
              rel="noopener noreferrer"
              className="block truncate text-sm font-medium text-neutral-100 hover:underline"
              title={p.title}
            >
              {p.title || '(no title)'}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span>u/{p.authorName}</span>
              <span>·</span>
              <span>{relativeTime(p.createdAt)}</span>
              {p.driverId ? (
                <>
                  <span>·</span>
                  <DriverBadge id={p.driverId} taggedBy={p.taggedBy} />
                </>
              ) : null}
              {p.sentimentLabel ? (
                <>
                  <span>·</span>
                  <SentimentBadge
                    label={p.sentimentLabel}
                    score={p.sentimentScore}
                    by={p.sentimentScoredBy}
                  />
                </>
              ) : null}
            </div>
            {p.reasoning ? (
              <div className="mt-1 text-xs italic text-neutral-500">"{p.reasoning}"</div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DriverBadge({
  id,
  taggedBy,
}: {
  id: string;
  taggedBy: 'manual' | 'auto' | 'ai' | null | undefined;
}) {
  const style =
    taggedBy === 'ai'
      ? 'border-violet-700 bg-violet-900/40 text-violet-200'
      : taggedBy === 'manual'
        ? 'border-blue-700 bg-blue-900/40 text-blue-200'
        : 'border-neutral-700 bg-neutral-800 text-neutral-300';
  return (
    <span className={`rounded-full border px-2 py-0.5 ${style}`}>
      {id}
      {taggedBy === 'ai' ? ' · ai' : taggedBy === 'manual' ? ' · mod' : ''}
    </span>
  );
}

function SentimentBadge({
  label,
  score,
  by,
}: {
  label: 'positive' | 'neutral' | 'negative';
  score: number | null;
  by: 'lexicon' | 'ai' | null;
}) {
  const style =
    label === 'positive'
      ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
      : label === 'negative'
        ? 'border-rose-800 bg-rose-900/30 text-rose-200'
        : 'border-neutral-700 bg-neutral-800 text-neutral-300';
  return (
    <span className={`rounded-full border px-2 py-0.5 ${style}`}>
      {label}
      {score != null ? ` ${score.toFixed(2)}` : ''}
      {by === 'ai' ? ' · ai' : ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Drivers — bar list with click-through
// ---------------------------------------------------------------------------

function Drivers() {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const volumeQ = useQuery({ queryKey: ['drivers-volume'], queryFn: api.driverVolume });
  const [openDriver, setOpenDriver] = useState<string | null>(null);

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
    <section className="space-y-6">
      <div>
        <h2 className="mb-4 text-sm uppercase tracking-wide text-neutral-400">
          Contact drivers · last 30 days · click to see posts
        </h2>
        <ul className="space-y-2">
          {sorted.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setOpenDriver(openDriver === d.id ? null : d.id)}
                className={`flex w-full items-center gap-4 rounded-lg border px-3 py-2 text-left transition ${
                  openDriver === d.id
                    ? 'border-orange-500 bg-neutral-900'
                    : 'border-transparent hover:border-neutral-800 hover:bg-neutral-900/60'
                }`}
              >
                <span className="w-40 truncate text-sm" style={{ color: d.color }}>
                  {d.label}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-900">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(d.count / max) * 100}%`,
                      background: d.color ?? '#ff4500',
                    }}
                  />
                </span>
                <span className="w-12 text-right text-sm tabular-nums text-neutral-400">
                  {d.count}
                </span>
              </button>
              {openDriver === d.id ? (
                <div className="mt-2 ml-4">
                  <DriverPostsPanel driver={d} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function DriverPostsPanel({ driver }: { driver: TaxonomyNode }) {
  const q = useQuery({
    queryKey: ['driver-posts', driver.id],
    queryFn: () => api.driverPosts(driver.id, 50),
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorMsg msg="Couldn't load posts." retry={() => q.refetch()} />;
  if (q.data.posts.length === 0)
    return <EmptyHint>No posts tagged "{driver.label}" yet.</EmptyHint>;
  return <DriverPostList posts={q.data.posts} />;
}

function DriverPostList({ posts }: { posts: DriverPost[] }) {
  return (
    <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
      {posts.map((p) => (
        <li key={p.postId} className="px-4 py-3">
          <a
            href={p.url}
            target="_top"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium text-neutral-100 hover:underline"
            title={p.title}
          >
            {p.title || '(no title)'}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>u/{p.authorName}</span>
            <span>·</span>
            <span>{relativeTime(p.createdAt)}</span>
            {p.taggedBy ? (
              <>
                <span>·</span>
                <DriverBadge id={p.driverId} taggedBy={p.taggedBy} />
              </>
            ) : null}
            {p.confidence != null ? (
              <>
                <span>·</span>
                <span>confidence {(p.confidence * 100).toFixed(0)}%</span>
              </>
            ) : null}
          </div>
          {p.reasoning ? (
            <div className="mt-1 text-xs italic text-neutral-500">"{p.reasoning}"</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sentiment — totals + 30-day timeline
// ---------------------------------------------------------------------------

function SentimentTab() {
  const sentQ = useQuery({ queryKey: ['sentiment-rollup'], queryFn: api.sentimentRollup });
  if (sentQ.isPending) return <SkeletonGrid />;
  if (sentQ.isError)
    return <ErrorMsg msg="Couldn't load sentiment." retry={() => sentQ.refetch()} />;

  const series = sentQ.data.series;
  const totals = series.reduce(
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
    <div className="space-y-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card label="Positive" value={String(totals.positive)} sub="last 30d" tone="positive" />
        <Card label="Neutral" value={String(totals.neutral)} sub="last 30d" />
        <Card label="Negative" value={String(totals.negative)} sub="last 30d" tone="negative" />
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">
          Daily sentiment volume · 30 days
        </h2>
        <SentimentChart series={series} />
      </section>
    </div>
  );
}

function SentimentChart({ series }: { series: SentimentRollup[] }) {
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
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

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function Agents() {
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: api.agents });
  if (agentsQ.isPending) return <SkeletonList />;
  if (agentsQ.isError)
    return <ErrorMsg msg="Couldn't load agents." retry={() => agentsQ.refetch()} />;
  return <AgentList agents={agentsQ.data.agents} />;
}

function AgentList({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyHint>
        No verified agents yet. Use the comment-menu action "RedLattice · Mark verified agent" to
        add one.
      </EmptyHint>
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
// Export — CSV download for warehouse / Sprinklr-style ingestion
// ---------------------------------------------------------------------------

function ExportTab() {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">Data export</h2>
        <p className="mb-4 max-w-2xl text-sm text-neutral-400">
          RedLattice keeps the operational hot data in Devvit Redis. For longer retention, cross-sub
          analytics, or pulling into your own warehouse (BigQuery, Snowflake, Sprinklr), export the
          most recent posts as CSV. Endpoint is mod-only and same-origin to the dashboard.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/export/posts.csv?limit=500"
            target="_top"
            rel="noopener noreferrer"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition hover:border-orange-500 hover:text-orange-300"
          >
            Download recent 500 posts (CSV)
          </a>
          <a
            href="/api/export/posts.csv?limit=1000"
            target="_top"
            rel="noopener noreferrer"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition hover:border-orange-500 hover:text-orange-300"
          >
            Download recent 1000 posts (CSV)
          </a>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">REST endpoints</h2>
        <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4 font-mono text-xs text-neutral-300">
          <div>GET /api/dashboard/summary</div>
          <div>GET /api/dashboard/recent-posts?limit=N</div>
          <div>GET /api/drivers/taxonomy</div>
          <div>GET /api/drivers/volume?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</div>
          <div>GET /api/drivers/&lt;driverId&gt;/posts?limit=N</div>
          <div>GET /api/sentiment/rollup?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</div>
          <div>GET /api/agents</div>
          <div>GET /api/export/posts.csv?limit=N</div>
        </div>
        <p className="mt-3 max-w-2xl text-xs text-neutral-500">
          All routes are mod-protected and return JSON unless otherwise noted. Phase 2 will add
          bearer-token auth so external services can pull directly without a mod session.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function Card({
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
      <div className={`mt-2 truncate text-2xl font-semibold ${accent}`}>{value}</div>
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

function SkeletonList() {
  return (
    <div className="space-y-2" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
        />
      ))}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
      {children}
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
