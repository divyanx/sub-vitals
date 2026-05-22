/**
 * DriversConfig.tsx
 *
 * Taxonomy tree editor and per-driver routing section.
 * Moved here from Settings.tsx so that driver configuration lives with the
 * drivers data view, not in the global settings junk drawer.
 *
 * Exports:
 *   TaxonomyConfigSection  — full taxonomy editor (visual tree + JSON fallback)
 *   RoutingConfigSection   — per-driver modmail routing table
 *
 * Sprint 13 polish applied:
 *   1. Visual tree connectors (CSS pseudo-elements via inline class strategy)
 *   2. Collapse/expand chevron (independent from compact mode)
 *   3. "Add sub-driver" only on hover/focus; hidden at depth 3
 *   4. Move-to dropdown with indented options + "Move to top level"
 *   5. Color picker — swatch button + popover with 12 OKLCH presets
 *   6. Sticky breadcrumb showing currently-focused row path
 *   7. Compact card mode — global toggle + per-row expanded/collapsed editor
 *   8. Empty state CTA + tablist strip for Visual/JSON toggle
 */

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useId, useRef, useState } from 'react';
import { api } from '../lib/api.ts';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

let _rowCounter = 0;

interface TaxRow {
  _uid: number;
  id: string;
  label: string;
  color: string;
  description: string;
  keywords: string[];
  /** null = root driver */
  parentId: string | null;
}

interface RoutingRow {
  _uid: number;
  driver: string;
  subject: string;
  mentions: string;
}

// ---------------------------------------------------------------------------
// Shared UI primitives (duplicated deliberately — no cross-file primitive dep)
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  type: 'success' | 'error';
  msg: string;
}

let _toastCounter = 0;

export function useDriversToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const add = (type: ToastItem['type'], msg: string) => {
    const id = ++_toastCounter;
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
  return { toasts, toast: add };
}

export function DriversToastContainer({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <output
          key={t.id}
          className={`pointer-events-auto block max-w-sm rounded-[var(--r-3)] border px-4 py-3 text-sm shadow-[var(--shadow-2)] transition-all ${
            t.type === 'success'
              ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
              : 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]'
          }`}
        >
          {t.msg}
        </output>
      ))}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-6 shadow-[var(--shadow-1)]">
      <h3 className="mb-1 text-sm font-semibold text-[var(--n-11)]">{title}</h3>
      {description ? <p className="mb-4 text-xs text-[var(--n-8)]">{description}</p> : null}
      {children}
    </section>
  );
}

function SaveButton({
  onClick,
  loading,
  disabled,
}: {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="mt-6 flex justify-end border-t border-[var(--n-4)] pt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className="rounded-[var(--r-2)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-4 py-1.5 text-sm font-medium text-[var(--accent-11)] transition hover:bg-[var(--accent-3)] hover:opacity-80 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
      >
        {loading ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="mt-2 rounded-[var(--r-1)] border border-[var(--error-9)] bg-[var(--error-3)] px-3 py-2 text-xs text-[var(--error-11)]">
      {msg}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Color picker — 12 OKLCH Tailwind 4 presets + custom fallback
// ---------------------------------------------------------------------------

const COLOR_PRESETS: { label: string; value: string }[] = [
  { label: 'red-500', value: '#ef4444' },
  { label: 'orange-500', value: '#f97316' },
  { label: 'amber-500', value: '#f59e0b' },
  { label: 'yellow-500', value: '#eab308' },
  { label: 'lime-500', value: '#84cc16' },
  { label: 'green-500', value: '#22c55e' },
  { label: 'emerald-500', value: '#10b981' },
  { label: 'teal-500', value: '#14b8a6' },
  { label: 'sky-500', value: '#0ea5e9' },
  { label: 'indigo-500', value: '#6366f1' },
  { label: 'purple-500', value: '#a855f7' },
  { label: 'pink-500', value: '#ec4899' },
];

function ColorPickerPopover({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!popoverRef.current?.contains(e.relatedTarget as Node)) {
      close();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: blur delegation to wrapper needed for popover close
    <div className="relative inline-block" ref={popoverRef} onBlur={handleBlur}>
      <button
        type="button"
        aria-label={`Pick color — current: ${value}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 rounded-[var(--r-1)] border border-[var(--n-6)] shadow-[var(--shadow-1)] transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
        style={{ backgroundColor: value }}
        data-testid="color-swatch-btn"
      />
      {open ? (
        <div
          role="dialog"
          aria-label="Color picker"
          className="absolute left-0 top-8 z-40 w-52 rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-3 shadow-[var(--shadow-3)]"
          data-testid="color-picker-popover"
        >
          <p className="mb-2 text-xs font-medium text-[var(--n-8)]">Preset colors</p>
          <div className="mb-3 grid grid-cols-6 gap-1.5">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-label={p.label}
                title={p.label}
                onClick={() => {
                  onChange(p.value);
                  close();
                }}
                className={`h-6 w-6 rounded-[var(--r-1)] border transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)] ${
                  value === p.value ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: p.value }}
                data-testid={`color-preset-${p.label}`}
              />
            ))}
          </div>
          <p className="mb-1.5 text-xs font-medium text-[var(--n-8)]">Custom</p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 w-10 cursor-pointer rounded border border-[var(--n-4)] bg-[var(--n-3)] p-0.5"
              aria-label="Custom color"
            />
            <span className="font-mono text-xs text-[var(--n-11)]">{value}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxonomy parsing helpers
// ---------------------------------------------------------------------------

function parseTaxonomyRows(rawJson: string): TaxRow[] {
  if (rawJson.trim().length > 0) {
    try {
      const arr = JSON.parse(rawJson) as Array<{
        id: string;
        label: string;
        color?: string;
        description?: string;
        keywords?: string[];
        parentId?: string | null;
      }>;
      return arr.map((r) => ({
        _uid: ++_rowCounter,
        id: r.id ?? '',
        label: r.label ?? '',
        color: r.color ?? '#94a3b8',
        description: r.description ?? '',
        keywords: Array.isArray(r.keywords) ? r.keywords : [],
        parentId: r.parentId ?? null,
      }));
    } catch {
      /* fall through to default */
    }
  }
  return defaultTaxonomyRows();
}

function defaultTaxonomyRows(): TaxRow[] {
  return [
    {
      _uid: ++_rowCounter,
      id: 'bug',
      label: 'Bug / Issue Report',
      color: '#f87171',
      description: '',
      keywords: ['crash', 'broken', 'error', 'bug'],
      parentId: null,
    },
    {
      _uid: ++_rowCounter,
      id: 'feature',
      label: 'Feature Request',
      color: '#60a5fa',
      description: '',
      keywords: ['request', 'wish', 'add', 'would love'],
      parentId: null,
    },
    {
      _uid: ++_rowCounter,
      id: 'question',
      label: 'Question / How-to',
      color: '#fbbf24',
      description: '',
      keywords: ['how', 'help', 'can i', 'does it'],
      parentId: null,
    },
    {
      _uid: ++_rowCounter,
      id: 'billing',
      label: 'Billing / Account',
      color: '#a78bfa',
      description: '',
      keywords: ['charge', 'refund', 'invoice', 'subscription'],
      parentId: null,
    },
    {
      _uid: ++_rowCounter,
      id: 'praise',
      label: 'Praise / Feedback',
      color: '#4ade80',
      description: '',
      keywords: ['love', 'great', 'awesome', 'thank'],
      parentId: null,
    },
    {
      _uid: ++_rowCounter,
      id: 'complaint',
      label: 'Complaint',
      color: '#fb923c',
      description: '',
      keywords: ['disappointed', 'terrible', 'awful'],
      parentId: null,
    },
    {
      _uid: ++_rowCounter,
      id: 'other',
      label: 'Other',
      color: '#94a3b8',
      description: '',
      keywords: [],
      parentId: null,
    },
  ];
}

function rowsToJson(rows: TaxRow[]): string {
  return JSON.stringify(
    rows.map(({ _uid: _u, ...rest }) => ({ ...rest, parentId: rest.parentId ?? null })),
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/** Returns depth of a row in the tree (root = 1, child = 2, grandchild = 3). Capped at 3. */
function rowDepth(row: TaxRow, byId: Map<string, TaxRow>, visited = new Set<string>()): number {
  if (!row.parentId) return 1;
  if (visited.has(row.id)) return 1; // cycle guard
  const parent = byId.get(row.parentId);
  if (!parent) return 1; // dangling — treat as root for display
  visited.add(row.id);
  return Math.min(3, 1 + rowDepth(parent, byId, visited));
}

/**
 * Returns rows ordered for display: each root followed by its descendants.
 * Within each parent group, preserves the original array order.
 */
function treeOrder(rows: TaxRow[]): TaxRow[] {
  const childrenOf = new Map<string | null, TaxRow[]>();
  for (const r of rows) {
    const pid = r.parentId ?? null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)?.push(r);
  }

  const result: TaxRow[] = [];
  function visit(pid: string | null) {
    for (const r of childrenOf.get(pid) ?? []) {
      result.push(r);
      visit(r.id);
    }
  }
  // Also include any dangling nodes (parentId points to unknown id) as roots
  const knownIds = new Set(rows.map((r) => r.id));
  const danglingRoots = rows.filter((r) => r.parentId && !knownIds.has(r.parentId));
  visit(null);
  for (const d of danglingRoots) {
    if (!result.includes(d)) result.push(d);
  }
  return result;
}

/** Build the ancestor chain from a row up to root, returning labels. */
function buildBreadcrumb(row: TaxRow, byId: Map<string, TaxRow>): string[] {
  const parts: string[] = [];
  let current: TaxRow | undefined = row;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    parts.unshift(current.label || current.id || '…');
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Delete confirmation modal
// ---------------------------------------------------------------------------

function DeleteConfirmModal({
  label,
  hasChildren,
  onConfirm,
  onCancel,
}: {
  label: string;
  hasChildren: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] p-6 shadow-[var(--shadow-3)]">
        <h4 className="mb-2 text-sm font-semibold text-[var(--n-11)]">Delete driver?</h4>
        <p className="mb-5 text-xs text-[var(--n-8)]">
          Remove <span className="font-medium text-[var(--n-11)]">&ldquo;{label}&rdquo;</span> from
          the taxonomy. Posts already tagged with this driver retain their tag.
          {hasChildren ? (
            <span className="mt-2 block text-[var(--warn-11)]">
              Warning: this driver has children. They will become root drivers.
            </span>
          ) : null}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-1.5 text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[var(--r-2)] border border-[var(--error-9)] bg-[var(--error-3)] px-3 py-1.5 text-xs font-medium text-[var(--error-11)] hover:opacity-80"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keywords chip input
// ---------------------------------------------------------------------------

function KeywordsInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (kw: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  const addKeyword = () => {
    const kw = draft.trim().toLowerCase();
    if (kw && !keywords.includes(kw)) onChange([...keywords, kw]);
    setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    } else if (e.key === 'Backspace' && draft === '' && keywords.length > 0) {
      onChange(keywords.slice(0, -1));
    }
  };

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-[var(--n-8)]">
        Keywords
      </label>
      <div className="flex flex-wrap gap-1 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1.5 focus-within:border-[var(--accent-9)]">
        {keywords.map((kw) => (
          <span
            key={kw}
            className="flex items-center gap-1 rounded-[var(--r-1)] bg-[var(--n-4)] px-2 py-0.5 text-xs text-[var(--n-11)]"
          >
            {kw}
            <button
              type="button"
              aria-label={`Remove keyword ${kw}`}
              onClick={() => onChange(keywords.filter((k) => k !== kw))}
              className="ml-0.5 text-[var(--n-8)] hover:text-[var(--error-11)]"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={addKeyword}
          placeholder={keywords.length === 0 ? 'Type keyword, press Enter' : ''}
          className="min-w-24 flex-1 bg-transparent text-xs text-[var(--n-11)] outline-none placeholder:text-[var(--n-8)]"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single driver row (tree-aware) — supports compact + collapse independently
// ---------------------------------------------------------------------------

function DriverTreeRow({
  row,
  depth,
  allRows,
  isCollapsed,
  hasChildren,
  isCompact,
  onToggleCollapse,
  onUpdate,
  onDelete,
  onAddChild,
  onMoveTo,
  onFocus,
}: {
  row: TaxRow;
  depth: number;
  allRows: TaxRow[];
  isCollapsed: boolean;
  hasChildren: boolean;
  isCompact: boolean;
  onToggleCollapse: (uid: number) => void;
  onUpdate: (uid: number, field: keyof Omit<TaxRow, '_uid'>, val: string | string[] | null) => void;
  onDelete: (uid: number) => void;
  onAddChild: (parentUid: number) => void;
  onMoveTo: (uid: number, newParentId: string | null) => void;
  onFocus: (uid: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const moveMenuRef = useRef<HTMLDivElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row._uid,
  });

  const INDENT_PX = 28;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Possible move targets: any node that is not self, not a descendant, and would not exceed depth 3
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const descendants = new Set<string>();
  function collectDescendants(id: string) {
    for (const r of allRows) {
      if (r.parentId === id && !descendants.has(r.id)) {
        descendants.add(r.id);
        collectDescendants(r.id);
      }
    }
  }
  collectDescendants(row.id);

  const moveTargets = allRows.filter(
    (r) => r.id !== row.id && !descendants.has(r.id) && rowDepth(r, byId) < 3,
  );

  const handleMoveFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!moveMenuRef.current?.contains(e.relatedTarget as Node)) {
      setShowMoveMenu(false);
    }
  };

  // Compact summary: chevron + color dot + label + post count badge + edit pencil
  if (isCompact) {
    return (
      <>
        {confirmDelete ? (
          <DeleteConfirmModal
            label={row.label || row.id}
            hasChildren={hasChildren}
            onConfirm={() => {
              setConfirmDelete(false);
              onDelete(row._uid);
            }}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : null}

        {/* Tree connector + row wrapper */}
        <div
          ref={setNodeRef}
          style={style}
          className="relative"
          data-testid={`driver-compact-row-${row._uid}`}
        >
          {/* Vertical guide line for non-root rows */}
          {depth > 1 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-0 bottom-0 border-l border-[var(--n-4)]"
              style={{ left: `${(depth - 2) * INDENT_PX + 8}px` }}
            />
          ) : null}
          {/* Horizontal connector */}
          {depth > 1 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 border-t border-[var(--n-4)]"
              style={{
                left: `${(depth - 2) * INDENT_PX + 8}px`,
                width: `${INDENT_PX - 8}px`,
              }}
            />
          ) : null}

          {/* biome-ignore lint/a11y/noStaticElementInteractions: focus tracking wrapper for breadcrumb, children are interactive */}
          <div
            className="group mb-1.5 flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-1)]/60 px-3 py-2 transition hover:border-[var(--n-6)]"
            style={{ marginLeft: `${(depth - 1) * INDENT_PX}px` }}
            onFocus={() => onFocus(row._uid)}
          >
            {/* Collapse chevron */}
            <button
              type="button"
              onClick={() => onToggleCollapse(row._uid)}
              aria-label={isCollapsed ? 'Expand children' : 'Collapse children'}
              data-testid={`chevron-${row._uid}`}
              className={`shrink-0 text-xs text-[var(--n-8)] transition hover:text-[var(--n-11)] ${!hasChildren ? 'invisible' : ''}`}
            >
              {isCollapsed ? '▶' : '▼'}
            </button>

            {/* Color dot */}
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-white/10"
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />

            {/* Label */}
            <span className="flex-1 truncate text-xs font-medium text-[var(--n-11)]">
              {row.label || <span className="text-[var(--n-8)] italic">Untitled</span>}
            </span>

            {/* Post count badge */}
            <span className="rounded-full bg-[var(--n-3)] px-2 py-0.5 text-xs text-[var(--n-8)]">
              0
            </span>

            {/* Edit pencil */}
            <button
              type="button"
              aria-label={`Edit driver ${row.label || row.id}`}
              className="shrink-0 text-[var(--n-8)] opacity-0 transition hover:text-[var(--accent-11)] group-hover:opacity-100 focus:opacity-100"
              onClick={() => onFocus(row._uid)}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.609zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354L12.427 2.487zm.979 2.914L11.967 3.962 4.312 11.617a.483.483 0 0 0-.12.21L3.35 14.05l2.223-.636a.483.483 0 0 0 .21-.12l7.623-7.623z" />
              </svg>
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete driver ${row.label || row.id}`}
              className="shrink-0 text-xs text-[var(--n-8)] opacity-0 transition hover:text-[var(--error-11)] group-hover:opacity-100 focus:opacity-100"
            >
              &times;
            </button>
          </div>
        </div>
      </>
    );
  }

  // Expanded (full editor) mode
  return (
    <>
      {confirmDelete ? (
        <DeleteConfirmModal
          label={row.label || row.id}
          hasChildren={hasChildren}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(row._uid);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: focus tracking container for breadcrumb; child inputs are interactive */}
      <div
        ref={setNodeRef}
        style={style}
        className="relative mb-2"
        onFocus={() => onFocus(row._uid)}
        data-testid={`driver-row-${row._uid}`}
      >
        {/* Vertical tree guide line */}
        {depth > 1 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 border-l border-[var(--n-4)]"
            style={{ left: `${(depth - 2) * INDENT_PX + 8}px` }}
          />
        ) : null}
        {/* Horizontal connector into row */}
        {depth > 1 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute border-t border-[var(--n-4)]"
            style={{
              top: '22px',
              left: `${(depth - 2) * INDENT_PX + 8}px`,
              width: `${INDENT_PX - 8}px`,
            }}
          />
        ) : null}

        <div
          className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-1)]/60 p-3"
          style={{ marginLeft: `${(depth - 1) * INDENT_PX}px` }}
        >
          <div className="flex items-start gap-2">
            {/* Collapse/expand chevron — controls subtree visibility only */}
            <button
              type="button"
              onClick={() => onToggleCollapse(row._uid)}
              aria-label={isCollapsed ? 'Expand children' : 'Collapse children'}
              data-testid={`chevron-${row._uid}`}
              className={`mt-1 shrink-0 text-xs text-[var(--n-8)] transition hover:text-[var(--n-11)] ${!hasChildren ? 'invisible' : ''}`}
            >
              {isCollapsed ? '▶' : '▼'}
            </button>

            {/* Drag handle */}
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label="Drag to reorder"
              className="mt-1 cursor-grab touch-none text-[var(--n-8)] hover:text-[var(--n-11)] active:cursor-grabbing"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="4" cy="3" r="1.2" />
                <circle cx="4" cy="7" r="1.2" />
                <circle cx="4" cy="11" r="1.2" />
                <circle cx="10" cy="3" r="1.2" />
                <circle cx="10" cy="7" r="1.2" />
                <circle cx="10" cy="11" r="1.2" />
              </svg>
            </button>

            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-[var(--n-8)]">
                    ID
                    <input
                      value={row.id}
                      onChange={(e) => onUpdate(row._uid, 'id', e.target.value)}
                      placeholder="bug"
                      data-testid={`driver-row-id-${row._uid}`}
                      className="mt-1 w-full rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-xs text-[var(--n-11)] outline-none focus:border-[var(--accent-9)]"
                    />
                  </label>
                </div>
                <div className="col-span-2">
                  <label className="mb-0.5 block text-xs font-medium text-[var(--n-8)]">
                    Label
                    <input
                      value={row.label}
                      onChange={(e) => onUpdate(row._uid, 'label', e.target.value)}
                      placeholder="Bug / Issue Report"
                      className="mt-1 w-full rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-xs text-[var(--n-11)] outline-none focus:border-[var(--accent-9)]"
                    />
                  </label>
                </div>
                <div>
                  <span className="mb-0.5 block text-xs font-medium text-[var(--n-8)]">Color</span>
                  <div className="mt-1 flex items-center gap-2">
                    <ColorPickerPopover
                      value={row.color}
                      onChange={(v) => onUpdate(row._uid, 'color', v)}
                    />
                    <span className="font-mono text-xs text-[var(--n-8)]">{row.color}</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--n-8)]">
                  Description
                  <textarea
                    value={row.description}
                    onChange={(e) => onUpdate(row._uid, 'description', e.target.value)}
                    placeholder="Optional"
                    rows={1}
                    className="mt-0.5 w-full resize-none rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-xs text-[var(--n-11)] outline-none focus:border-[var(--accent-9)]"
                  />
                </label>
              </div>
              <KeywordsInput
                keywords={row.keywords}
                onChange={(kw) => onUpdate(row._uid, 'keywords', kw)}
              />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {/* Add sub-driver — only visible on hover/focus; hidden entirely at depth 3 */}
                {depth < 3 ? (
                  <button
                    type="button"
                    onClick={() => onAddChild(row._uid)}
                    data-testid={`add-sub-driver-${row._uid}`}
                    className="text-xs text-[var(--n-8)] opacity-0 underline-offset-2 transition hover:text-[var(--accent-11)] hover:underline group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
                    aria-label={`Add sub-driver under ${row.label || row.id}`}
                  >
                    + Add sub-driver
                  </button>
                ) : null}

                {/* Move to… dropdown with depth-indented options */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: blur delegation wrapper for move-to dropdown */}
                <div className="relative" ref={moveMenuRef} onBlur={handleMoveFocus}>
                  <button
                    type="button"
                    onClick={() => setShowMoveMenu((v) => !v)}
                    data-testid={`move-to-${row._uid}`}
                    className="text-xs text-[var(--n-8)] underline-offset-2 hover:text-[var(--accent-11)] hover:underline"
                    aria-haspopup="listbox"
                    aria-expanded={showMoveMenu}
                  >
                    Move to…
                  </button>
                  {showMoveMenu ? (
                    <div
                      role="listbox"
                      aria-label="Move driver to"
                      className="absolute left-0 top-full z-30 mt-1 min-w-48 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] p-1 shadow-[var(--shadow-2)]"
                    >
                      {/* "Move to top level" as first dedicated action */}
                      <button
                        type="button"
                        role="option"
                        aria-selected={row.parentId === null}
                        className="flex w-full items-center gap-1.5 rounded px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
                        onClick={() => {
                          onMoveTo(row._uid, null);
                          setShowMoveMenu(false);
                        }}
                      >
                        <span className="text-[var(--n-8)]">↑</span>
                        Move to top level
                      </button>
                      <div className="my-1 border-t border-[var(--n-4)]" />
                      {moveTargets.map((t) => {
                        const byIdMap = new Map(allRows.map((r) => [r.id, r]));
                        const targetDepth = rowDepth(t, byIdMap);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            role="option"
                            aria-selected={row.parentId === t.id}
                            className="flex w-full items-center rounded px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
                            style={{ paddingLeft: `${8 + (targetDepth - 1) * 12}px` }}
                            onClick={() => {
                              onMoveTo(row._uid, t.id);
                              setShowMoveMenu(false);
                            }}
                          >
                            {t.label || t.id}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {/* Parent badge */}
                {row.parentId ? (
                  <span className="rounded bg-[var(--n-3)] px-1.5 py-0.5 text-xs text-[var(--n-8)]">
                    child of <span className="text-[var(--n-11)]">{row.parentId}</span>
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              aria-label={`Delete driver ${row.label || row.id}`}
              className="mt-1 text-xs text-[var(--n-8)] hover:text-[var(--error-11)]"
              title="Delete driver"
            >
              &times;
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sticky breadcrumb bar
// ---------------------------------------------------------------------------

function StickyBreadcrumb({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null;
  return (
    <nav
      aria-label="Currently editing"
      className="sticky top-0 z-20 -mx-6 mb-3 flex items-center gap-1.5 border-b border-[var(--n-4)] bg-[var(--n-2)] px-6 py-2 backdrop-blur-sm"
      data-testid="sticky-breadcrumb"
    >
      <span className="text-xs text-[var(--n-8)]">Editing:</span>
      {parts.map((part) => (
        <span key={part} className="flex items-center gap-1.5">
          {parts.indexOf(part) > 0 ? <span className="text-[var(--n-6)]">›</span> : null}
          <span className="text-xs font-medium text-[var(--n-11)]">{part}</span>
        </span>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Empty state CTA
// ---------------------------------------------------------------------------

function TaxonomyEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[var(--r-3)] border-2 border-dashed border-[var(--n-4)] bg-[var(--n-1)]/30 py-14 text-center"
      data-testid="taxonomy-empty-state"
    >
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--n-3)]">
        <svg
          width="22"
          height="22"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--n-8)]"
          aria-hidden="true"
        >
          <path d="M3 4h14M3 8h8M3 12h5" strokeLinecap="round" />
          <circle cx="15" cy="14" r="4" />
          <path d="M15 12v4M13 14h4" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mb-1 text-sm font-medium text-[var(--n-11)]">No drivers yet</p>
      <p className="mb-5 max-w-xs text-xs text-[var(--n-8)]">
        Create your first contact driver category. Posts will be auto-tagged based on keywords you
        define.
      </p>
      <button
        type="button"
        onClick={onAdd}
        data-testid="taxonomy-add-first-driver"
        className="rounded-[var(--r-2)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-4 py-2 text-sm font-medium text-[var(--accent-11)] transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
      >
        + Add first driver
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preview bar
// ---------------------------------------------------------------------------

function TaxonomyPreview({ rows }: { rows: TaxRow[] }) {
  const roots = rows.filter((r) => !r.parentId);
  if (roots.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--n-4)] bg-[var(--n-1)]/40 px-3 py-2">
      <span className="text-xs text-[var(--n-8)]">Current drivers:</span>
      {roots
        .filter((r) => r.label || r.id)
        .map((r) => (
          <span
            key={r._uid}
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `${r.color}22`,
              color: r.color,
              border: `1px solid ${r.color}55`,
            }}
          >
            {r.label || r.id}
          </span>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taxonomy template marketplace
// ---------------------------------------------------------------------------

type TemplateId = 'ecommerce' | 'saas' | 'hardware' | 'gaming' | 'finance' | 'media';

interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  driverCount: number;
  deepestDepth: number;
}

function TemplateApplyDialog({
  template,
  onClose,
  onConfirm,
  loading,
}: {
  template: TemplateMeta;
  onClose: () => void;
  onConfirm: (mode: 'replace' | 'merge') => void;
  loading: boolean;
}) {
  const [applyMode, setApplyMode] = useState<'replace' | 'merge'>('replace');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Apply ${template.name} template`}
    >
      <div className="w-full max-w-md rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] shadow-[var(--shadow-3)]">
        <div className="border-b border-[var(--n-4)] px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--n-11)]">
            Apply "{template.name}" template
          </h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--r-2)] border border-[var(--n-4)] p-3 hover:border-[var(--accent-9)]/60">
            <input
              type="radio"
              name="apply-mode"
              value="replace"
              checked={applyMode === 'replace'}
              onChange={() => setApplyMode('replace')}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-[var(--n-11)]">Replace</p>
              <p className="text-xs text-[var(--n-8)]">
                Overwrites your current taxonomy with the template.
              </p>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-[var(--r-2)] border border-[var(--n-4)] p-3 hover:border-[var(--accent-9)]/60">
            <input
              type="radio"
              name="apply-mode"
              value="merge"
              checked={applyMode === 'merge'}
              onChange={() => setApplyMode('merge')}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-medium text-[var(--n-11)]">Merge</p>
              <p className="text-xs text-[var(--n-8)]">
                Keeps your existing drivers and adds template drivers that don't conflict.
              </p>
            </div>
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-[var(--n-4)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-[var(--r-2)] border border-[var(--n-4)] px-4 py-1.5 text-sm text-[var(--n-11)] hover:bg-[var(--n-3)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(applyMode)}
            disabled={loading}
            data-testid="apply-template-confirm-btn"
            className="rounded-[var(--r-2)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-4 py-1.5 text-sm font-medium text-[var(--accent-11)] hover:opacity-80 disabled:opacity-50"
          >
            {loading ? 'Applying…' : 'Apply template'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onPreview,
  onApply,
}: {
  template: TemplateMeta;
  onPreview: () => void;
  onApply: () => void;
}) {
  return (
    <div
      className="flex flex-col rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] p-4 hover:border-[var(--accent-9)]/50 transition shadow-[var(--shadow-1)]"
      data-testid={`template-card-${template.id}`}
    >
      <h4 className="mb-1 text-sm font-semibold text-[var(--n-11)]">{template.name}</h4>
      <p className="mb-3 grow text-xs text-[var(--n-8)] leading-relaxed">{template.description}</p>
      <div className="mb-3 flex items-center gap-3 text-xs text-[var(--n-8)]">
        <span>{template.driverCount} drivers</span>
        <span>·</span>
        <span>{template.deepestDepth} levels deep</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPreview}
          className="rounded-[var(--r-1)] border border-[var(--n-5)] px-3 py-1 text-xs text-[var(--n-11)] hover:border-[var(--n-7)] hover:text-[var(--n-11)] transition"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onApply}
          data-testid={`apply-template-btn-${template.id}`}
          className="rounded-[var(--r-1)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-3 py-1 text-xs font-medium text-[var(--accent-11)] hover:opacity-80 transition"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function TaxonomyTemplatesSection({
  hasExistingTaxonomy,
  toast,
  onApplied,
  editorScrollRef,
}: {
  hasExistingTaxonomy: boolean;
  toast: (type: 'success' | 'error', msg: string) => void;
  onApplied: () => void;
  editorScrollRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(!hasExistingTaxonomy);
  const [applyTarget, setApplyTarget] = useState<TemplateMeta | null>(null);
  const [applying, setApplying] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['taxonomy-templates'],
    queryFn: () => api.taxonomyTemplates.list(),
    staleTime: 5 * 60 * 1000,
  });

  const templates = data?.templates ?? [];

  // Lazy-load preview nodes from the JSON files via the template endpoint
  // We'll fetch from a data URL since they're bundled. For simplicity, use the
  // existing api.taxonomy.applyTemplate in dry-run isn't available, so we'll
  // just show a placeholder message and use the template meta.
  const openPreview = (tmpl: TemplateMeta) => {
    // Preview just opens the apply dialog with full template info
    setApplyTarget(tmpl);
  };

  const handleApply = async (mode: 'replace' | 'merge') => {
    if (!applyTarget) return;
    setApplying(true);
    try {
      const result = await api.taxonomyTemplates.apply(applyTarget.id as TemplateId, mode);
      setApplyTarget(null);
      toast('success', `Applied "${applyTarget.name}" template — ${result.driverCount} drivers`);
      onApplied();
      setTimeout(() => {
        editorScrollRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to apply template');
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      {applyTarget ? (
        <TemplateApplyDialog
          template={applyTarget}
          onClose={() => setApplyTarget(null)}
          onConfirm={handleApply}
          loading={applying}
        />
      ) : null}
      <div className="mb-6 rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          aria-expanded={open}
          data-testid="templates-section-toggle"
        >
          <div>
            <span className="text-sm font-semibold text-[var(--n-11)]">Templates</span>
            <span className="ml-2 text-xs text-[var(--n-8)]">Start with a pre-built taxonomy</span>
          </div>
          <span
            className={`text-xs text-[var(--n-8)] transition-transform ${open ? 'rotate-180' : ''}`}
          >
            ▼
          </span>
        </button>
        {open ? (
          <div className="border-t border-[var(--n-4)] px-4 pb-4 pt-3">
            {isLoading ? (
              <p className="text-xs text-[var(--n-8)]">Loading templates…</p>
            ) : (
              <div
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="templates-grid"
              >
                {templates.map((tmpl) => (
                  <TemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    onPreview={() => openPreview(tmpl)}
                    onApply={() => setApplyTarget(tmpl)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Taxonomy config section (exported)
// ---------------------------------------------------------------------------

export function TaxonomyConfigSection({
  taxonomyJson,
  toast,
  onSaved,
}: {
  taxonomyJson: string;
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<TaxRow[]>(() => parseTaxonomyRows(taxonomyJson));
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState(() => rowsToJson(parseTaxonomyRows(taxonomyJson)));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [compactAll, setCompactAll] = useState(false);
  const [focusedUid, setFocusedUid] = useState<number | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const switchMode = (next: 'visual' | 'json') => {
    if (next === 'json') {
      setJsonText(rowsToJson(rows));
      setJsonError(null);
    } else {
      try {
        setRows(parseTaxonomyRows(jsonText));
        setJsonError(null);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
    }
    setMode(next);
  };

  const update = (
    uid: number,
    field: keyof Omit<TaxRow, '_uid'>,
    val: string | string[] | null,
  ) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, [field]: val } : r)));
  };

  const addRoot = () => {
    const newRow: TaxRow = {
      _uid: ++_rowCounter,
      id: '',
      label: '',
      color: '#94a3b8',
      description: '',
      keywords: [],
      parentId: null,
    };
    setRows((prev) => [...prev, newRow]);
    setFocusedUid(newRow._uid);
    if (compactAll) setCompactAll(false);
  };

  const addChild = (parentUid: number) => {
    const parent = rows.find((r) => r._uid === parentUid);
    if (!parent) return;
    const newRow: TaxRow = {
      _uid: ++_rowCounter,
      id: '',
      label: '',
      color: parent.color,
      description: '',
      keywords: [],
      parentId: parent.id,
    };
    // Insert right after last existing child of this parent in the flat array
    const parentIdx = rows.findIndex((r) => r._uid === parentUid);
    setRows((prev) => {
      const next = [...prev];
      let insertAt = parentIdx + 1;
      for (let i = parentIdx + 1; i < next.length; i++) {
        if (next[i]?.parentId === parent.id) insertAt = i + 1;
      }
      next.splice(insertAt, 0, newRow);
      return next;
    });
    // Auto-expand parent
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(parentUid);
      return next;
    });
    setFocusedUid(newRow._uid);
    if (compactAll) setCompactAll(false);
  };

  const removeRow = (uid: number) => {
    setRows((prev) => {
      const row = prev.find((r) => r._uid === uid);
      if (!row) return prev;
      return prev
        .filter((r) => r._uid !== uid)
        .map((r) => (r.parentId === row.id ? { ...r, parentId: null } : r));
    });
    if (focusedUid === uid) setFocusedUid(null);
  };

  const moveTo = (uid: number, newParentId: string | null) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, parentId: newParentId } : r)));
  };

  const toggleCollapse = (uid: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRows((prev) => {
        const oldIndex = prev.findIndex((r) => r._uid === active.id);
        const newIndex = prev.findIndex((r) => r._uid === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const onJsonBlur = () => {
    try {
      JSON.parse(jsonText);
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const mut = useMutation({
    mutationFn: () => {
      const payload =
        mode === 'json'
          ? jsonText
          : JSON.stringify(
              rows.map(({ _uid: _u, ...rest }) => ({ ...rest, parentId: rest.parentId ?? null })),
            );
      return api.settings.put({ 'taxonomy-json': payload });
    },
    onSuccess: () => {
      setSaveError(null);
      toast('success', 'Taxonomy saved.');
      void qc.invalidateQueries({ queryKey: ['taxonomy'] });
      onSaved();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const orderedRows = treeOrder(rows);
  const childrenOf = new Map<string | null, Set<number>>();
  for (const r of rows) {
    const pid = r.parentId ?? null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, new Set());
    childrenOf.get(pid)?.add(r._uid);
  }

  // Compute which uids are hidden (ancestors are collapsed)
  const hiddenUids = new Set<number>();
  for (const r of orderedRows) {
    if (!r.parentId) continue;
    const parentRow = rows.find((p) => p.id === r.parentId);
    if (!parentRow) continue;
    if (collapsed.has(parentRow._uid) || hiddenUids.has(parentRow._uid)) {
      hiddenUids.add(r._uid);
    }
  }

  // Breadcrumb for focused row
  const focusedRow = focusedUid !== null ? rows.find((r) => r._uid === focusedUid) : undefined;
  const breadcrumbParts = focusedRow ? buildBreadcrumb(focusedRow, byId) : [];

  const tabId = useId();

  return (
    <Section
      title="Contact driver taxonomy"
      description="Define the issue categories used for tagging posts. Children indent under parents. Changes take effect on the next auto-tagged post."
    >
      {/* Templates marketplace — shown above editor */}
      <TaxonomyTemplatesSection
        hasExistingTaxonomy={rows.length > 0}
        toast={toast}
        onApplied={() => {
          // After apply, invalidate the settings query and reload rows from server
          void qc.invalidateQueries({ queryKey: ['settings'] });
          onSaved();
        }}
        editorScrollRef={editorRef}
      />

      {/* Tab strip: Visual / JSON — role="tablist" */}
      <div ref={editorRef} className="mb-4 flex items-center justify-between gap-4">
        <TaxonomyPreview rows={rows} />
        <div
          role="tablist"
          aria-label="Taxonomy editor mode"
          className="ml-auto flex shrink-0 gap-0.5 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-1)] p-0.5"
        >
          <button
            role="tab"
            aria-selected={mode === 'visual'}
            aria-controls={`${tabId}-visual`}
            id={`${tabId}-tab-visual`}
            type="button"
            onClick={() => switchMode('visual')}
            className={`rounded-[var(--r-1)] px-3 py-1 text-xs font-medium transition ${mode === 'visual' ? 'bg-[var(--accent-3)] text-[var(--accent-11)]' : 'text-[var(--n-8)] hover:text-[var(--n-11)]'}`}
          >
            Visual
          </button>
          <button
            role="tab"
            aria-selected={mode === 'json'}
            aria-controls={`${tabId}-json`}
            id={`${tabId}-tab-json`}
            type="button"
            onClick={() => switchMode('json')}
            data-testid="taxonomy-json-toggle"
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${mode === 'json' ? 'bg-[var(--accent-3)] text-[var(--accent-11)]' : 'text-[var(--n-8)] hover:text-[var(--n-11)]'}`}
          >
            JSON
          </button>
        </div>
      </div>

      {/* Visual tab panel */}
      <div
        role="tabpanel"
        id={`${tabId}-visual`}
        aria-labelledby={`${tabId}-tab-visual`}
        hidden={mode !== 'visual'}
      >
        {rows.length === 0 ? (
          <TaxonomyEmptyState onAdd={addRoot} />
        ) : (
          <>
            {/* Global compact toggle + breadcrumb */}
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCompactAll((v) => !v)}
                data-testid="compact-mode-toggle"
                className="flex items-center gap-1.5 rounded-md border border-[var(--n-4)] bg-[var(--n-3)] px-2.5 py-1 text-xs text-[var(--n-8)] transition hover:border-neutral-600 hover:text-[var(--n-11)]"
                aria-pressed={compactAll}
              >
                {compactAll ? (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v9A1.5 1.5 0 0 1 13.5 14h-11A1.5 1.5 0 0 1 1 12.5v-9zm1.5-.5a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-11z" />
                    </svg>
                    Show all expanded
                  </>
                ) : (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h11A1.5 1.5 0 0 1 15 3.5v2A1.5 1.5 0 0 1 13.5 7h-11A1.5 1.5 0 0 1 1 5.5v-2z" />
                    </svg>
                    Show all compact
                  </>
                )}
              </button>
            </div>

            {/* Sticky breadcrumb — appears when a row is focused */}
            <StickyBreadcrumb parts={breadcrumbParts} />

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedRows.map((r) => r._uid)}
                strategy={verticalListSortingStrategy}
              >
                <div data-testid="taxonomy-driver-list" className="group">
                  {orderedRows.map((row) => {
                    if (hiddenUids.has(row._uid)) return null;
                    const depth = rowDepth(row, byId);
                    const hasChildren = (childrenOf.get(row.id)?.size ?? 0) > 0;
                    return (
                      <DriverTreeRow
                        key={row._uid}
                        row={row}
                        depth={depth}
                        allRows={rows}
                        isCollapsed={collapsed.has(row._uid)}
                        hasChildren={hasChildren}
                        isCompact={compactAll}
                        onToggleCollapse={toggleCollapse}
                        onUpdate={update}
                        onDelete={removeRow}
                        onAddChild={addChild}
                        onMoveTo={moveTo}
                        onFocus={setFocusedUid}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
            <button
              type="button"
              onClick={addRoot}
              data-testid="taxonomy-add-driver"
              className="mt-4 text-xs text-[var(--n-8)] underline-offset-2 hover:text-[var(--accent-11)] hover:underline"
            >
              + Add root driver
            </button>
          </>
        )}
      </div>

      {/* JSON tab panel */}
      <div
        role="tabpanel"
        id={`${tabId}-json`}
        aria-labelledby={`${tabId}-tab-json`}
        hidden={mode !== 'json'}
      >
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          onBlur={onJsonBlur}
          rows={16}
          className="w-full resize-y rounded-md border border-[var(--n-4)] bg-[var(--n-3)] px-3 py-2 font-mono text-xs text-[var(--n-11)] outline-none focus:border-orange-500"
          aria-label="Taxonomy JSON editor"
          data-testid="taxonomy-json-editor"
        />
        {jsonError ? (
          <div className="mt-2 rounded border border-[var(--warn-9)] bg-[var(--warn-3)] px-3 py-2 text-xs text-[var(--warn-11)]">
            JSON parse error: {jsonError}
          </div>
        ) : null}
      </div>

      <FieldError msg={saveError} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} disabled={!!jsonError} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Routing config section (exported)
// ---------------------------------------------------------------------------

function parseRoutingRows(routingJson: string): RoutingRow[] {
  if (routingJson.trim().length > 0) {
    try {
      const obj = JSON.parse(routingJson) as Record<
        string,
        { subject?: string; mentions?: string[] }
      >;
      return Object.entries(obj).map(([driver, rule]) => ({
        _uid: ++_rowCounter,
        driver,
        subject: rule.subject ?? '',
        mentions: (rule.mentions ?? []).join(', '),
      }));
    } catch {
      /* fall through */
    }
  }
  return [];
}

function rowsToRoutingJson(rows: RoutingRow[]): string {
  const obj: Record<string, { subject?: string; mentions?: string[] }> = {};
  for (const r of rows) {
    if (!r.driver) continue;
    const mentions = r.mentions
      .split(/[\s,]+/)
      .map((u) => u.replace(/^@/, '').replace(/^u\//, '').trim())
      .filter(Boolean);
    obj[r.driver] = {
      ...(r.subject.trim() ? { subject: r.subject.trim() } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
    };
  }
  return JSON.stringify(obj);
}

export function RoutingConfigSection({
  routingJson,
  toast,
  onSaved,
}: {
  routingJson: string;
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<RoutingRow[]>(() => parseRoutingRows(routingJson));
  const [error, setError] = useState<string | null>(null);

  const update = (uid: number, field: keyof Omit<RoutingRow, '_uid'>, val: string) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, [field]: val } : r)));
  };

  const addRow = () =>
    setRows((prev) => [...prev, { _uid: ++_rowCounter, driver: '', subject: '', mentions: '' }]);
  const removeRow = (uid: number) => setRows((prev) => prev.filter((r) => r._uid !== uid));

  const mut = useMutation({
    mutationFn: () => api.settings.put({ 'routing-json': rowsToRoutingJson(rows) }),
    onSuccess: () => {
      setError(null);
      toast('success', 'Routing rules saved.');
      onSaved();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  return (
    <Section
      title="Per-driver routing"
      description="When a post is auto-tagged with a driver, send a modmail to the listed team members."
    >
      {rows.length === 0 ? (
        <p className="mb-3 text-xs text-[var(--n-8)]">No routing rules yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--n-4)] text-left text-[var(--n-8)]">
                <th className="pb-2 pr-3 font-medium">Driver ID</th>
                <th className="pb-2 pr-3 font-medium">Modmail subject</th>
                <th className="pb-2 pr-3 font-medium">Mentions (comma-sep usernames)</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--n-4)]">
              {rows.map((r) => (
                <tr key={r._uid}>
                  <td className="py-2 pr-3">
                    <input
                      value={r.driver}
                      onChange={(e) => update(r._uid, 'driver', e.target.value)}
                      placeholder="bug"
                      className="w-24 rounded border border-[var(--n-4)] bg-[var(--n-3)] px-2 py-1 text-xs text-[var(--n-11)] outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.subject}
                      onChange={(e) => update(r._uid, 'subject', e.target.value)}
                      placeholder="[ENG] new bug post"
                      className="w-48 rounded border border-[var(--n-4)] bg-[var(--n-3)] px-2 py-1 text-xs text-[var(--n-11)] outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.mentions}
                      onChange={(e) => update(r._uid, 'mentions', e.target.value)}
                      placeholder="dev-alice, eng-bob"
                      className="w-48 rounded border border-[var(--n-4)] bg-[var(--n-3)] px-2 py-1 text-xs text-[var(--n-11)] outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(r._uid)}
                      className="text-[var(--n-8)] hover:text-[var(--error-11)]"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={addRow}
        className="mt-3 text-xs text-[var(--n-8)] underline-offset-2 hover:text-[var(--accent-11)] hover:underline"
      >
        + Add rule
      </button>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}
