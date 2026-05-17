/**
 * CommandPalette — ⌘K modal with type-ahead tab navigation.
 *
 * Commands: all dashboard tabs + saved view shortcuts.
 * Keyboard: ArrowUp/Down navigate, Enter selects, Esc closes.
 */

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KbdHint } from './KbdHint.tsx';

export interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      // Focus input after next paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [commands, query]);

  // Keep cursor in bounds when list changes
  useEffect(() => {
    setCursor((prev) => Math.min(prev, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const select = (cmd: Command) => {
    cmd.action();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[cursor];
      if (cmd) select(cmd);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  // Group commands for display
  const groups: Map<string, Command[]> = new Map();
  for (const cmd of filtered) {
    const list = groups.get(cmd.group) ?? [];
    list.push(cmd);
    groups.set(cmd.group, list);
  }

  // Build flat index for cursor navigation
  const flat = filtered;
  let flatCounter = 0;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by onKeyDown on the input
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <svg
            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-controls="cmd-palette-list"
            aria-autocomplete="list"
            aria-activedescendant={filtered[cursor] ? `cmd-${filtered[cursor]?.id}` : undefined}
            placeholder="Search tabs and actions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <KbdHint keys={['Esc']} />
        </div>

        {/* Results — using div+listbox pattern to avoid ul/li role conflicts */}
        <div
          ref={listRef}
          id="cmd-palette-list"
          role="listbox"
          className="max-h-72 overflow-y-auto py-1"
          aria-label="Commands"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Array.from(groups.entries()).map(([group, cmds]) => (
              <div key={group}>
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {group}
                </div>
                {cmds.map((cmd) => {
                  const idx = flat.indexOf(cmd);
                  const active = idx === cursor;
                  flatCounter++;
                  return (
                    <button
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-idx={idx}
                      className={`flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left text-sm transition ${
                        active
                          ? 'bg-[var(--accent)] text-white'
                          : 'text-[var(--text)] hover:bg-[var(--border)]'
                      }`}
                      onMouseEnter={() => setCursor(idx)}
                      onClick={() => select(cmd)}
                    >
                      <span>{cmd.label}</span>
                      {cmd.shortcut ? (
                        <KbdHint keys={cmd.shortcut} className={active ? 'opacity-75' : ''} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {/* Suppress unused variable warning for flatCounter */}
          {flatCounter > 0 ? null : null}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <KbdHint keys={['↑', '↓']} /> navigate
          </span>
          <span className="flex items-center gap-1">
            <KbdHint keys={['↵']} /> select
          </span>
          <span className="flex items-center gap-1">
            <KbdHint keys={['Esc']} /> close
          </span>
        </div>
      </div>
    </div>
  );
}
