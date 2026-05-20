// src/client/components/ui/EmptyState.tsx
import type React from 'react';

export interface EmptyStateProps {
  /** Emoji or icon rendered large above the title. */
  icon?: string;
  title: string;
  body: string;
  cta?: React.ReactNode;
}

export function EmptyState({ icon, title, body, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-2)] px-6 py-12 text-center shadow-[var(--shadow-1)]">
      {icon ? (
        <span className="mb-4 text-4xl" aria-hidden="true" role="img">
          {icon}
        </span>
      ) : null}
      <h3 className="text-[length:var(--t-base)] font-semibold text-[var(--n-12)]">{title}</h3>
      <p className="mt-2 max-w-xs text-[length:var(--t-sm)] text-[var(--n-8)]">{body}</p>
      {cta ? <div className="mt-5">{cta}</div> : null}
    </div>
  );
}
