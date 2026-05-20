// src/client/components/ui/Drawer.tsx
import type React from 'react';
import { useEffect } from 'react';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** 'right' (default) or 'bottom' */
  side?: 'right' | 'bottom';
}

export function Drawer({ open, onClose, title, children, side = 'right' }: DrawerProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const panelClass =
    side === 'right'
      ? 'fixed inset-y-0 right-0 flex flex-col w-full max-sm:inset-x-0 sm:max-w-md'
      : 'fixed inset-x-0 bottom-0 flex flex-col max-h-[85dvh] rounded-t-[var(--r-4)]';

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-label={title}
        className={[
          panelClass,
          'z-50 bg-[var(--n-2)] border-[var(--n-4)] shadow-[var(--shadow-3)]',
          side === 'right' ? 'border-l' : 'border-t',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-[var(--n-4)] px-5 py-4">
          <h2 className="text-[length:var(--t-md)] font-semibold text-[var(--n-12)]">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--r-2)] text-[var(--n-8)] hover:bg-[var(--n-4)] hover:text-[var(--n-11)] transition-colors"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M4.47 4.47a.75.75 0 0 1 1.06 0L8 6.94l2.47-2.47a.75.75 0 1 1 1.06 1.06L9.06 8l2.47 2.47a.75.75 0 1 1-1.06 1.06L8 9.06l-2.47 2.47a.75.75 0 0 1-1.06-1.06L6.94 8 4.47 5.53a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </>
  );
}
