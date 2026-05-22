/**
 * NavOverflow — "More ▾" dropdown for secondary nav tabs.
 * Renders a floating menu with the overflow tabs and their badges.
 */

import { useEffect, useRef, useState } from 'react';

export type OverflowTab = 'team' | 'audit' | 'lab' | 'export' | 'settings';

interface OverflowItem {
  id: OverflowTab;
  label: string;
}

const OVERFLOW_ITEMS: OverflowItem[] = [
  { id: 'team', label: 'Team' },
  { id: 'audit', label: 'Audit' },
  { id: 'lab', label: 'Lab' },
  { id: 'export', label: 'Export' },
  { id: 'settings', label: 'Settings' },
];

interface NavOverflowProps {
  activeTab: string;
  onSelect: (tab: OverflowTab) => void;
}

export function NavOverflow({ activeTab, onSelect }: NavOverflowProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = OVERFLOW_ITEMS.some((t) => t.id === activeTab);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`-mb-px flex flex-shrink-0 items-center gap-1 border-b-2 px-4 py-3 text-sm font-medium transition ${
          isActive
            ? 'border-[var(--accent-9)] text-[var(--text)]'
            : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
        }`}
      >
        More
        <span aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
        >
          {OVERFLOW_ITEMS.map((item) => {
            const isItemActive = activeTab === item.id;
            // badges: none defined for overflow items beyond what we may add later
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition hover:bg-[var(--bg)] ${
                  isItemActive ? 'font-medium text-[var(--accent-11)]' : 'text-[var(--text-muted)]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
