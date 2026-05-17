/**
 * Dashboard view — full multi-tab analytics surface.
 *
 * Tabs: Overview · Drivers · Sentiment · Agents.
 * Each tab pulls its own data via TanStack Query. Drivers tab has
 * click-through to the per-driver post list; Overview shows a live recent-
 * activity feed with deep links back to the actual Reddit posts.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  type PostStatus,
  type RecentPost,
  type SentimentRollup,
  type TaxonomyNode,
} from '../lib/api.ts';
import { Settings } from './Settings.tsx';

type Tab =
  | 'inbox'
  | 'overview'
  | 'drivers'
  | 'sentiment'
  | 'incidents'
  | 'themes'
  | 'agents'
  | 'export'
  | 'settings';

export interface DashboardProps {
  initialTab?: Tab;
  initialDriver?: string;
}

export function Dashboard({ initialTab = 'inbox', initialDriver }: DashboardProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <Nav tab={tab} setTab={setTab} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {tab === 'inbox' && <Inbox />}
        {tab === 'overview' && <Overview />}
        {tab === 'drivers' &&
          (initialDriver ? <Drivers initialDriver={initialDriver} /> : <Drivers />)}
        {tab === 'sentiment' && <SentimentTab />}
        {tab === 'incidents' && <Incidents />}
        {tab === 'themes' && <Themes />}
        {tab === 'agents' && <Agents />}
        {tab === 'export' && <ExportTab />}
        {tab === 'settings' && <Settings />}
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
  { id: 'inbox', label: 'Inbox' },
  { id: 'overview', label: 'Pulse' },
  { id: 'drivers', label: 'Contact drivers' },
  { id: 'sentiment', label: 'Sentiment' },
  { id: 'incidents', label: 'Incidents' },
  { id: 'themes', label: 'Themes' },
  { id: 'agents', label: 'Agents' },
  { id: 'export', label: 'Export' },
  { id: 'settings', label: 'Settings' },
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
// Inbox — the Triage cockpit (the "what needs ME?" view for support agents)
// ---------------------------------------------------------------------------

const STATUS_TABS: { id: 'open' | 'in-progress' | 'all'; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'all', label: 'All' },
];

function Inbox() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'in-progress' | 'all'>('open');
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['triage-queue', statusFilter],
    queryFn: () => api.triageQueue({ status: statusFilter }),
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const mutate = async (postId: string, status: PostStatus) => {
    setActionError(null);
    try {
      await api.setPostStatus(postId, status);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['triage-queue'] }),
        qc.invalidateQueries({ queryKey: ['recent-posts'] }),
        qc.invalidateQueries({ queryKey: ['driver-posts'] }),
      ]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="space-y-5">
      {actionError ? (
        <div className="flex items-center justify-between rounded-lg border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline-offset-2 hover:underline"
          >
            dismiss
          </button>
        </div>
      ) : null}
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Triage inbox</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-500">
            Auto-prioritized by driver severity × sentiment × thread heat × age. Top of list is what
            should get your attention first.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {STATUS_TABS.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`rounded-full border px-3 py-1 transition ${
                statusFilter === s.id
                  ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                  : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {queue.isPending ? (
        <SkeletonList />
      ) : queue.isError ? (
        <ErrorMsg msg="Couldn't load queue." retry={() => queue.refetch()} />
      ) : queue.data.items.length === 0 ? (
        <EmptyHint>
          Inbox is empty for filter "{statusFilter}".{' '}
          {statusFilter === 'open'
            ? 'Either everything is handled, or no posts have been auto-tagged yet — try submitting a post in the sub.'
            : null}
        </EmptyHint>
      ) : (
        <ol className="space-y-2">
          {queue.data.items.map((p, idx) => (
            <li
              key={p.postId}
              className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-700"
            >
              <div className="flex items-start gap-3">
                <div className="flex w-10 flex-shrink-0 flex-col items-center pt-0.5">
                  <span className="text-xs font-medium text-orange-300">#{idx + 1}</span>
                  <PriorityPill priority={p.priority} />
                </div>
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
                    <button
                      type="button"
                      onClick={() =>
                        setOpenHistory(openHistory === p.authorName ? null : p.authorName)
                      }
                      className="text-neutral-300 underline-offset-2 hover:underline"
                    >
                      u/{p.authorName}
                    </button>
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
                    {p.status ? (
                      <>
                        <span>·</span>
                        <StatusBadge status={p.status} />
                      </>
                    ) : null}
                  </div>
                  {p.reasoning ? (
                    <div className="mt-1 text-xs italic text-neutral-500">"{p.reasoning}"</div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {p.status !== 'resolved' ? (
                      <button
                        type="button"
                        onClick={() => mutate(p.postId, 'resolved')}
                        className="rounded-full border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-emerald-200 transition hover:bg-emerald-900/60"
                      >
                        ✓ Resolve
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => mutate(p.postId, 'open')}
                        className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
                      >
                        Re-open
                      </button>
                    )}
                    {p.status === 'open' ? (
                      <button
                        type="button"
                        onClick={() => mutate(p.postId, 'in-progress')}
                        className="rounded-full border border-blue-700 bg-blue-900/30 px-2 py-0.5 text-blue-200 transition hover:bg-blue-900/60"
                      >
                        Take ownership
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOpenThread(openThread === p.postId ? null : p.postId)}
                      className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
                    >
                      {openThread === p.postId ? 'Hide thread' : 'View thread'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenDraft(openDraft === p.postId ? null : p.postId)}
                      className="rounded-full border border-violet-700 bg-violet-900/30 px-2 py-0.5 text-violet-200 transition hover:bg-violet-900/60"
                    >
                      {openDraft === p.postId ? 'Hide drafts' : '✨ Draft reply'}
                    </button>
                    <a
                      href={p.url}
                      target="_top"
                      rel="noopener noreferrer"
                      className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:border-orange-500 hover:text-orange-200"
                    >
                      ↗ Open on Reddit
                    </a>
                  </div>
                </div>
              </div>
              {openHistory === p.authorName ? (
                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <UserHistoryPanel username={p.authorName} currentPostId={p.postId} />
                </div>
              ) : null}
              {openThread === p.postId ? (
                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <ThreadPanel postId={p.postId} />
                </div>
              ) : null}
              {openDraft === p.postId ? (
                <div className="mt-4 border-t border-neutral-800 pt-4">
                  <DraftReplyPanel postId={p.postId} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PriorityPill({ priority }: { priority: number }) {
  const tone =
    priority >= 1.0
      ? 'border-rose-700 bg-rose-900/40 text-rose-200'
      : priority >= 0.5
        ? 'border-orange-700 bg-orange-900/40 text-orange-200'
        : 'border-neutral-700 bg-neutral-800 text-neutral-400';
  return (
    <span className={`mt-1 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums ${tone}`}>
      {priority.toFixed(2)}
    </span>
  );
}

function UserHistoryPanel({
  username,
  currentPostId,
}: {
  username: string;
  currentPostId: string;
}) {
  const q = useQuery({
    queryKey: ['user-history', username],
    queryFn: () => api.userHistory(username, 20),
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorMsg msg="Couldn't load history." retry={() => q.refetch()} />;
  const { items, aggregate } = q.data;
  const others = items.filter((p) => p.postId !== currentPostId);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
        <span className="font-medium text-neutral-200">u/{username}</span>
        <span>·</span>
        <span>{aggregate.totalPosts} known posts</span>
        {aggregate.averageScore !== null ? (
          <>
            <span>·</span>
            <span>
              avg sentiment{' '}
              <span
                className={
                  aggregate.averageScore < -0.1
                    ? 'text-rose-300'
                    : aggregate.averageScore > 0.1
                      ? 'text-emerald-300'
                      : 'text-neutral-300'
                }
              >
                {aggregate.averageScore.toFixed(2)}
              </span>
            </span>
          </>
        ) : null}
        {aggregate.negativeShare !== null ? (
          <>
            <span>·</span>
            <span>{Math.round(aggregate.negativeShare * 100)}% negative</span>
          </>
        ) : null}
        {aggregate.topDrivers.length > 0 ? (
          <>
            <span>·</span>
            <span>
              top:{' '}
              {aggregate.topDrivers
                .slice(0, 3)
                .map((d) => `${d.id} (${d.count})`)
                .join(', ')}
            </span>
          </>
        ) : null}
      </div>
      {others.length === 0 ? (
        <EmptyHint>No other posts by this user in our index.</EmptyHint>
      ) : (
        <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-950/40">
          {others.map((p) => (
            <li key={p.postId} className="px-3 py-2">
              <a
                href={p.url}
                target="_top"
                rel="noopener noreferrer"
                className="block truncate text-sm text-neutral-100 hover:underline"
                title={p.title}
              >
                {p.title || '(no title)'}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span>{relativeTime(p.createdAt)}</span>
                {p.driverId ? (
                  <>
                    <span>·</span>
                    <span className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5">
                      {p.driverId}
                    </span>
                  </>
                ) : null}
                {p.sentimentLabel ? (
                  <>
                    <span>·</span>
                    <SentimentBadge label={p.sentimentLabel} score={p.sentimentScore} by={null} />
                  </>
                ) : null}
                {p.status ? (
                  <>
                    <span>·</span>
                    <StatusBadge status={p.status} />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Draft Reply — the cockpit's "give me 2-3 candidate replies" panel
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<string, string> = {
  empathetic: 'border-emerald-700 bg-emerald-900/30 text-emerald-200',
  direct: 'border-orange-700 bg-orange-900/30 text-orange-200',
  concise: 'border-neutral-700 bg-neutral-900 text-neutral-200',
  investigative: 'border-blue-700 bg-blue-900/30 text-blue-200',
};

function DraftReplyPanel({ postId }: { postId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.draftReply>> | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.draftReply(postId);
      setData(r);
      setEdits({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch on first mount so the panel feels instant when opened.
  if (!data && !loading && !error) {
    void generate();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="font-medium text-violet-300">✨ AI draft replies</span>
          {data ? (
            <span className="text-neutral-500">
              · {data.candidates.length} candidates · {data.tokensIn + data.tokensOut} tokens · $
              {(data.costCents / 100).toFixed(4)}
              {data.cached ? ' · cached' : ''}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1 text-xs text-violet-200 transition hover:bg-violet-900/60 disabled:opacity-50"
        >
          {loading ? 'Generating…' : data ? 'Regenerate' : 'Generate'}
        </button>
      </div>
      {error ? (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {loading && !data ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
            />
          ))}
        </div>
      ) : null}
      {data ? (
        <ul className="space-y-3">
          {data.candidates.map((c, i) => {
            const text = edits[i] ?? c.reply;
            return (
              <li
                key={`${c.tone}-${i}`}
                className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 ${TONE_COLOR[c.tone] ?? TONE_COLOR.concise}`}
                    >
                      {c.tone}
                    </span>
                    <span className="text-neutral-500">{c.rationale}</span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(text);
                        setCopiedIdx(i);
                        setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1800);
                      } catch {
                        /* clipboard blocked — user can still select+copy */
                      }
                    }}
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-200 transition hover:border-orange-500 hover:text-orange-200"
                  >
                    {copiedIdx === i ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [i]: e.target.value }))}
                  rows={Math.min(10, Math.max(3, text.split('\n').length + 2))}
                  className="block w-full resize-y border-0 bg-transparent px-3 py-3 text-sm text-neutral-100 outline-none focus:bg-neutral-900/40"
                  spellCheck
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-xs text-neutral-500">
        Edits stay local — copy the version you like and paste it into Reddit's reply box. Brand
        voice is configurable via the subreddit setting <code>brand-voice</code>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview (renamed to "Pulse" in nav) — executive summary cards + recent feed
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

function Drivers({ initialDriver }: { initialDriver?: string | undefined }) {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const volumeQ = useQuery({ queryKey: ['drivers-volume'], queryFn: api.driverVolume });
  const [openDriver, setOpenDriver] = useState<string | null>(initialDriver ?? null);

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

const STATUS_FILTERS: { id: 'all' | PostStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'responded', label: 'Responded' },
  { id: 'resolved', label: 'Resolved' },
];

function DriverPostsPanel({ driver }: { driver: TaxonomyNode }) {
  const [filter, setFilter] = useState<'all' | PostStatus>('open');
  const q = useQuery({
    queryKey: ['driver-posts', driver.id, filter],
    queryFn: () =>
      api.driverPosts(
        driver.id,
        filter === 'all' ? { limit: 100 } : { limit: 100, status: filter },
      ),
  });
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">Filter:</span>
        {STATUS_FILTERS.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-2 py-0.5 transition ${
              filter === f.id
                ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load posts." retry={() => q.refetch()} />
      ) : q.data.posts.length === 0 ? (
        <EmptyHint>
          No posts in "{driver.label}" matching filter "{filter}".
        </EmptyHint>
      ) : (
        <DriverPostList posts={q.data.posts} driverId={driver.id} />
      )}
    </div>
  );
}

function DriverPostList({ posts, driverId }: { posts: DriverPost[]; driverId: string }) {
  const qc = useQueryClient();
  const [openThread, setOpenThread] = useState<string | null>(null);
  const mutate = async (postId: string, status: PostStatus) => {
    await api.setPostStatus(postId, status);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['driver-posts', driverId] }),
      qc.invalidateQueries({ queryKey: ['recent-posts'] }),
    ]);
  };
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
          <div className="mt-2 flex gap-2 text-xs">
            <StatusBadge status={p.status} />
            {p.status !== 'resolved' ? (
              <button
                type="button"
                onClick={() => mutate(p.postId, 'resolved')}
                className="rounded-full border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-emerald-200 transition hover:bg-emerald-900/60"
              >
                Mark resolved
              </button>
            ) : (
              <button
                type="button"
                onClick={() => mutate(p.postId, 'open')}
                className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
              >
                Re-open
              </button>
            )}
            {p.status === 'open' ? (
              <button
                type="button"
                onClick={() => mutate(p.postId, 'in-progress')}
                className="rounded-full border border-blue-700 bg-blue-900/30 px-2 py-0.5 text-blue-200 transition hover:bg-blue-900/60"
              >
                Take ownership
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpenThread(openThread === p.postId ? null : p.postId)}
              className="rounded-full border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-neutral-300 transition hover:bg-neutral-700"
            >
              {openThread === p.postId ? 'Hide thread' : 'Show thread'}
            </button>
          </div>
          {openThread === p.postId ? (
            <div className="mt-3">
              <ThreadPanel postId={p.postId} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ThreadPanel({ postId }: { postId: string }) {
  const q = useQuery({
    queryKey: ['post-thread', postId],
    queryFn: () => api.postThread(postId),
  });
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorMsg msg="Couldn't load thread." retry={() => q.refetch()} />;
  const { comments, heat } = q.data;
  if (comments.length === 0)
    return (
      <EmptyHint>
        No comments processed on this post yet. New comments appear within ~30s.
      </EmptyHint>
    );
  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-400">
          {comments.length} comment{comments.length === 1 ? '' : 's'} processed
        </span>
        {heat.isHot ? (
          <span className="rounded-full border border-rose-700 bg-rose-900/40 px-2 py-0.5 text-rose-200">
            🔥 thread heating up ({(heat.negativeShare * 100).toFixed(0)}% recent negative)
          </span>
        ) : (
          <span className="text-neutral-500">
            {(heat.negativeShare * 100).toFixed(0)}% recent negative
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {comments.map((c) => (
          <li
            key={c.commentId}
            className={`rounded-lg border px-3 py-2 ${
              c.isAgent ? 'border-blue-800 bg-blue-950/30' : 'border-neutral-800 bg-neutral-900'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span className={c.isAgent ? 'font-medium text-blue-300' : 'text-neutral-300'}>
                u/{c.authorName}
              </span>
              {c.isAgent ? <AgentSourceBadge source={c.agentSource} /> : null}
              <span>·</span>
              <span>{relativeTime(c.createdAt)}</span>
              {c.sentimentLabel ? (
                <>
                  <span>·</span>
                  <SentimentBadge
                    label={c.sentimentLabel}
                    score={c.sentimentScore}
                    by={c.sentimentScoredBy}
                  />
                </>
              ) : null}
            </div>
            <div className="mt-1 text-sm whitespace-pre-wrap text-neutral-200">{c.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentSourceBadge({
  source,
}: {
  source: 'distinguished' | 'mod-list' | 'flair' | 'record' | null;
}) {
  // Distinguished comments get the green "MOD" treatment to match Reddit's
  // own visual convention — that's the strongest "I'm speaking officially"
  // signal. Other sources get a neutral "Verified" badge.
  if (source === 'distinguished') {
    return (
      <span
        className="rounded-full border border-emerald-600 bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200"
        title="Reddit's own distinguished moderator/admin comment"
      >
        🛡 MOD
      </span>
    );
  }
  const meta: Record<
    Exclude<NonNullable<typeof source>, 'distinguished'>,
    { label: string; title: string }
  > = {
    'mod-list': { label: 'Mod team', title: 'Subreddit moderator (presumed brand employee)' },
    flair: { label: 'Verified · flair', title: 'Brand-team flair detected on author' },
    record: { label: 'Verified', title: 'Mod-marked or whitelist-seeded as verified agent' },
  };
  const m = source ? meta[source] : meta.record;
  return (
    <span
      className="rounded-full border border-blue-700 bg-blue-900/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-blue-200"
      title={m.title}
    >
      ✓ {m.label}
    </span>
  );
}

function StatusBadge({ status }: { status: PostStatus }) {
  const style =
    status === 'resolved'
      ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
      : status === 'in-progress'
        ? 'border-blue-800 bg-blue-900/30 text-blue-200'
        : status === 'responded'
          ? 'border-violet-800 bg-violet-900/30 text-violet-200'
          : 'border-neutral-700 bg-neutral-800 text-neutral-300';
  return <span className={`rounded-full border px-2 py-0.5 ${style}`}>{status}</span>;
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
// Incidents — crisis-detection auto-grouped alerts
// ---------------------------------------------------------------------------

function Incidents() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'active' | 'resolved' | 'all'>('active');
  const q = useQuery({
    queryKey: ['incidents', filter],
    queryFn: () => api.incidents(filter),
  });

  const resolve = async (id: string) => {
    try {
      await api.resolveIncident(id);
      await qc.invalidateQueries({ queryKey: ['incidents'] });
    } catch (err) {
      console.warn('resolve failed', err);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Incidents</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-500">
            Auto-grouped when comment volume or negative-sentiment ratio spikes vs the 14-day
            baseline. Resolves automatically after 30 min of quiet.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {(['active', 'resolved', 'all'] as const).map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 transition ${
                filter === f
                  ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                  : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load incidents." retry={() => q.refetch()} />
      ) : q.data.incidents.length === 0 ? (
        <EmptyHint>No incidents — your sub is calm right now.</EmptyHint>
      ) : (
        <ul className="space-y-2">
          {q.data.incidents.map((inc) => (
            <li key={inc.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium text-rose-200">{inc.reason}</div>
                  <div className="mt-1 text-xs text-neutral-500">
                    started {relativeTime(inc.startedAt)} · {inc.postIds.length} posts ·{' '}
                    {inc.commentIds.length} comments
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      inc.status === 'resolved'
                        ? 'border-emerald-800 bg-emerald-900/30 text-emerald-200'
                        : 'border-rose-700 bg-rose-900/40 text-rose-200'
                    }`}
                  >
                    {inc.status}
                  </span>
                  {inc.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => resolve(inc.id)}
                      className="rounded-full border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-emerald-200 transition hover:bg-emerald-900/60"
                    >
                      Resolve
                    </button>
                  ) : null}
                </div>
              </div>
              {inc.postIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1 text-xs">
                  {inc.postIds.slice(0, 6).map((pid) => (
                    <span
                      key={pid}
                      className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-400"
                    >
                      {pid}
                    </span>
                  ))}
                  {inc.postIds.length > 6 ? (
                    <span className="px-2 py-0.5 text-neutral-500">
                      +{inc.postIds.length - 6} more
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Themes — AI-clustered emerging issues
// ---------------------------------------------------------------------------

function Themes() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['themes'], queryFn: api.themes });
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      await api.regenerateThemes();
      await qc.invalidateQueries({ queryKey: ['themes'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm uppercase tracking-wide text-neutral-400">Emerging themes</h2>
          <p className="mt-1 max-w-xl text-xs text-neutral-500">
            LLM-clustered themes from the most recent negative posts. Regenerated daily; click below
            to refresh on-demand.
          </p>
        </div>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="rounded-md border border-violet-700 bg-violet-900/30 px-3 py-1 text-xs text-violet-200 transition hover:bg-violet-900/60 disabled:opacity-50"
        >
          {regenerating ? 'Regenerating…' : '✨ Regenerate now'}
        </button>
      </header>
      {error ? (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load themes." retry={() => q.refetch()} />
      ) : q.data.themes.length === 0 ? (
        <EmptyHint>
          No themes yet. Either no negative posts to cluster, or click Regenerate to compute now.
        </EmptyHint>
      ) : (
        <>
          <div className="text-xs text-neutral-500">
            generated {q.data.generatedAt ? relativeTime(q.data.generatedAt) : 'recently'} · last 7
            days
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {q.data.themes.map((t) => (
              <li key={t.name} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium text-neutral-100">{t.name}</h3>
                  <span className="text-xs text-neutral-500">
                    {t.postCount} post{t.postCount === 1 ? '' : 's'} ·{' '}
                    <span
                      className={
                        t.avgSentiment < -0.2
                          ? 'text-rose-300'
                          : t.avgSentiment > 0.2
                            ? 'text-emerald-300'
                            : 'text-neutral-300'
                      }
                    >
                      {t.avgSentiment.toFixed(2)}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-neutral-400">{t.summary}</p>
                {t.samplePostIds.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1 text-xs">
                    {t.samplePostIds.slice(0, 4).map((pid) => (
                      <span
                        key={pid}
                        className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-neutral-400"
                      >
                        {pid}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function Agents() {
  const agentsQ = useQuery({ queryKey: ['agents'], queryFn: api.agents });
  const leaderboardQ = useQuery({
    queryKey: ['agent-leaderboard'],
    queryFn: () => api.agentLeaderboard(30),
  });
  if (agentsQ.isPending || leaderboardQ.isPending) return <SkeletonList />;
  if (agentsQ.isError)
    return <ErrorMsg msg="Couldn't load agents." retry={() => agentsQ.refetch()} />;
  const lb = leaderboardQ.isError ? { rows: [] as never[], count: 0, days: 30 } : leaderboardQ.data;
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">
          Performance · last {lb.days}d
        </h2>
        <AgentLeaderboard rows={lb.rows} />
      </section>
      <section>
        <h2 className="mb-3 text-sm uppercase tracking-wide text-neutral-400">Verified roster</h2>
        <AgentList agents={agentsQ.data.agents} />
      </section>
    </div>
  );
}

function AgentLeaderboard({
  rows,
}: {
  rows: Array<{
    username: string;
    replies: number;
    firstResponses: number;
    avgLatencyMs: number | null;
    avgSentimentDelta: number | null;
    firstResponseRate: number | null;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <EmptyHint>
        No agent activity recorded in this window yet. Agents need to comment on tagged posts for
        metrics to appear.
      </EmptyHint>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="bg-neutral-950/50 text-left text-xs uppercase tracking-wide text-neutral-400">
          <tr>
            <th className="px-4 py-2">Agent</th>
            <th className="px-4 py-2 text-right">Replies</th>
            <th className="px-4 py-2 text-right">First responses</th>
            <th className="px-4 py-2 text-right">First-response rate</th>
            <th className="px-4 py-2 text-right">Avg first-response latency</th>
            <th className="px-4 py-2 text-right">Sentiment lift</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((r) => (
            <tr key={r.username}>
              <td className="px-4 py-2 font-medium text-neutral-100">u/{r.username}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.replies}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.firstResponses}</td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">
                {r.firstResponseRate != null ? `${(r.firstResponseRate * 100).toFixed(0)}%` : '—'}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-neutral-300">
                {r.avgLatencyMs != null ? formatLatency(r.avgLatencyMs) : '—'}
              </td>
              <td
                className={`px-4 py-2 text-right tabular-nums ${
                  r.avgSentimentDelta == null
                    ? 'text-neutral-500'
                    : r.avgSentimentDelta > 0.05
                      ? 'text-emerald-300'
                      : r.avgSentimentDelta < -0.05
                        ? 'text-rose-300'
                        : 'text-neutral-300'
                }`}
                title="Avg change in thread sentiment in the 5 comments following the agent's reply"
              >
                {r.avgSentimentDelta != null
                  ? `${r.avgSentimentDelta > 0 ? '+' : ''}${r.avgSentimentDelta.toFixed(2)}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLatency(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
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
