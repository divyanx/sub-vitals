/**
 * ShortcutsModal — ? key opens a quick-reference overlay of all shortcuts.
 */

import { KbdHint } from './KbdHint.tsx';

interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['⌘', 'K'], label: 'Open command palette' },
  { keys: ['?'], label: 'Show this help' },
  { keys: ['Esc'], label: 'Close modal / clear selection' },
  { keys: ['j'], label: 'Next row in Inbox queue' },
  { keys: ['k'], label: 'Previous row in Inbox queue' },
  { keys: ['g', ' ', 'i'], label: 'Go to Inbox' },
  { keys: ['g', ' ', 'p'], label: 'Go to Pulse (Overview)' },
  { keys: ['g', ' ', 'd'], label: 'Go to Drivers' },
  { keys: ['g', ' ', 's'], label: 'Go to Sentiment' },
  { keys: ['g', ' ', 'n'], label: 'Go to Incidents' },
  { keys: ['g', ' ', 't'], label: 'Go to Themes' },
  { keys: ['g', ' ', 'a'], label: 'Go to Agents' },
  { keys: ['g', ' ', 'e'], label: 'Go to Export' },
  { keys: ['g', ' ', 'u'], label: 'Go to Audit' },
  { keys: ['g', ' ', ','], label: 'Go to Settings' },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard shortcuts handled globally by tinykeys
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--text)]">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts"
            className="rounded text-[var(--text-muted)] transition hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="divide-y divide-[var(--border)] px-5 py-2 text-sm">
          {SHORTCUTS.map(({ keys, label }) => (
            <li key={label} className="flex items-center justify-between py-2">
              <span className="text-[var(--text)]">{label}</span>
              <KbdHint keys={keys} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
