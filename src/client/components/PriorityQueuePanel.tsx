/**
 * PriorityQueuePanel — top 5 posts needing attention, sorted by priority.
 * Each row: title + tags + age. Click → open thread drawer.
 */

import { useQuery } from '@tanstack/react-query';
import { api, type RecentPost } from '../lib/api.ts';
import { relativeTime } from '../lib/format-time.ts';

interface PriorityQueuePanelProps {
  /** Called when user clicks a post row — receives the postId */
  onOpenPost: (postId: string, url: string) => void;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-emerald-500/15 text-emerald-400',
  neutral: 'bg-[var(--bg)] text-[var(--text-muted)]',
  negative: 'bg-rose-500/15 text-rose-400',
};

type PriorityItem = RecentPost & { priority: number };

export function PriorityQueuePanel({ onOpenPost }: PriorityQueuePanelProps) {
  const queueQ = useQuery({
    queryKey: ['triage-queue-home'],
    queryFn: () => api.triageQueue({ limit: 5, status: 'open' }),
    staleTime: 30_000,
  });

  const items = (queueQ.data?.items ?? []) as PriorityItem[];

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
      aria-label="Priority queue"
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <svg
          className="h-3.5 w-3.5 text-orange-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        <h2 className="text-sm font-semibold text-[var(--text)]">Priority queue</h2>
        {items.length > 0 && (
          <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-medium text-orange-400">
            {items.length}
          </span>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-4 pb-4 pt-3">
        {queueQ.isPending && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-[var(--border)]" />
            ))}
          </div>
        )}

        {!queueQ.isPending && items.length === 0 && (
          <div className="py-6 text-center">
            <span className="text-2xl" aria-hidden="true">
              ✓
            </span>
            <p className="mt-2 text-sm font-medium text-[var(--text)]">Inbox clear</p>
            <p className="text-xs text-[var(--text-muted)]">No open posts needing attention.</p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((item) => {
              const sentColor = item.sentimentLabel
                ? SENTIMENT_COLORS[item.sentimentLabel]
                : undefined;
              return (
                <li key={item.postId}>
                  <button
                    type="button"
                    onClick={() => onOpenPost(item.postId, item.url)}
                    className="flex w-full flex-col gap-1 py-2.5 text-left transition hover:text-orange-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                    aria-label={`Open post: ${item.title}`}
                  >
                    <p className="text-xs font-medium text-[var(--text)] line-clamp-2">
                      {item.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.sentimentLabel && sentColor && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] capitalize ${sentColor}`}
                        >
                          {item.sentimentLabel}
                        </span>
                      )}
                      {item.driverId && (
                        <span className="rounded-full bg-[var(--bg)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                          {item.driverId}
                        </span>
                      )}
                      <span className="ml-auto text-[9px] text-[var(--text-muted)]">
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
