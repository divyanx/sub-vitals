/**
 * KbdHint — renders keyboard shortcut badge(s).
 *
 * Usage:
 *   <KbdHint keys={['⌘', 'K']} />
 *   <KbdHint keys={['Esc']} />
 */

interface KbdHintProps {
  keys: string[];
  className?: string;
}

export function KbdHint({ keys, className = '' }: KbdHintProps) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-hidden="true">
      {keys.map((k, i) => {
        // Use compound key: symbol + index avoids duplicate key when same symbol appears twice
        const stableKey = `${k}__${i}`;
        return (
          <kbd
            key={stableKey}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--border)] bg-[var(--surface)] px-1 font-mono text-[10px] text-[var(--text-muted)] shadow-sm"
          >
            {k}
          </kbd>
        );
      })}
    </span>
  );
}
