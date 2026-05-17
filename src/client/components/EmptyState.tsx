/**
 * EmptyState — structured empty state component for all tabs.
 *
 * Usage:
 *   <EmptyState
 *     icon="📭"
 *     title="No open posts"
 *     body="New posts appear here as they're auto-tagged."
 *     cta={<button ...>Submit sample post</button>}
 *   />
 */

import type React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  body: string;
  cta?: React.ReactNode;
}

export function EmptyState({ icon, title, body, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
      {icon ? (
        <span className="mb-4 text-4xl" aria-hidden="true" role="img">
          {icon}
        </span>
      ) : null}
      <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-2 max-w-xs text-xs text-[var(--text-muted)]">{body}</p>
      {cta ? <div className="mt-5">{cta}</div> : null}
    </div>
  );
}
