// src/client/components/ui/Tabs.tsx
import type React from 'react';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  /** Optional badge count shown after the label. */
  badge?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** Additional class for the outer strip. */
  className?: string;
}

export function Tabs({ tabs, activeId, onChange, className = '' }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={[
        'flex gap-1 overflow-x-auto border-b border-[var(--n-4)]',
        'scrollbar-none [-webkit-overflow-scrolling:touch]',
        className,
      ].join(' ')}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={[
              'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5',
              'text-[length:var(--t-sm)] font-medium min-h-[44px]',
              'border-b-2 -mb-px transition-colors duration-[var(--dur-fast)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] focus-visible:ring-inset',
              isActive
                ? 'border-[var(--accent-9)] text-[var(--n-12)]'
                : 'border-transparent text-[var(--n-8)] hover:text-[var(--n-11)] hover:border-[var(--n-5)]',
            ].join(' ')}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 ? (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-[var(--r-full)] bg-[var(--accent-9)] px-1 text-[10px] font-semibold text-white tabular-nums">
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
