// src/client/components/ui/Card.tsx
import type React from 'react';

export type CardVariant = 'default' | 'subtle';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: React.ReactNode;
}

const paddingClass: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({ variant = 'default', padding = 'md', className = '', children }: CardProps) {
  return (
    <div
      className={[
        'rounded-[var(--r-3)] border',
        variant === 'default'
          ? 'border-[var(--n-4)] bg-[var(--n-2)] shadow-[var(--shadow-1)]'
          : 'border-[var(--n-3)] bg-[var(--n-1)]',
        paddingClass[padding],
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}
