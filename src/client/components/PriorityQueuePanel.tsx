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
  positive: 'bg-[var(--success-3)] text-[var(--success-11)]',
  neutral: 'bg-[var(--n-1)] text-[var(--n-8)]',
  negative: 'bg-[var(--error-3)] text-[var(--error-11)]',
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
      className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] shadow-[var(--shadow-1)]"
      aria-label="Priority queue"
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <svg
          className="h-3.5 w-3.5 text-[var(--accent-9)]"
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
        <h2 className="text-[length:var(--t-sm)] font-semibold text-[var(--n-12)]">
          Priority queue
        </h2>
        {items.length > 0 && (
          <span className="rounded-full bg-[var(--accent-3)] px-2 py-0.5 text-[length:var(--t-xs)] font-medium text-[var(--accent-11)]">
            {items.length}
          </span>
        )}
      </div>

      <div className="border-t border-[var(--n-4)] px-4 pb-4 pt-3">
        {queueQ.isPending && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-[var(--r-1)] bg-[var(--n-4)]" />
            ))}
          </div>
        )}

        {!queueQ.isPending && items.length === 0 && (
          <div className="py-6 text-center">
            <span className="text-[length:var(--t-2xl)]" aria-hidden="true">
              ✓
            </span>
            <p className="mt-2 text-[length:var(--t-sm)] font-medium text-[var(--n-12)]">
              Inbox clear
            </p>
            <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
              No open posts needing attention.
            </p>
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y divide-[var(--n-4)]">
            {items.map((item) => {
              const sentColor = item.sentimentLabel
                ? SENTIMENT_COLORS[item.sentimentLabel]
                : undefined;
              return (
                <li key={item.postId}>
                  <button
                    type="button"
                    onClick={() => onOpenPost(item.postId, item.url)}
                    className="flex w-full flex-col gap-1 py-2.5 text-left transition hover:text-[var(--accent-11)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
                    aria-label={`Open post: ${item.title}`}
                  >
                    <p className="text-[length:var(--t-xs)] font-medium text-[var(--n-12)] line-clamp-2">
                      {item.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.sentimentLabel && sentColor && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[length:var(--t-xs)] capitalize ${sentColor}`}
                        >
                          {item.sentimentLabel}
                        </span>
                      )}
                      {item.driverId && (
                        <span className="rounded-full bg-[var(--n-1)] px-1.5 py-0.5 text-[length:var(--t-xs)] text-[var(--n-8)]">
                          {item.driverId}
                        </span>
                      )}
                      <span className="ml-auto text-[length:var(--t-xs)] text-[var(--n-8)]">
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
