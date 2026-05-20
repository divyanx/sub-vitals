// src/client/components/ui/Badge.tsx
import type React from 'react';

export type BadgeVariant = 'neutral' | 'success' | 'warn' | 'error' | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  /** Shows a colored dot before the label. */
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--n-4)] text-[var(--n-10)]',
  success: 'bg-[var(--success-3)] text-[var(--success-11)]',
  warn: 'bg-[var(--warn-3)] text-[var(--warn-11)]',
  error: 'bg-[var(--error-3)] text-[var(--error-11)]',
  accent: 'bg-[var(--accent-3)] text-[var(--accent-11)]',
};

const dotClass: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--n-8)]',
  success: 'bg-[var(--success-9)]',
  warn: 'bg-[var(--warn-9)]',
  error: 'bg-[var(--error-9)]',
  accent: 'bg-[var(--accent-9)]',
};

export function Badge({ variant = 'neutral', dot = false, children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-[var(--r-full)] px-2 py-0.5',
        'text-[length:var(--t-xs)] font-medium',
        variantClass[variant],
        className,
      ].join(' ')}
    >
      {dot ? (
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass[variant]}`} />
      ) : null}
      {children}
    </span>
  );
}
