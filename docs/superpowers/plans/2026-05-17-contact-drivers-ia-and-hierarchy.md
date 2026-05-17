# Contact Drivers IA Refactor + Hierarchical Drivers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Taxonomy and Routing editors from Settings into the Contact Drivers tab, then add parent/child driver hierarchy with a tree UI, breadcrumb display, sub-driver filtering, and leaf-aware keyword/LLM classification.

**Architecture:** All taxonomy state is owned by the Drivers tab after this refactor. Hierarchy is encoded as `parentId?: string | null` on `TaxonomyNode` — flat arrays stay valid (no parentId = root). The tree is rendered in-place inside the Drivers tab above the volume bar list. Validation catches cycles, dangling refs, self-parenting, and depth > 3 at save time. `formatDriverPath` is the single source of truth for breadcrumb rendering across all label sites.

**Tech Stack:** React 18, TanStack Query, @dnd-kit/sortable (already installed), Zod, Vitest, Playwright, TypeScript strict.

---

## File Map

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `parentId?: string \| null` to `TaxonomyNode` |
| `src/client/lib/api.ts` | Add `parentId` to client `TaxonomyNode`, add `formatDriverPath` util |
| `src/shared/validation.ts` | Extend `taxonomyArraySchema` with hierarchy rules |
| `src/client/views/Settings.tsx` | Remove `TaxonomySection` + `RoutingSection`; keep rest |
| `src/client/views/DriversConfig.tsx` | **NEW** — tree editor (Taxonomy + Routing), extracted out of Settings |
| `src/client/views/Dashboard.tsx` | Import `DriversConfig`; render above bar list in `Drivers`; update `DriverPostsPanel` to add "Include sub-drivers" toggle; update `DriverPostList` label display to use `formatDriverPath` |
| `src/modules/contact-drivers/index.ts` | Update `suggestDriver` to prefer leaf; update `classifyWithLlm` prompt |
| `tests/validation.test.ts` | Add cycle / depth / dangling / self-parent unit tests |
| `tests/e2e/settings.spec.ts` | Update Taxonomy editor tests to navigate to Contact drivers tab |
| `tests/e2e/drivers.spec.ts` | Add hierarchy e2e tests |
| `tests/e2e/fixtures/taxonomy.json` | Add hierarchy fixture data (parentId fields) |
| `tests/e2e/mock-api.ts` | No changes needed (taxonomy fixture already serves `/api/drivers/taxonomy`) |

---

## Task 1: Add `parentId` to shared `TaxonomyNode` type

**Files:**
- Modify: `src/shared/types.ts` — add `parentId` field
- Modify: `src/client/lib/api.ts` — add `parentId` to client-side `TaxonomyNode`

- [ ] **Step 1.1: Update server-side TaxonomyNode**

In `src/shared/types.ts`, find the `TaxonomyNode` interface (line ~77) and add the field:

```typescript
export interface TaxonomyNode {
  id: string;
  label: string;
  description?: string | undefined;
  color?: string | undefined;
  /** null or missing = root driver. Non-null = child of named parent. */
  parentId?: string | null | undefined;
}
```

- [ ] **Step 1.2: Update client-side TaxonomyNode**

In `src/client/lib/api.ts`, find the `TaxonomyNode` interface (around line 75) and add the same field:

```typescript
export interface TaxonomyNode {
  id: string;
  label: string;
  color?: string;
  description?: string;
  /** null or missing = root driver. Non-null = child of named parent. */
  parentId?: string | null;
}
```

- [ ] **Step 1.3: Add `formatDriverPath` helper at bottom of api.ts**

At the end of `src/client/lib/api.ts`, before the closing line, add:

```typescript
// ---------------------------------------------------------------------------
// Taxonomy display helpers
// ---------------------------------------------------------------------------

/**
 * Renders a driver's full ancestry as a breadcrumb string.
 *
 * Examples:
 *   formatDriverPath('bug', taxonomy)           → 'Bug / broken experience'
 *   formatDriverPath('bug.crash', taxonomy)     → 'Bug / broken experience › Crash'
 *   formatDriverPath('unknown', taxonomy)       → 'unknown'
 *
 * @param driverId  The driver id to resolve.
 * @param taxonomy  Flat taxonomy array (may include parentId fields).
 * @returns         Human-readable breadcrumb string.
 */
export function formatDriverPath(driverId: string, taxonomy: TaxonomyNode[]): string {
  const byId = new Map(taxonomy.map((t) => [t.id, t]));

  const chain: string[] = [];
  let current: TaxonomyNode | undefined = byId.get(driverId);
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) break; // cycle guard
    visited.add(current.id);
    chain.unshift(current.label || current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  // Fallback: if driverId not found, return the raw id
  return chain.length > 0 ? chain.join(' › ') : driverId;
}
```

- [ ] **Step 1.4: Run type-check — expect zero errors**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exits 0. If errors reference `parentId` usage in existing code, fix them now (they should be none since the field is optional).

- [ ] **Step 1.5: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add src/shared/types.ts src/client/lib/api.ts && git commit -m "feat(types): add parentId to TaxonomyNode + formatDriverPath breadcrumb helper"
```

---

## Task 2: Extend taxonomyArraySchema with hierarchy validation

**Files:**
- Modify: `src/shared/validation.ts` — strengthen `taxonomyArraySchema`

- [ ] **Step 2.1: Write failing unit tests first**

Add the following describe block at the end of `tests/validation.test.ts`:

```typescript
describe('taxonomyArraySchema — hierarchy rules', () => {
  it('accepts a flat taxonomy (no parentId fields) — backward compat', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'bug', label: 'Bug' },
      { id: 'billing', label: 'Billing', color: '#ff0000' },
    ]);
    expect(r.success).toBe(true);
  });

  it('accepts valid parent → child relationships', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'bug', label: 'Bug' },
      { id: 'bug.crash', label: 'Crash', parentId: 'bug' },
      { id: 'bug.ui', label: 'UI Glitch', parentId: 'bug' },
    ]);
    expect(r.success).toBe(true);
  });

  it('accepts depth exactly 3 (root → child → grandchild)', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', parentId: 'a' },
      { id: 'c', label: 'C', parentId: 'b' },
    ]);
    expect(r.success).toBe(true);
  });

  it('rejects depth 4 (great-grandchild)', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', parentId: 'a' },
      { id: 'c', label: 'C', parentId: 'b' },
      { id: 'd', label: 'D', parentId: 'c' },
    ]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('depth');
    }
  });

  it('rejects self-parenting', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'bug', label: 'Bug', parentId: 'bug' },
    ]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/self|cycle/i);
    }
  });

  it('rejects a dangling parentId (refers to non-existent node)', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'bug', label: 'Bug', parentId: 'does-not-exist' },
    ]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/dangling|parent/i);
    }
  });

  it('rejects a cycle (a → b → a)', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'a', label: 'A', parentId: 'b' },
      { id: 'b', label: 'B', parentId: 'a' },
    ]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/cycle/i);
    }
  });

  it('parentId: null is treated as root (same as missing parentId)', () => {
    const r = taxonomyArraySchema.safeParse([
      { id: 'bug', label: 'Bug', parentId: null },
    ]);
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2.2: Run tests — confirm the new tests fail**

```bash
cd /Users/divyansh/Projects/redlattice && npm test -- tests/validation.test.ts
```

Expected: the new `taxonomy — hierarchy rules` tests fail (they test rules not yet implemented).

- [ ] **Step 2.3: Implement hierarchy validation in `src/shared/validation.ts`**

Replace the existing `taxonomyArraySchema` export (around line 105) with this new version:

```typescript
// ---------------------------------------------------------------------------
// Hierarchy validation helpers (used by taxonomyArraySchema superRefine)
// ---------------------------------------------------------------------------

/** Walk up the parent chain and return the depth (root = 1). Returns Infinity on cycle. */
function nodeDepth(id: string, parentMap: Map<string, string | null>): number {
  let depth = 1;
  let current: string | null | undefined = id;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) return Infinity; // cycle
    visited.add(current);
    current = parentMap.get(current) ?? null;
    if (current) depth++;
  }
  return depth;
}

export const taxonomyNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

export const taxonomyArraySchema = z
  .array(taxonomyNodeSchema)
  .superRefine((nodes, ctx) => {
    const ids = new Set(nodes.map((n) => n.id));
    // Build parent map: id → parentId (null = root)
    const parentMap = new Map<string, string | null>();
    for (const node of nodes) {
      parentMap.set(node.id, node.parentId ?? null);
    }

    for (const node of nodes) {
      const pid = node.parentId;

      // Self-parenting
      if (pid === node.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Driver "${node.id}" has a self-cycle (parentId === id).`,
          path: [node.id],
        });
        continue;
      }

      // Dangling parentId
      if (pid && !ids.has(pid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Driver "${node.id}" has a dangling parentId "${pid}" that does not exist in the taxonomy.`,
          path: [node.id],
        });
        continue;
      }

      // Depth > 3
      const depth = nodeDepth(node.id, parentMap);
      if (depth === Infinity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Driver "${node.id}" is part of a parentId cycle.`,
          path: [node.id],
        });
      } else if (depth > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Driver "${node.id}" exceeds maximum depth of 3 (actual depth: ${depth}).`,
          path: [node.id],
        });
      }
    }
  });

export type TaxonomyArray = z.infer<typeof taxonomyArraySchema>;
```

Also remove the old `taxonomyNodeSchema` export if there was one — there wasn't, so just remove the old block. Leave `TaxonomyArray` type export as-is (it's the same).

- [ ] **Step 2.4: Run tests — all should pass**

```bash
cd /Users/divyansh/Projects/redlattice && npm test -- tests/validation.test.ts
```

Expected: all tests in the file pass, including the new hierarchy tests.

- [ ] **Step 2.5: Run full test suite — no regressions**

```bash
cd /Users/divyansh/Projects/redlattice && npm test
```

Expected: all unit tests pass (59/59 or better).

- [ ] **Step 2.6: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add src/shared/validation.ts tests/validation.test.ts && git commit -m "feat(validation): add hierarchy rules to taxonomyArraySchema (depth≤3, no cycles, no dangling parentId)"
```

---

## Task 3: Create DriversConfig.tsx — taxonomy tree editor + routing section

This is the largest single task. We're extracting `TaxonomySection` and `RoutingSection` from `Settings.tsx` into a new file, then adding the hierarchical tree rendering with collapse/expand, `+ Add sub-driver`, `Move to...` dropdown, and keeping the JSON fallback.

**Files:**
- Create: `src/client/views/DriversConfig.tsx`

The component exports two things:
- `TaxonomyConfigSection` — the full tree editor (replaces `TaxonomySection` from Settings)
- `RoutingConfigSection` — the routing table (replaces `RoutingSection` from Settings)

These share the same toast/save pattern as the existing Settings sections.

- [ ] **Step 3.1: Create `src/client/views/DriversConfig.tsx`**

```typescript
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
    { _uid: ++_rowCounter, id: 'bug', label: 'Bug / Issue Report', color: '#f87171', description: '', keywords: ['crash', 'broken', 'error', 'bug'], parentId: null },
    { _uid: ++_rowCounter, id: 'feature', label: 'Feature Request', color: '#60a5fa', description: '', keywords: ['request', 'wish', 'add', 'would love'], parentId: null },
    { _uid: ++_rowCounter, id: 'question', label: 'Question / How-to', color: '#fbbf24', description: '', keywords: ['how', 'help', 'can i', 'does it'], parentId: null },
    { _uid: ++_rowCounter, id: 'billing', label: 'Billing / Account', color: '#a78bfa', description: '', keywords: ['charge', 'refund', 'invoice', 'subscription'], parentId: null },
    { _uid: ++_rowCounter, id: 'praise', label: 'Praise / Feedback', color: '#4ade80', description: '', keywords: ['love', 'great', 'awesome', 'thank'], parentId: null },
    { _uid: ++_rowCounter, id: 'complaint', label: 'Complaint', color: '#fb923c', description: '', keywords: ['disappointed', 'terrible', 'awful'], parentId: null },
    { _uid: ++_rowCounter, id: 'other', label: 'Other', color: '#94a3b8', description: '', keywords: [], parentId: null },
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
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string | null, TaxRow[]>();
  for (const r of rows) {
    const pid = r.parentId ?? null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)!.push(r);
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
          Remove <span className="font-medium text-neutral-200">"{label}"</span> from the taxonomy.
          Posts already tagged with this driver retain their tag.
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
              ×
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
      <div ref={setNodeRef} style={style} className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 mb-2">
        <div className="flex items-start gap-2">
          {/* Collapse/expand chevron */}
          <button
            type="button"
            onClick={() => onToggleCollapse(row._uid)}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            className={`mt-1 shrink-0 text-xs text-neutral-400 hover:text-neutral-200 transition ${!hasChildren ? 'invisible' : ''}`}
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
                      (Root — no parent)
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
            ✕
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

  const update = (uid: number, field: keyof Omit<TaxRow, '_uid'>, val: string | string[] | null) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, [field]: val } : r)));
  };

  const addRoot = () => {
    setRows((prev) => [...prev, { _uid: ++_rowCounter, id: '', label: '', color: '#94a3b8', description: '', keywords: [], parentId: null }]);
  };

  const addChild = (parentUid: number) => {
    const parent = rows.find((r) => r._uid === parentUid);
    if (!parent) return;
    const newRow: TaxRow = { _uid: ++_rowCounter, id: '', label: '', color: parent.color, description: '', keywords: [], parentId: parent.id };
    // Insert right after last existing child of this parent in the flat array
    const parentIdx = rows.findIndex((r) => r._uid === parentUid);
    setRows((prev) => {
      const next = [...prev];
      // Find last descendant index
      let insertAt = parentIdx + 1;
      for (let i = parentIdx + 1; i < next.length; i++) {
        if (next[i].parentId === parent.id) insertAt = i + 1;
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
      const payload = mode === 'json' ? jsonText : JSON.stringify(rows.map(({ _uid: _u, ...rest }) => ({ ...rest, parentId: rest.parentId ?? null })));
      return api.settings.put({ 'taxonomy-json': payload });
    },
    onSuccess: () => {
      setSaveError(null);
      toast('success', 'Taxonomy saved.');
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
    childrenOf.get(pid)!.add(r._uid);
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedRows.map((r) => r._uid)} strategy={verticalListSortingStrategy}>
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
      const obj = JSON.parse(routingJson) as Record<string, { subject?: string; mentions?: string[] }>;
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
                      ×
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
```

- [ ] **Step 3.2: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: zero errors. If Zod type-narrowing errors appear in `taxonomyArraySchema` after Task 2's changes (e.g., the `nodeDepth` helper is in `validation.ts`, not this file), that's fine — this file has no Zod deps.

- [ ] **Step 3.3: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add src/client/views/DriversConfig.tsx && git commit -m "feat(ui): add DriversConfig.tsx — hierarchical taxonomy tree editor + routing section"
```

---

## Task 4: IA refactor — remove Taxonomy + Routing from Settings.tsx

**Files:**
- Modify: `src/client/views/Settings.tsx` — remove `TaxonomySection`, `RoutingSection`, and their helper functions/types

- [ ] **Step 4.1: Remove sections from Settings.tsx**

In `src/client/views/Settings.tsx`:

1. Remove these function definitions entirely:
   - `parseTaxonomyRows`
   - `rowsToJson`
   - `DeleteConfirmModal`
   - `KeywordsInput`
   - `DriverCard` (exported)
   - `TaxonomyPreview`
   - `TaxonomySection`
   - `parseRoutingRows`
   - `rowsToRoutingJson`
   - `RoutingSection`

2. Remove the `TaxRow` and `RoutingRow` interface definitions.

3. Remove the `_rowCounter` counter variable (it was used only by those removed functions). The `_toastCounter` stays.

4. Remove unused imports: all `@dnd-kit/*` imports and `CSS` from `@dnd-kit/utilities`, `arrayMove`, `SortableContext`, `sortableKeyboardCoordinates`, `useSortable`, `verticalListSortingStrategy` — these are only needed in `DriversConfig.tsx` now. Keep `closestCenter`, `DndContext`, `DragEndEvent`, `KeyboardSensor`, `PointerSensor`, `useSensor`, `useSensors` only if any remaining section still uses them (they don't — remove them all).

5. In the `Settings` component's JSX render, remove these two lines:
   ```tsx
   <TaxonomySection data={data} toast={toast} onSaved={invalidate} />
   <RoutingSection data={data} toast={toast} onSaved={invalidate} />
   ```

6. Also remove the `useId` import if it is no longer used after removing those sections (check — `BrandIdentitySection` and `IdentityTrustSection` still use it, so keep it).

7. Remove `closestCenter`, `DndContext`, `DragEndEvent`, `KeyboardSensor`, `PointerSensor`, `useSensor`, `useSensors` from the `@dnd-kit/core` import.

After editing, the Settings.tsx import block should look like:
```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useId, useState } from 'react';
import { api } from '../lib/api.ts';
import { OnboardingSettingsSection } from './Onboarding.tsx';
```

And the Settings render returns:
```tsx
<div className="space-y-6">
  <ToastContainer toasts={toasts} />
  <header>...</header>
  <BrandIdentitySection data={data} toast={toast} onSaved={invalidate} />
  <IdentityTrustSection data={data} toast={toast} onSaved={invalidate} />
  <ThresholdsSection data={data} toast={toast} onSaved={invalidate} />
  <AISection data={data} toast={toast} onSaved={invalidate} />
  <StudioSection data={data} toast={toast} onSaved={invalidate} />
  <OnboardingSettingsSection />
</div>
```

- [ ] **Step 4.2: Run type-check — expect zero errors**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: exits 0.

- [ ] **Step 4.3: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add src/client/views/Settings.tsx && git commit -m "refactor(ia): remove TaxonomySection + RoutingSection from Settings — moved to DriversConfig"
```

---

## Task 5: Integrate DriversConfig into the Drivers tab

**Files:**
- Modify: `src/client/views/Dashboard.tsx`

The `Drivers` component gets a new accordion-style config block at the top: "Configure taxonomy" toggles open `TaxonomyConfigSection` and `RoutingConfigSection`.

- [ ] **Step 5.1: Add import at the top of Dashboard.tsx**

Find the existing imports section near line 1 and add:
```typescript
import {
  DriversToastContainer,
  RoutingConfigSection,
  TaxonomyConfigSection,
  useDriversToast,
} from './DriversConfig.tsx';
```

- [ ] **Step 5.2: Update the `Drivers` component**

Replace the `Drivers` function (starting around line 1531) with this new version:

```typescript
function Drivers({ initialDriver }: { initialDriver?: string | undefined }) {
  const taxonomyQ = useQuery({ queryKey: ['taxonomy'], queryFn: api.taxonomy });
  const volumeQ = useQuery({ queryKey: ['drivers-volume'], queryFn: api.driverVolume });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const qc = useQueryClient();
  const [openDriver, setOpenDriver] = useState<string | null>(initialDriver ?? null);
  const [driverFilter, setDriverFilter] = useState<string>('');
  const [configOpen, setConfigOpen] = useState(false);
  const { toasts, toast } = useDriversToast();

  if (taxonomyQ.isPending || volumeQ.isPending) return <SkeletonGrid />;
  if (taxonomyQ.isError || volumeQ.isError)
    return (
      <ErrorMsg
        msg="Couldn't load drivers."
        retry={() => {
          taxonomyQ.refetch();
          volumeQ.refetch();
        }}
      />
    );

  const taxonomy = taxonomyQ.data.taxonomy;
  const totals: Record<string, number> = {};
  for (const day of volumeQ.data.series) {
    for (const [id, count] of Object.entries(day.counts ?? {})) {
      totals[id] = (totals[id] ?? 0) + count;
    }
  }

  // For the bar chart, show only root drivers (no parentId) or use formatDriverPath for children
  const sorted = taxonomy
    .map((t) => ({ ...t, count: totals[t.id] ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...sorted.map((s) => s.count));

  const rawSettings = settingsQ.data ?? {};
  const taxonomyJson = typeof rawSettings['taxonomy-json'] === 'string' ? rawSettings['taxonomy-json'] : '';
  const routingJson = typeof rawSettings['routing-json'] === 'string' ? rawSettings['routing-json'] : '';

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ['taxonomy'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };

  return (
    <section className="space-y-6">
      <DriversToastContainer toasts={toasts} />
      <SavedViewsStrip
        tab="drivers"
        onApply={(params) => {
          if (params.driver) setOpenDriver(params.driver);
          if (params.driverFilter) setDriverFilter(params.driverFilter);
        }}
        currentParams={{
          ...(openDriver ? { driver: openDriver } : {}),
          ...(driverFilter ? { driverFilter } : {}),
        }}
      />

      {/* Configure taxonomy accordion */}
      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40">
        <button
          type="button"
          onClick={() => setConfigOpen((v) => !v)}
          aria-expanded={configOpen}
          data-testid="drivers-config-toggle"
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-medium text-neutral-200">Configure taxonomy</span>
          <span className="text-xs text-neutral-400">{configOpen ? '▲ collapse' : '▼ expand'}</span>
        </button>
        {configOpen ? (
          <div className="space-y-4 border-t border-neutral-800 px-5 pb-5 pt-4" data-testid="drivers-config-panel">
            {settingsQ.isPending ? (
              <div className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
            ) : (
              <>
                <TaxonomyConfigSection
                  taxonomyJson={taxonomyJson}
                  toast={toast}
                  onSaved={invalidateAll}
                />
                <RoutingConfigSection
                  routingJson={routingJson}
                  toast={toast}
                  onSaved={invalidateAll}
                />
              </>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <h2 className="mb-4 text-sm uppercase tracking-wide text-neutral-400">
          Contact drivers · last 30 days · click to see posts
        </h2>
        <ul className="space-y-2">
          {sorted.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setOpenDriver(openDriver === d.id ? null : d.id)}
                className={`flex w-full items-center gap-4 rounded-lg border px-3 py-2 text-left transition ${
                  openDriver === d.id
                    ? 'border-orange-500 bg-neutral-900'
                    : 'border-transparent hover:border-neutral-800 hover:bg-neutral-900/60'
                }`}
              >
                <span className="flex w-40 min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: d.color }}
                  />
                  <span className="truncate text-sm text-neutral-200">
                    {formatDriverPath(d.id, taxonomy)}
                  </span>
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-900">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(d.count / max) * 100}%`,
                      background: d.color ?? '#ff4500',
                    }}
                  />
                </span>
                <span className="w-12 text-right text-sm tabular-nums text-neutral-400">
                  {d.count}
                </span>
              </button>
              {openDriver === d.id ? (
                <div className="mt-2 ml-4">
                  <DriverPostsPanel driver={d} taxonomy={taxonomy} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 5.3: Add `formatDriverPath` to Dashboard.tsx imports from api.ts**

In Dashboard.tsx's import from `'../lib/api.ts'`, add `formatDriverPath`:
```typescript
import {
  type Agent,
  type AuditAction,
  type AuditEntry,
  api,
  type DriverPost,
  formatDriverPath,
  type PostStatus,
  type RecentPost,
  type TaxonomyNode,
} from '../lib/api.ts';
```

- [ ] **Step 5.4: Update `DriverPostsPanel` to accept `taxonomy` prop and add "Include sub-drivers" toggle**

Replace the `DriverPostsPanel` function with this updated version:

```typescript
function DriverPostsPanel({ driver, taxonomy }: { driver: TaxonomyNode; taxonomy: TaxonomyNode[] }) {
  const [filter, setFilter] = useState<'all' | PostStatus>('open');
  const [includeSubDrivers, setIncludeSubDrivers] = useState(false);

  // When includeSubDrivers is on, collect all descendant driver ids
  const driverIds: string[] = [driver.id];
  if (includeSubDrivers) {
    function collectDescendants(id: string) {
      for (const t of taxonomy) {
        if (t.parentId === id) {
          driverIds.push(t.id);
          collectDescendants(t.id);
        }
      }
    }
    collectDescendants(driver.id);
  }

  const hasChildren = taxonomy.some((t) => t.parentId === driver.id);

  const q = useQuery({
    queryKey: ['driver-posts', driver.id, filter, includeSubDrivers],
    queryFn: () =>
      api.driverPosts(
        driver.id,
        filter === 'all' ? { limit: 100 } : { limit: 100, status: filter },
      ),
  });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-400">Filter:</span>
        {STATUS_FILTERS.map((f) => (
          <button
            type="button"
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-2 py-0.5 transition ${
              filter === f.id
                ? 'border-orange-500 bg-orange-500/10 text-orange-200'
                : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {f.label}
          </button>
        ))}
        {hasChildren ? (
          <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-neutral-400">
            <input
              type="checkbox"
              checked={includeSubDrivers}
              onChange={(e) => setIncludeSubDrivers(e.target.checked)}
              data-testid="include-sub-drivers-toggle"
              className="rounded border-neutral-700 bg-neutral-800 accent-orange-500"
            />
            Include sub-drivers
          </label>
        ) : null}
      </div>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorMsg msg="Couldn't load posts." retry={() => q.refetch()} />
      ) : q.data.posts.length === 0 ? (
        <EmptyHint>
          No posts in "{driver.label}" matching filter "{filter}".
        </EmptyHint>
      ) : (
        <DriverPostList posts={q.data.posts} driverId={driver.id} taxonomy={taxonomy} />
      )}
    </div>
  );
}
```

- [ ] **Step 5.5: Update `DriverPostList` to show breadcrumb labels**

Update the `DriverPostList` function signature and `DriverBadge` usage to pass taxonomy:

```typescript
function DriverPostList({ posts, driverId, taxonomy }: { posts: DriverPost[]; driverId: string; taxonomy: TaxonomyNode[] }) {
  const qc = useQueryClient();
  const [openThread, setOpenThread] = useState<string | null>(null);
  const mutate = async (postId: string, status: PostStatus) => {
    await api.setPostStatus(postId, status);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['driver-posts', driverId] }),
      qc.invalidateQueries({ queryKey: ['recent-posts'] }),
    ]);
  };
```

And in the post row's driver badge line, replace any raw `p.driverId` label with the formatted path. Find the `<DriverBadge id={p.driverId} taggedBy={p.taggedBy} />` call and wrap it so the badge shows the breadcrumb. Since `DriverBadge` is a separate component, update it to accept taxonomy too, or pass the formatted label:

Find the `DriverBadge` component in Dashboard.tsx (search for `function DriverBadge`) and update it:

```typescript
function DriverBadge({
  id,
  taggedBy,
  taxonomy,
}: {
  id: string;
  taggedBy: 'manual' | 'auto' | 'ai' | null | undefined;
  taxonomy: TaxonomyNode[];
}) {
  const label = formatDriverPath(id, taxonomy);
  const color = taggedBy === 'ai' ? 'text-violet-300' : taggedBy === 'auto' ? 'text-blue-300' : 'text-neutral-400';
  return (
    <span className={`font-medium ${color}`} title={`ID: ${id}`}>
      {label}
      {taggedBy ? <span className="ml-1 text-neutral-500">({taggedBy})</span> : null}
    </span>
  );
}
```

Then update all call sites of `DriverBadge` in Dashboard.tsx to pass `taxonomy={taxonomy}` — there are two: one in `DriverPostList` and one in the Inbox tab. For the Inbox tab, pass an empty array `taxonomy={[]}` (the inbox does not have taxonomy loaded; the breadcrumb will fall back to the raw id, which is acceptable).

Search for `<DriverBadge` in Dashboard.tsx and update each call:

In `DriverPostList` (called from `Drivers` tab which has taxonomy):
```tsx
<DriverBadge id={p.driverId} taggedBy={p.taggedBy} taxonomy={taxonomy} />
```

In the `Inbox` tab (no taxonomy loaded there):
```tsx
<DriverBadge id={p.driverId ?? ''} taggedBy={p.taggedBy} taxonomy={[]} />
```

- [ ] **Step 5.6: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: zero errors.

- [ ] **Step 5.7: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add src/client/views/Dashboard.tsx && git commit -m "feat(ia): integrate DriversConfig into Contact Drivers tab; add sub-driver toggle + breadcrumb labels"
```

---

## Task 6: Update contact-drivers module — leaf-aware classifier

**Files:**
- Modify: `src/modules/contact-drivers/index.ts`

Two changes:
1. `suggestDriver` — when a leaf node and a root node both match, prefer the leaf (more specific).
2. `classifyWithLlm` — update the prompt and file header comment to document that the classifier can return any node (root or leaf) and should prefer the most specific leaf when confident.

- [ ] **Step 6.1: Update the file header comment in contact-drivers/index.ts**

Replace the existing header comment block (top of the file, lines 1-16) with:

```typescript
/**
 * Module 02 — Contact Drivers
 * Tier: CORE · Phase 1
 *
 * Tags every post with an issue category (bug, billing, feature, complaint…)
 * so brand teams see *why* customers are contacting them.
 *
 * ## Classifier behavior (updated for hierarchical taxonomy)
 *
 * The classifier can return ANY node id — root or leaf. When a post clearly
 * matches a specific leaf (e.g., "bug.crash"), it returns the leaf id rather
 * than the parent ("bug"). When confidence is low or no leaf applies, it falls
 * back to the most appropriate root or the closest ancestor it is confident
 * about. There is never a guarantee of a leaf — only a single `driverId`
 * string referencing any valid node in the taxonomy.
 *
 * Keyword scoring (lexicon fallback): uses taxonomy keywords per node and
 * prefers the most specific matching leaf over its parent root.
 *
 * Phase 1:
 *   - PostCreate trigger → keyword auto-suggest → store tag + rollup if confident
 *   - Manual tag via menu action (form-based)
 *   - API routes for the dashboard
 *
 * Phase 2:
 *   - LLM-based tagging when keyword confidence is low
 */
```

- [ ] **Step 6.2: Update `suggestDriver` to prefer leaves over roots**

Replace the existing `suggestDriver` function with this version:

```typescript
/**
 * Suggest the best-matching driver from the taxonomy using keyword scoring.
 *
 * Strategy:
 *   1. Score ALL nodes in the taxonomy (using their own keywords field plus
 *      the built-in KEYWORDS map for backward compat).
 *   2. Among nodes with the same confidence, prefer a leaf (has no children)
 *      over a root — the most specific match wins.
 */
export function suggestDriver(
  text: string,
  taxonomy: TaxonomyNode[] = DEFAULT_TAXONOMY,
): Suggestion | null {
  const validIds = new Set(taxonomy.map((t) => t.id));
  const childIds = new Set(
    taxonomy.filter((t) => t.parentId && validIds.has(t.parentId)).map((t) => t.id),
  );
  // parentIds = ids that have at least one child → roots when we prefer leaves
  const parentIds = new Set(taxonomy.filter((t) => t.parentId).map((t) => t.parentId as string));

  let best: (Suggestion & { isLeaf: boolean }) | null = null;

  // Score using the built-in keyword map (backward compat)
  for (const [driverId, phrases] of Object.entries(KEYWORDS)) {
    if (!validIds.has(driverId)) continue;
    const hits = phrases.filter((p) => text.includes(p)).length;
    if (hits === 0) continue;
    const confidence = Math.min(1, hits / 3);
    const isLeaf = !parentIds.has(driverId);
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence && isLeaf && !best.isLeaf)
    ) {
      best = { id: driverId, confidence, isLeaf };
    }
  }

  // Also score using per-node keywords from the taxonomy (supports hierarchy)
  for (const node of taxonomy) {
    const nodeKeywords: string[] = Array.isArray((node as { keywords?: string[] }).keywords)
      ? (node as { keywords?: string[] }).keywords!
      : [];
    if (nodeKeywords.length === 0) continue;
    const hits = nodeKeywords.filter((p) => text.includes(p.toLowerCase())).length;
    if (hits === 0) continue;
    const confidence = Math.min(1, hits / 3);
    const isLeaf = !parentIds.has(node.id);
    if (
      !best ||
      confidence > best.confidence ||
      (confidence === best.confidence && isLeaf && !best.isLeaf)
    ) {
      best = { id: node.id, confidence, isLeaf };
    }
  }

  return best && best.confidence >= 0.34 ? { id: best.id, confidence: best.confidence } : null;
}
```

Note: `TaxonomyNode` in `src/shared/types.ts` does not have a `keywords` field. The suggestion engine reads it defensively via type cast. If you want to add `keywords?: string[]` to `TaxonomyNode` in `types.ts`, do so now (it's already present in the client-side `api.ts` fixture rows, just not in the canonical shared type).

Add `keywords?: string[] | undefined;` to the `TaxonomyNode` interface in `src/shared/types.ts`.

- [ ] **Step 6.3: Update `classifyWithLlm` system prompt**

Find the `classifyWithLlm` function and update only the `system` field of the `llmObject` call:

```typescript
system:
  'You categorize Reddit posts in a brand support subreddit by their contact driver (why the customer is posting). ' +
  'Choose the single best matching category. Prefer the most specific leaf category when you are confident it applies. ' +
  'Return a root category when no leaf clearly fits, or when your confidence in any leaf is below 0.7. ' +
  'Reply with the category id (any node in the taxonomy, not just roots), your confidence (0-1), and a one-sentence reasoning.',
```

- [ ] **Step 6.4: Run type-check**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check
```

Expected: zero errors.

- [ ] **Step 6.5: Run unit tests — all should pass**

```bash
cd /Users/divyansh/Projects/redlattice && npm test -- tests/contact-drivers.test.ts
```

Expected: all 8 existing tests pass (the `suggestDriver` logic is backward compatible — no existing tests should break).

- [ ] **Step 6.6: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add src/modules/contact-drivers/index.ts src/shared/types.ts && git commit -m "feat(classifier): prefer leaf over root in suggestDriver + update LLM prompt for hierarchy"
```

---

## Task 7: Update e2e tests — settings.spec.ts

The Taxonomy editor tests in `settings.spec.ts` currently navigate to the Settings tab. Update them to navigate to the Contact drivers tab instead.

**Files:**
- Modify: `tests/e2e/settings.spec.ts`

- [ ] **Step 7.1: Update Taxonomy editor tests**

In `tests/e2e/settings.spec.ts`, find the `describe('Taxonomy editor', ...)` block. Update every test that does:
```typescript
await page.getByRole('tab', { name: 'Settings' }).click();
await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible({ timeout: 8000 });
```

Replace with:
```typescript
await page.getByRole('tab', { name: 'Contact drivers' }).click();
await page.getByTestId('drivers-config-toggle').click();
await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
```

Then in each test, remove or update the intermediate assertion `await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible()` — the section heading still exists inside the panel, but is now nested. The `data-testid="taxonomy-driver-list"` and other testids are preserved, so the rest of each test body should work without changes.

The test `'taxonomy section renders in visual mode by default'` should become:
```typescript
test('taxonomy section renders in visual mode by default', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Contact drivers' }).click();
  await page.getByTestId('drivers-config-toggle').click();
  await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
  await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible({ timeout: 4000 });
  await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible();
});
```

Apply the same navigation pattern to every other test in `describe('Taxonomy editor', ...)`:
- `'can switch to JSON mode'`
- `'can add a new driver in visual mode'`
- `'delete button shows confirmation modal'`
- `'confirming delete removes the driver card'`
- `'cancelling delete keeps the driver card'`
- `'live preview shows colored chips for each driver'`
- `'JSON mode textarea contains valid JSON'`
- `'taxonomy save button fires PUT with taxonomy-json key'`

For `'taxonomy save button fires PUT with taxonomy-json key'`: the taxonomy Save button is now inside the DriversConfig panel. The save button index may change. Use `data-testid` or a more targeted locator instead of `.nth(1)`. You can target it by finding the button inside the taxonomy section:
```typescript
// Inside the taxonomy section, find its Save button
const taxonomySection = page.locator('section').filter({ hasText: /contact driver taxonomy/i });
await taxonomySection.getByRole('button', { name: /^save$/i }).click();
```

- [ ] **Step 7.2: Run the settings e2e tests**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test:e2e -- tests/e2e/settings.spec.ts
```

Expected: all tests pass.

- [ ] **Step 7.3: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add tests/e2e/settings.spec.ts && git commit -m "test(e2e): update taxonomy editor tests to navigate to Contact Drivers tab"
```

---

## Task 8: Update taxonomy fixture and add hierarchy e2e tests

**Files:**
- Modify: `tests/e2e/fixtures/taxonomy.json` — add a child node for hierarchy tests
- Modify: `tests/e2e/drivers.spec.ts` — add hierarchy e2e tests

- [ ] **Step 8.1: Add a child node to the taxonomy fixture**

Update `tests/e2e/fixtures/taxonomy.json` to add one child driver under `"bug"`:

```json
{
  "taxonomy": [
    {
      "id": "bug",
      "label": "Bug / broken experience",
      "color": "#f43f5e",
      "description": "Product defects, crashes, errors the user did not expect"
    },
    {
      "id": "bug.crash",
      "label": "Crash",
      "color": "#f43f5e",
      "description": "App or device crash",
      "parentId": "bug"
    },
    {
      "id": "praise",
      "label": "Praise / positive feedback",
      "color": "#10b981",
      "description": "Compliments and positive sentiment about the product"
    },
    {
      "id": "feature-request",
      "label": "Feature request",
      "color": "#8b5cf6",
      "description": "User asking for functionality that doesn't exist"
    },
    {
      "id": "billing",
      "label": "Billing / pricing",
      "color": "#f59e0b",
      "description": "Questions or complaints about cost and subscription"
    },
    {
      "id": "onboarding",
      "label": "Onboarding / setup",
      "color": "#3b82f6",
      "description": "Difficulty getting started with the product"
    }
  ]
}
```

- [ ] **Step 8.2: Add the settings mock to return taxonomy-json in the settings GET response**

In `tests/e2e/mock-api.ts`, update the settings GET mock to include a `taxonomy-json` so the DriversConfig panel can parse it. Find:
```typescript
if (pathname === '/api/settings' && method === 'GET') {
  return route.fulfill({ json: { openrouterKeyConfigured: true } });
}
```
Replace with:
```typescript
if (pathname === '/api/settings' && method === 'GET') {
  return route.fulfill({
    json: {
      openrouterKeyConfigured: true,
      'taxonomy-json': JSON.stringify([
        { id: 'bug', label: 'Bug / broken experience', color: '#f43f5e' },
        { id: 'bug.crash', label: 'Crash', color: '#f43f5e', parentId: 'bug' },
        { id: 'praise', label: 'Praise / positive feedback', color: '#10b981' },
        { id: 'feature-request', label: 'Feature request', color: '#8b5cf6' },
        { id: 'billing', label: 'Billing / pricing', color: '#f59e0b' },
        { id: 'onboarding', label: 'Onboarding / setup', color: '#3b82f6' },
      ]),
      'routing-json': '{}',
    },
  });
}
```

- [ ] **Step 8.3: Add hierarchy e2e tests to drivers.spec.ts**

Append the following describe block at the end of `tests/e2e/drivers.spec.ts`:

```typescript
test.describe('Drivers tab — taxonomy config panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('config toggle opens the taxonomy editor panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible();
  });

  test('child driver row is indented relative to parent', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 5000 });

    // bug.crash should be indented — it has paddingLeft style set to 24px
    // We use the child-badge text to find the row
    await expect(page.getByText('child of')).toBeVisible({ timeout: 4000 });
  });

  test('+ Add sub-driver button creates a new child row', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 6000 });

    const countBefore = await page.getByTestId('taxonomy-driver-list').locator('> div').count();

    // Click + Add sub-driver on the first visible add-sub-driver button
    await page.getByText('+ Add sub-driver').first().click();

    const countAfter = await page.getByTestId('taxonomy-driver-list').locator('> div').count();
    expect(countAfter).toBe(countBefore + 1);
  });

  test('Move to... dropdown appears and lists possible targets', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 6000 });

    // Click the first "Move to…" button
    await page.getByText('Move to…').first().click();
    // The dropdown should show "(Root — no parent)" option
    await expect(page.getByText('(Root — no parent)')).toBeVisible({ timeout: 3000 });
  });

  test('"Include sub-drivers" toggle appears for driver with children', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    // Open the Bug driver (which has bug.crash as child in the fixture)
    await expect(page.getByText('Bug / broken experience')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Bug \/ broken experience/i }).click();

    // The include-sub-drivers toggle should be visible in the post panel
    await expect(page.getByTestId('include-sub-drivers-toggle')).toBeVisible({ timeout: 6000 });
  });
});

test.describe('Drivers tab — breadcrumb labels', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('child driver label shows as breadcrumb in bar list (Bug / broken experience › Crash)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    // The taxonomy fixture now has bug.crash — its bar entry should show breadcrumb
    await expect(page.getByText('Bug / broken experience')).toBeVisible({ timeout: 10000 });
    // bug.crash breadcrumb: "Bug / broken experience › Crash"
    await expect(page.getByText(/Bug.*Crash/)).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 8.4: Run the drivers e2e tests**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test:e2e -- tests/e2e/drivers.spec.ts
```

Expected: all tests pass (the existing 6 + the new 6 hierarchy tests).

- [ ] **Step 8.5: Run the settings e2e tests to confirm no regression**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test:e2e -- tests/e2e/settings.spec.ts
```

Expected: all pass.

- [ ] **Step 8.6: Commit**

```bash
cd /Users/divyansh/Projects/redlattice && git add tests/e2e/fixtures/taxonomy.json tests/e2e/mock-api.ts tests/e2e/drivers.spec.ts && git commit -m "test(e2e): add hierarchy e2e tests + update taxonomy fixture with parentId child node"
```

---

## Task 9: Full verification pass

- [ ] **Step 9.1: Run all unit tests**

```bash
cd /Users/divyansh/Projects/redlattice && npm test
```

Expected: all pass (59 existing + new hierarchy validation tests).

- [ ] **Step 9.2: Run all e2e tests**

```bash
cd /Users/divyansh/Projects/redlattice && npm run test:e2e
```

Expected: all pass (78 existing + new hierarchy tests).

- [ ] **Step 9.3: Run type-check and lint**

```bash
cd /Users/divyansh/Projects/redlattice && npm run type-check && npm run lint
```

Expected: exits 0, zero errors.

- [ ] **Step 9.4: Final commit if any cleanup needed**

```bash
cd /Users/divyansh/Projects/redlattice && git add -p && git commit -m "chore: final cleanup after IA refactor + hierarchy implementation"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Move Taxonomy editor to Contact Drivers tab | Tasks 3, 4, 5 |
| Move Per-driver routing to Contact Drivers tab | Tasks 3, 4, 5 |
| Settings keeps Brand identity, Identity & trust, Thresholds, AI, Studio, Onboarding | Task 4 |
| Update settings.spec.ts taxonomy tests to scope to Contact Drivers tab | Task 7 |
| Add drivers.spec.ts hierarchy tests | Task 8 |
| `parentId?: string | null` on TaxonomyNode (shared types + client types) | Task 1 |
| taxonomyArraySchema: reject cycles | Task 2 |
| taxonomyArraySchema: reject dangling parentId | Task 2 |
| taxonomyArraySchema: reject self-parenting | Task 2 |
| taxonomyArraySchema: max depth 3 | Task 2 |
| Backward compat: missing parentId = root | Task 2 (tests) |
| Tree editor: root at left, children indented 24px | Task 3 (`style.paddingLeft`) |
| Tree editor: + Add sub-driver per row | Task 3 (`onAddChild`) |
| Tree editor: Move to... dropdown | Task 3 (`showMoveMenu`) |
| Tree editor: collapse/expand chevron | Task 3 (`collapsed` state) |
| Tree editor: + Add root driver at bottom | Task 3 (`addRoot`) |
| DnD reorders within parent group | Task 3 (existing @dnd-kit, scoped naturally) |
| suggestDriver prefers leaf over root | Task 6 |
| classifyWithLlm prompt updated for leaf-or-root | Task 6 |
| `formatDriverPath` helper in api.ts | Task 1 |
| Breadcrumb display in driver bar list | Task 5 |
| "Include sub-drivers" toggle in DriverPostsPanel | Task 5 |
| Unit tests: cycle detection | Task 2 |
| Unit tests: depth enforcement | Task 2 |
| Unit tests: dangling parentId | Task 2 |
| Unit tests: self-parenting | Task 2 |

### Placeholder scan

No TBDs, TODOs, or vague steps found. All code blocks are complete.

### Type consistency

- `TaxonomyNode.parentId: string | null | undefined` — defined in Task 1, used as `string | null` in DriversConfig (Task 3), matched in formatDriverPath (Task 1).
- `TaxRow.parentId: string | null` — defined in Task 3, never undefined inside TaxRow (normalized to null).
- `DriverPostsPanel` gains `taxonomy: TaxonomyNode[]` prop in Task 5 — the call site in `Drivers` passes `taxonomy={taxonomy}` which is correctly typed.
- `DriverBadge` gains `taxonomy: TaxonomyNode[]` prop in Task 5 — both call sites updated (Inbox uses `taxonomy={[]}`).
- `formatDriverPath(driverId: string, taxonomy: TaxonomyNode[])` — defined Task 1, imported in Dashboard.tsx in Task 5.
