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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useId, useState } from 'react';
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
          className={`pointer-events-auto block max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
            t.type === 'success'
              ? 'border-emerald-700 bg-emerald-950 text-emerald-100'
              : 'border-rose-700 bg-rose-950 text-rose-100'
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
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      <h3 className="mb-1 text-sm font-semibold text-neutral-100">{title}</h3>
      {description ? <p className="mb-4 text-xs text-neutral-400">{description}</p> : null}
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
    <div className="mt-6 flex justify-end border-t border-neutral-800 pt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={loading || disabled}
        className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
      >
        {loading ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="mt-2 rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
      {msg}
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
      <div className="w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        <h4 className="mb-2 text-sm font-semibold text-neutral-100">Delete driver?</h4>
        <p className="mb-5 text-xs text-neutral-400">
          Remove <span className="font-medium text-neutral-200">&ldquo;{label}&rdquo;</span> from
          the taxonomy. Posts already tagged with this driver retain their tag.
          {hasChildren ? (
            <span className="mt-2 block text-amber-300">
              Warning: this driver has children. They will become root drivers.
            </span>
          ) : null}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-rose-700 bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-900/70"
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
      <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-neutral-400">
        Keywords
      </label>
      <div className="flex flex-wrap gap-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 focus-within:border-orange-500">
        {keywords.map((kw) => (
          <span
            key={kw}
            className="flex items-center gap-1 rounded bg-neutral-700 px-2 py-0.5 text-xs text-neutral-200"
          >
            {kw}
            <button
              type="button"
              aria-label={`Remove keyword ${kw}`}
              onClick={() => onChange(keywords.filter((k) => k !== kw))}
              className="ml-0.5 text-neutral-400 hover:text-rose-400"
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
          className="min-w-24 flex-1 bg-transparent text-xs text-neutral-100 outline-none placeholder:text-neutral-400"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single driver row (tree-aware)
// ---------------------------------------------------------------------------

function DriverTreeRow({
  row,
  depth,
  allRows,
  isCollapsed,
  hasChildren,
  onToggleCollapse,
  onUpdate,
  onDelete,
  onAddChild,
  onMoveTo,
}: {
  row: TaxRow;
  depth: number;
  allRows: TaxRow[];
  isCollapsed: boolean;
  hasChildren: boolean;
  onToggleCollapse: (uid: number) => void;
  onUpdate: (uid: number, field: keyof Omit<TaxRow, '_uid'>, val: string | string[] | null) => void;
  onDelete: (uid: number) => void;
  onAddChild: (parentUid: number) => void;
  onMoveTo: (uid: number, newParentId: string | null) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row._uid,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    paddingLeft: `${(depth - 1) * 24}px`,
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
    (r) =>
      r.id !== row.id &&
      !descendants.has(r.id) &&
      // moving row under r must not push row's subtree beyond depth 3
      rowDepth(r, byId) < 3,
  );

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
      <div
        ref={setNodeRef}
        style={style}
        className="mb-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3"
      >
        <div className="flex items-start gap-2">
          {/* Collapse/expand chevron */}
          <button
            type="button"
            onClick={() => onToggleCollapse(row._uid)}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            className={`mt-1 shrink-0 text-xs text-neutral-400 transition hover:text-neutral-200 ${!hasChildren ? 'invisible' : ''}`}
          >
            {isCollapsed ? '▶' : '▼'}
          </button>

          {/* Drag handle */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="mt-1 cursor-grab touch-none text-neutral-400 hover:text-neutral-300 active:cursor-grabbing"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
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
                <label className="mb-0.5 block text-xs font-medium text-neutral-400">
                  ID
                  <input
                    value={row.id}
                    onChange={(e) => onUpdate(row._uid, 'id', e.target.value)}
                    placeholder="bug"
                    data-testid={`driver-row-id-${row._uid}`}
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                  />
                </label>
              </div>
              <div className="col-span-2">
                <label className="mb-0.5 block text-xs font-medium text-neutral-400">
                  Label
                  <input
                    value={row.label}
                    onChange={(e) => onUpdate(row._uid, 'label', e.target.value)}
                    placeholder="Bug / Issue Report"
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                  />
                </label>
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-neutral-400">
                  Color
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="color"
                      value={row.color}
                      onChange={(e) => onUpdate(row._uid, 'color', e.target.value)}
                      className="h-6 w-8 cursor-pointer rounded border border-neutral-700 bg-neutral-800 p-0.5"
                    />
                    <span className="text-xs text-neutral-400">{row.color}</span>
                  </div>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-400">
                Description
                <textarea
                  value={row.description}
                  onChange={(e) => onUpdate(row._uid, 'description', e.target.value)}
                  placeholder="Optional"
                  rows={1}
                  className="mt-0.5 w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                />
              </label>
            </div>
            <KeywordsInput
              keywords={row.keywords}
              onChange={(kw) => onUpdate(row._uid, 'keywords', kw)}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {/* Add sub-driver — only if depth < 3 */}
              {depth < 3 ? (
                <button
                  type="button"
                  onClick={() => onAddChild(row._uid)}
                  data-testid={`add-sub-driver-${row._uid}`}
                  className="text-xs text-neutral-400 underline-offset-2 hover:text-orange-300 hover:underline"
                >
                  + Add sub-driver
                </button>
              ) : null}

              {/* Move to... */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMoveMenu((v) => !v)}
                  data-testid={`move-to-${row._uid}`}
                  className="text-xs text-neutral-400 underline-offset-2 hover:text-blue-300 hover:underline"
                >
                  Move to…
                </button>
                {showMoveMenu ? (
                  <div className="absolute left-0 top-full z-30 mt-1 min-w-40 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
                    <button
                      type="button"
                      className="w-full rounded px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                      onClick={() => {
                        onMoveTo(row._uid, null);
                        setShowMoveMenu(false);
                      }}
                    >
                      (Root &mdash; no parent)
                    </button>
                    {moveTargets.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="w-full rounded px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                        onClick={() => {
                          onMoveTo(row._uid, t.id);
                          setShowMoveMenu(false);
                        }}
                      >
                        {t.label || t.id}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Parent badge */}
              {row.parentId ? (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                  child of <span className="text-neutral-200">{row.parentId}</span>
                </span>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete driver ${row.label || row.id}`}
            className="mt-1 text-xs text-neutral-400 hover:text-rose-400"
            title="Delete driver"
          >
            &times;
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Preview bar
// ---------------------------------------------------------------------------

function TaxonomyPreview({ rows }: { rows: TaxRow[] }) {
  const roots = rows.filter((r) => !r.parentId);
  if (roots.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <span className="text-xs text-neutral-400">Current drivers:</span>
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
    setRows((prev) => [
      ...prev,
      {
        _uid: ++_rowCounter,
        id: '',
        label: '',
        color: '#94a3b8',
        description: '',
        keywords: [],
        parentId: null,
      },
    ]);
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
      // Find last descendant index
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
  };

  const removeRow = (uid: number) => {
    setRows((prev) => {
      const row = prev.find((r) => r._uid === uid);
      if (!row) return prev;
      // Promote children to root when parent is deleted
      return prev
        .filter((r) => r._uid !== uid)
        .map((r) => (r.parentId === row.id ? { ...r, parentId: null } : r));
    });
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

  // For collapse: compute which uids are hidden (ancestors are collapsed)
  const hiddenUids = new Set<number>();
  for (const r of orderedRows) {
    if (!r.parentId) continue;
    const parentRow = rows.find((p) => p.id === r.parentId);
    if (!parentRow) continue;
    if (collapsed.has(parentRow._uid) || hiddenUids.has(parentRow._uid)) {
      hiddenUids.add(r._uid);
    }
  }

  return (
    <Section
      title="Contact driver taxonomy"
      description="Define the issue categories used for tagging posts. Children indent under parents. Changes take effect on the next auto-tagged post."
    >
      <div className="mb-4 flex items-center justify-between">
        <TaxonomyPreview rows={rows} />
        <div className="ml-auto flex gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
          <button
            type="button"
            onClick={() => switchMode('visual')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${mode === 'visual' ? 'bg-orange-600/30 text-orange-200' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            Visual
          </button>
          <button
            type="button"
            onClick={() => switchMode('json')}
            data-testid="taxonomy-json-toggle"
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${mode === 'json' ? 'bg-orange-600/30 text-orange-200' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            JSON
          </button>
        </div>
      </div>

      {mode === 'visual' ? (
        <>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedRows.map((r) => r._uid)}
              strategy={verticalListSortingStrategy}
            >
              <div data-testid="taxonomy-driver-list">
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
                      onToggleCollapse={toggleCollapse}
                      onUpdate={update}
                      onDelete={removeRow}
                      onAddChild={addChild}
                      onMoveTo={moveTo}
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
            className="mt-4 text-xs text-neutral-400 underline-offset-2 hover:text-orange-300 hover:underline"
          >
            + Add root driver
          </button>
        </>
      ) : (
        <>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={onJsonBlur}
            rows={16}
            className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-xs text-neutral-100 outline-none focus:border-orange-500"
            aria-label="Taxonomy JSON editor"
            data-testid="taxonomy-json-editor"
          />
          {jsonError ? (
            <div className="mt-2 rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              JSON parse error: {jsonError}
            </div>
          ) : null}
        </>
      )}
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
        <p className="mb-3 text-xs text-neutral-400">No routing rules yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-400">
                <th className="pb-2 pr-3 font-medium">Driver ID</th>
                <th className="pb-2 pr-3 font-medium">Modmail subject</th>
                <th className="pb-2 pr-3 font-medium">Mentions (comma-sep usernames)</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60">
              {rows.map((r) => (
                <tr key={r._uid}>
                  <td className="py-2 pr-3">
                    <input
                      value={r.driver}
                      onChange={(e) => update(r._uid, 'driver', e.target.value)}
                      placeholder="bug"
                      className="w-24 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.subject}
                      onChange={(e) => update(r._uid, 'subject', e.target.value)}
                      placeholder="[ENG] new bug post"
                      className="w-48 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      value={r.mentions}
                      onChange={(e) => update(r._uid, 'mentions', e.target.value)}
                      placeholder="dev-alice, eng-bob"
                      className="w-48 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(r._uid)}
                      className="text-neutral-400 hover:text-rose-400"
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
        className="mt-3 text-xs text-neutral-400 underline-offset-2 hover:text-orange-300 hover:underline"
      >
        + Add rule
      </button>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}
