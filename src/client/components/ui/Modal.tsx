// src/client/components/ui/Modal.tsx
import type React from 'react';
import { useEffect, useRef } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Dialog title shown in the header. */
  title: string;
  /** Optional secondary description below the title. */
  description?: string;
  children: React.ReactNode;
  /** Buttons for the footer. If absent, no footer rendered. */
  footer?: React.ReactNode;
  /** Max width class. Default: 'max-w-lg' */
  maxWidth?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'max-w-lg',
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else {
      if (el.open) el.close();
    }
  }, [open]);

  // Close on backdrop click
  const onDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose();
  };

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === 'Escape') onClose();
  };

  // Sync native close event (Escape key)
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      onKeyDown={onDialogKeyDown}
      className={[
        'w-full rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-2)]',
        'shadow-[var(--shadow-2)] text-[var(--n-11)] p-0',
        'backdrop:bg-black/60',
        'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
        // Full-screen on mobile, centered on sm+
        'max-sm:inset-0 max-sm:m-0 max-sm:max-w-none max-sm:rounded-none max-sm:h-dvh max-sm:translate-x-0 max-sm:translate-y-0 max-sm:top-0 max-sm:left-0',
        maxWidth,
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-[var(--n-4)] px-6 py-4">
        <div>
          <h2 className="text-[length:var(--t-md)] font-semibold text-[var(--n-12)]">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[length:var(--t-sm)] text-[var(--n-8)]">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--r-2)] text-[var(--n-8)] hover:bg-[var(--n-4)] hover:text-[var(--n-11)] transition-colors"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
            <path d="M4.47 4.47a.75.75 0 0 1 1.06 0L8 6.94l2.47-2.47a.75.75 0 1 1 1.06 1.06L9.06 8l2.47 2.47a.75.75 0 1 1-1.06 1.06L8 9.06l-2.47 2.47a.75.75 0 0 1-1.06-1.06L6.94 8 4.47 5.53a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto px-6 py-5 max-h-[60dvh]">{children}</div>

      {/* Footer */}
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-[var(--n-4)] px-6 py-4">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
