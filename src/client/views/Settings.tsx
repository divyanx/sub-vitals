/**
 * Settings tab — in-dashboard configuration UI.
 *
 * Sections:
 *   - Brand identity (brand-name, brand-voice + test draft)
 *   - Taxonomy (visual card editor + JSON fallback for contact drivers)
 *   - Routing rules (per-driver modmail routing)
 *   - Identity & trust (agent flair pattern/text/color)
 *   - Thresholds (sentiment-threshold, sla-minutes, cost-cap)
 *   - AI (openrouter key status, llm-model)
 *
 * Each section has its own Save button, isolated mutation. TanStack Query
 * powers the load + invalidation cycle.
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
import { useId, useState } from 'react';
import { api } from '../lib/api.ts';
import { OnboardingSettingsSection } from './Onboarding.tsx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

let _rowCounter = 0;

interface TaxRow {
  _uid: number;
  id: string;
  label: string;
  color: string;
  description: string;
  keywords: string[];
}

interface RoutingRow {
  _uid: number;
  driver: string;
  subject: string;
  mentions: string;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  type: 'success' | 'error';
  msg: string;
}

let _toastCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = (type: ToastItem['type'], msg: string) => {
    const id = ++_toastCounter;
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  return { toasts, toast: add };
}

function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
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

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

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
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="mt-4 rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
    >
      {loading ? 'Saving…' : 'Save'}
    </button>
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

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-neutral-300">
      {children}
    </label>
  );
}

function Input({
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  'aria-label': ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  'aria-label'?: string;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900"
    />
  );
}

// ---------------------------------------------------------------------------
// Settings view — root
// ---------------------------------------------------------------------------

export function Settings() {
  const { toasts, toast } = useToast();
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['settings'] });

  if (settingsQ.isPending) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
          />
        ))}
      </div>
    );
  }

  if (settingsQ.isError) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">Settings</h2>
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
          Failed to load settings.{' '}
          <button type="button" onClick={() => settingsQ.refetch()} className="underline">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const data = settingsQ.data;

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} />
      <header>
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">Settings</h2>
        <p className="mt-1 max-w-2xl text-xs text-neutral-400">
          Changes take effect immediately. All values are stored in Redis and override Devvit
          settings defaults. The OpenRouter API key must be set via{' '}
          <code className="rounded bg-neutral-800 px-1">
            npx devvit settings set openrouter-api-key
          </code>
          .
        </p>
      </header>

      <BrandIdentitySection data={data} toast={toast} onSaved={invalidate} />
      <TaxonomySection data={data} toast={toast} onSaved={invalidate} />
      <RoutingSection data={data} toast={toast} onSaved={invalidate} />
      <IdentityTrustSection data={data} toast={toast} onSaved={invalidate} />
      <ThresholdsSection data={data} toast={toast} onSaved={invalidate} />
      <AISection data={data} toast={toast} onSaved={invalidate} />
      <StudioSection data={data} toast={toast} onSaved={invalidate} />
      <OnboardingSettingsSection />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand identity
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<string, string> = {
  empathetic: 'border-emerald-700 bg-emerald-900/30 text-emerald-200',
  direct: 'border-orange-700 bg-orange-900/30 text-orange-200',
  concise: 'border-neutral-700 bg-neutral-900 text-neutral-200',
  investigative: 'border-blue-700 bg-blue-900/30 text-blue-200',
};

function BrandIdentitySection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const brandNameId = useId();
  const brandVoiceId = useId();
  const [brandName, setBrandName] = useState(String(data['brand-name'] ?? ''));
  const [brandVoice, setBrandVoice] = useState(String(data['brand-voice'] ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftData, setDraftData] = useState<Awaited<
    ReturnType<typeof api.settings.testDraft>
  > | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.settings.put({
        'brand-name': brandName,
        'brand-voice': brandVoice,
      }),
    onSuccess: () => {
      setError(null);
      toast('success', 'Brand identity saved.');
      onSaved();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  const testDraft = async () => {
    setDraftLoading(true);
    setDraftError(null);
    try {
      const r = await api.settings.testDraft();
      setDraftData(r);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDraftLoading(false);
    }
  };

  return (
    <Section
      title="Brand identity"
      description="Used across draft replies, impostor detection, and the triage cockpit."
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor={brandNameId}>Brand name</Label>
          <Input
            id={brandNameId}
            value={brandName}
            onChange={setBrandName}
            placeholder="e.g. Acme, Sonos, Duolingo"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Used in impostor detection. Leave blank to disable.
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor={brandVoiceId}>Brand voice</Label>
            <span className="text-[10px] text-neutral-400">{brandVoice.length}/2000</span>
          </div>
          <textarea
            id={brandVoiceId}
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Friendly, empathetic, never defensive. Acknowledge frustration first. Sign off as the Acme support team."
            className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Shapes AI draft replies. Describe tone, things to avoid, sign-off style.
          </p>
        </div>
      </div>
      <FieldError msg={error} />
      <div className="mt-4 flex flex-wrap gap-3">
        <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
        <button
          type="button"
          onClick={testDraft}
          disabled={draftLoading}
          className="rounded-md border border-violet-700 bg-violet-900/20 px-4 py-1.5 text-sm font-medium text-violet-200 transition hover:bg-violet-900/40 disabled:opacity-50"
        >
          {draftLoading ? 'Generating…' : 'Test brand voice'}
        </button>
      </div>
      {draftError ? (
        <div className="mt-3 rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {draftError}
        </div>
      ) : null}
      {draftData ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-neutral-400">
            Draft against: <span className="text-neutral-200">"{draftData.postTitle}"</span>
            <span className="ml-2 text-neutral-400">
              · {draftData.tokensIn + draftData.tokensOut} tokens · $
              {(draftData.costCents / 100).toFixed(4)}
              {draftData.cached ? ' · cached' : ''}
            </span>
          </p>
          <ul className="space-y-2">
            {draftData.candidates.map((c, i) => (
              <li
                key={`${c.tone}-${i}`}
                className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${TONE_COLOR[c.tone] ?? TONE_COLOR.concise}`}
                  >
                    {c.tone}
                  </span>
                  <span className="text-neutral-400">{c.rationale}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-neutral-200">{c.reply}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Taxonomy — visual card editor
// ---------------------------------------------------------------------------

function parseTaxonomyRows(data: Record<string, unknown>): TaxRow[] {
  const raw = data['taxonomy-json'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const arr = JSON.parse(raw) as Array<{
        id: string;
        label: string;
        color?: string;
        description?: string;
        keywords?: string[];
      }>;
      return arr.map((r) => ({
        _uid: ++_rowCounter,
        id: r.id ?? '',
        label: r.label ?? '',
        color: r.color ?? '#94a3b8',
        description: r.description ?? '',
        keywords: Array.isArray(r.keywords) ? r.keywords : [],
      }));
    } catch {
      /* fall through */
    }
  }
  return [
    {
      _uid: ++_rowCounter,
      id: 'bug',
      label: 'Bug / Issue Report',
      color: '#f87171',
      description: '',
      keywords: ['crash', 'broken', 'error', 'bug'],
    },
    {
      _uid: ++_rowCounter,
      id: 'feature',
      label: 'Feature Request',
      color: '#60a5fa',
      description: '',
      keywords: ['request', 'wish', 'add', 'would love'],
    },
    {
      _uid: ++_rowCounter,
      id: 'question',
      label: 'Question / How-to',
      color: '#fbbf24',
      description: '',
      keywords: ['how', 'help', 'can i', 'does it'],
    },
    {
      _uid: ++_rowCounter,
      id: 'billing',
      label: 'Billing / Account',
      color: '#a78bfa',
      description: '',
      keywords: ['charge', 'refund', 'invoice', 'subscription'],
    },
    {
      _uid: ++_rowCounter,
      id: 'praise',
      label: 'Praise / Feedback',
      color: '#4ade80',
      description: '',
      keywords: ['love', 'great', 'awesome', 'thank'],
    },
    {
      _uid: ++_rowCounter,
      id: 'complaint',
      label: 'Complaint',
      color: '#fb923c',
      description: '',
      keywords: ['disappointed', 'terrible', 'awful'],
    },
    {
      _uid: ++_rowCounter,
      id: 'other',
      label: 'Other',
      color: '#94a3b8',
      description: '',
      keywords: [],
    },
  ];
}

function rowsToJson(rows: TaxRow[]): string {
  return JSON.stringify(
    rows.map(({ _uid: _u, ...rest }) => rest),
    null,
    2,
  );
}

/** Inline delete-confirmation modal */
function DeleteConfirmModal({
  label,
  onConfirm,
  onCancel,
}: {
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl">
        <h4 className="mb-2 text-sm font-semibold text-neutral-100">Delete driver?</h4>
        <p className="mb-5 text-xs text-neutral-400">
          Remove <span className="font-medium text-neutral-200">"{label}"</span> from the taxonomy.
          Posts already tagged with this driver will retain their tag but the driver won't appear in
          new suggestions.
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

/** Chip input: Enter adds a keyword, clicking × removes it */
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
    if (kw && !keywords.includes(kw)) {
      onChange([...keywords, kw]);
    }
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

/** Single draggable driver card */
export function DriverCard({
  row,
  onUpdate,
  onDelete,
}: {
  row: TaxRow;
  onUpdate: (uid: number, field: keyof Omit<TaxRow, '_uid'>, val: string | string[]) => void;
  onDelete: (uid: number) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row._uid,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <>
      {confirmDelete ? (
        <DeleteConfirmModal
          label={row.label || row.id}
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
        className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
      >
        <div className="flex items-start gap-3">
          {/* Drag handle */}
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            className="mt-1 cursor-grab touch-none text-neutral-400 hover:text-neutral-400 active:cursor-grabbing"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <circle cx="4" cy="3" r="1.2" />
              <circle cx="4" cy="7" r="1.2" />
              <circle cx="4" cy="11" r="1.2" />
              <circle cx="10" cy="3" r="1.2" />
              <circle cx="10" cy="7" r="1.2" />
              <circle cx="10" cy="11" r="1.2" />
            </svg>
          </button>

          <div className="flex-1 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-400">
                  ID
                  <input
                    value={row.id}
                    onChange={(e) => onUpdate(row._uid, 'id', e.target.value)}
                    placeholder="bug"
                    className="mt-1 w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                  />
                </label>
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-neutral-400">
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
                <label className="mb-1 block text-xs font-medium text-neutral-400">
                  Color
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="color"
                      value={row.color}
                      onChange={(e) => onUpdate(row._uid, 'color', e.target.value)}
                      className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-800 p-0.5"
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
                  placeholder="Optional — describe when to use this driver"
                  rows={2}
                  className="mt-1 w-full resize-none rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                />
              </label>
            </div>
            <KeywordsInput
              keywords={row.keywords}
              onChange={(kw) => onUpdate(row._uid, 'keywords', kw)}
            />
          </div>

          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete driver ${row.label || row.id}`}
            className="mt-1 text-xs text-neutral-400 hover:text-rose-400"
            title="Delete driver"
          >
            🗑
          </button>
        </div>
      </div>
    </>
  );
}

/** Live preview bar: shows colored chips for each driver */
function TaxonomyPreview({ rows }: { rows: TaxRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
      <span className="text-xs text-neutral-400">Current drivers:</span>
      {rows
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

function TaxonomySection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<TaxRow[]>(() => parseTaxonomyRows(data));
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonText, setJsonText] = useState(() => rowsToJson(parseTaxonomyRows(data)));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const switchMode = (next: 'visual' | 'json') => {
    if (next === 'json') {
      setJsonText(rowsToJson(rows));
      setJsonError(null);
    } else {
      // Parse JSON back to rows when switching to visual
      try {
        const arr = JSON.parse(jsonText) as Array<{
          id: string;
          label: string;
          color?: string;
          description?: string;
          keywords?: string[];
        }>;
        setRows(
          arr.map((r) => ({
            _uid: ++_rowCounter,
            id: r.id ?? '',
            label: r.label ?? '',
            color: r.color ?? '#94a3b8',
            description: r.description ?? '',
            keywords: Array.isArray(r.keywords) ? r.keywords : [],
          })),
        );
        setJsonError(null);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
        return; // Don't switch if JSON is broken
      }
    }
    setMode(next);
  };

  const onJsonBlur = () => {
    try {
      JSON.parse(jsonText);
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
    }
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

  const update = (uid: number, field: keyof Omit<TaxRow, '_uid'>, val: string | string[]) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, [field]: val } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        _uid: ++_rowCounter,
        id: '',
        label: '',
        color: '#94a3b8',
        description: '',
        keywords: [],
      },
    ]);
  };

  const removeRow = (uid: number) => {
    setRows((prev) => prev.filter((r) => r._uid !== uid));
  };

  const mut = useMutation({
    mutationFn: () => {
      // In JSON mode, serialize as-is; in visual mode, derive from rows
      const payload =
        mode === 'json' ? jsonText : JSON.stringify(rows.map(({ _uid: _u, ...rest }) => rest));
      return api.settings.put({ 'taxonomy-json': payload });
    },
    onSuccess: () => {
      setSaveError(null);
      toast('success', 'Taxonomy saved ✓');
      onSaved();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  return (
    <Section
      title="Contact driver taxonomy"
      description="The category list used for tagging posts. Changes take effect on the next post auto-tagged."
    >
      {/* Mode toggle */}
      <div className="mb-4 flex items-center justify-between">
        <TaxonomyPreview rows={rows} />
        <div className="ml-auto flex gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
          <button
            type="button"
            onClick={() => switchMode('visual')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              mode === 'visual'
                ? 'bg-orange-600/30 text-orange-200'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            Visual
          </button>
          <button
            type="button"
            onClick={() => switchMode('json')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${
              mode === 'json'
                ? 'bg-orange-600/30 text-orange-200'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
            data-testid="taxonomy-json-toggle"
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
            <SortableContext items={rows.map((r) => r._uid)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3" data-testid="taxonomy-driver-list">
                {rows.map((r) => (
                  <DriverCard key={r._uid} row={r} onUpdate={update} onDelete={removeRow} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <button
            type="button"
            onClick={addRow}
            className="mt-4 text-xs text-neutral-400 underline-offset-2 hover:text-orange-300 hover:underline"
            data-testid="taxonomy-add-driver"
          >
            + Add driver
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
// Routing rules
// ---------------------------------------------------------------------------

function parseRoutingRows(data: Record<string, unknown>): RoutingRow[] {
  const raw = data['routing-json'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const obj = JSON.parse(raw) as Record<string, { subject?: string; mentions?: string[] }>;
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

function RoutingSection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<RoutingRow[]>(() => parseRoutingRows(data));
  const [error, setError] = useState<string | null>(null);

  const update = (uid: number, field: keyof Omit<RoutingRow, '_uid'>, val: string) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, [field]: val } : r)));
  };

  const addRow = () =>
    setRows((prev) => [...prev, { _uid: ++_rowCounter, driver: '', subject: '', mentions: '' }]);
  const removeRow = (uid: number) => setRows((prev) => prev.filter((r) => r._uid !== uid));

  const mut = useMutation({
    mutationFn: () =>
      api.settings.put({
        'routing-json': rowsToRoutingJson(rows),
      }),
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

// ---------------------------------------------------------------------------
// Identity & trust
// ---------------------------------------------------------------------------

function IdentityTrustSection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const patternId = useId();
  const testFlairId = useId();
  const flairTextId = useId();
  const flairColorId = useId();
  const [pattern, setPattern] = useState(String(data['agent-flair-pattern'] ?? ''));
  const [flairText, setFlairText] = useState(String(data['agent-flair-text'] ?? 'Verified Agent'));
  const [flairColor, setFlairColor] = useState(String(data['agent-flair-color'] ?? '#1e3a8a'));
  const [testFlair, setTestFlair] = useState('');
  const [error, setError] = useState<string | null>(null);

  const regexResult = (() => {
    if (!pattern.trim() || !testFlair.trim()) return null;
    try {
      return new RegExp(pattern, 'i').test(testFlair) ? 'MATCH' : 'NO MATCH';
    } catch {
      return 'INVALID REGEX';
    }
  })();

  const mut = useMutation({
    mutationFn: () =>
      api.settings.put({
        'agent-flair-pattern': pattern,
        'agent-flair-text': flairText,
        'agent-flair-color': flairColor,
      }),
    onSuccess: () => {
      setError(null);
      toast('success', 'Identity & trust settings saved.');
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
      title="Identity & trust"
      description="Configure how RedLattice detects and displays verified brand agents."
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor={patternId}>Verified-agent flair regex</Label>
          <Input
            id={patternId}
            value={pattern}
            onChange={setPattern}
            placeholder="^(Verified|Brand Team|Acme Support)$"
          />
          <div className="mt-1 flex items-center gap-2">
            <label htmlFor={testFlairId} className="sr-only">
              Test flair text
            </label>
            <input
              id={testFlairId}
              type="text"
              value={testFlair}
              onChange={(e) => setTestFlair(e.target.value)}
              placeholder="Test flair text…"
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
            />
            {regexResult ? (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  regexResult === 'MATCH'
                    ? 'bg-emerald-900/50 text-emerald-200'
                    : regexResult === 'NO MATCH'
                      ? 'bg-neutral-800 text-neutral-400'
                      : 'bg-rose-900/50 text-rose-200'
                }`}
              >
                {regexResult}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Commenters whose flair matches this regex are treated as verified agents.
          </p>
        </div>
        <div>
          <Label htmlFor={flairTextId}>Flair text to apply on verification</Label>
          <Input
            id={flairTextId}
            value={flairText}
            onChange={setFlairText}
            placeholder="Verified Agent"
          />
        </div>
        <div>
          <Label htmlFor={flairColorId}>Flair background color</Label>
          <div className="flex items-center gap-3">
            <input
              id={flairColorId}
              type="color"
              value={flairColor}
              onChange={(e) => setFlairColor(e.target.value)}
              aria-label="Flair background color picker"
              className="h-9 w-14 cursor-pointer rounded border border-neutral-700 bg-neutral-800 p-0.5"
            />
            <span className="text-xs text-neutral-400">{flairColor}</span>
          </div>
        </div>
      </div>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

function ThresholdsSection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const sentThreshId = useId();
  const slaMinutesId = useId();
  const costCapId = useId();
  const [sentThreshold, setSentThreshold] = useState(Number(data['sentiment-threshold'] ?? 5));
  const [slaMinutes, setSlaMinutes] = useState(Number(data['sla-minutes'] ?? 120));
  const [costCapCents, setCostCapCents] = useState(
    Number(data['llm-monthly-cost-cap-cents'] ?? 500),
  );
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.settings.put({
        'sentiment-threshold': sentThreshold,
        'sla-minutes': slaMinutes,
        'llm-monthly-cost-cap-cents': costCapCents,
      }),
    onSuccess: () => {
      setError(null);
      toast('success', 'Thresholds saved.');
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
      title="Thresholds"
      description="Tune alerting sensitivity, SLA targets, and AI spend limits."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={sentThreshId}>Negative comment alert threshold</Label>
          <input
            id={sentThreshId}
            type="number"
            min={2}
            max={50}
            value={sentThreshold}
            onChange={(e) => setSentThreshold(Number(e.target.value))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Modmail fires when a thread has this many negative comments in the last{' '}
            {Math.round(sentThreshold)} sampled.
          </p>
        </div>
        <div>
          <Label htmlFor={slaMinutesId}>First-response SLA (minutes)</Label>
          <input
            id={slaMinutesId}
            type="number"
            min={15}
            max={1440}
            value={slaMinutes}
            onChange={(e) => setSlaMinutes(Number(e.target.value))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Posts unanswered beyond this SLA appear in the breach feed.
          </p>
        </div>
        <div>
          <Label htmlFor={costCapId}>Monthly AI cost cap</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-400" aria-hidden="true">
              $
            </span>
            <input
              id={costCapId}
              type="number"
              min={0}
              max={1000}
              step={0.01}
              value={(costCapCents / 100).toFixed(2)}
              onChange={(e) => setCostCapCents(Math.round(Number(e.target.value) * 100))}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
            />
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            When exceeded, AI tagging falls back to lexicon-only. Current value: {costCapCents}{' '}
            cents.
          </p>
        </div>
      </div>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

function AISection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const modelId = useId();
  const [model, setModel] = useState(String(data['llm-model'] ?? 'anthropic/claude-haiku-4.5'));
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.settings.put({
        'llm-model': model,
      }),
    onSuccess: () => {
      setError(null);
      toast('success', 'AI settings saved.');
      onSaved();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  return (
    <Section title="AI" description="OpenRouter model and API key status.">
      <div className="space-y-4">
        <div
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
            data.openrouterKeyConfigured
              ? 'border-emerald-800 bg-emerald-950/30 text-emerald-200'
              : 'border-amber-800 bg-amber-950/30 text-amber-200'
          }`}
        >
          <span className="text-base">{data.openrouterKeyConfigured ? '✓' : '⚠'}</span>
          {data.openrouterKeyConfigured ? (
            <span>OpenRouter API key is configured.</span>
          ) : (
            <span>
              No API key set. Run{' '}
              <code className="rounded bg-amber-900/40 px-1">
                npx devvit settings set openrouter-api-key
              </code>{' '}
              to enable AI features.
            </span>
          )}
        </div>
        <div>
          <Label htmlFor={modelId}>OpenRouter model slug</Label>
          <Input
            id={modelId}
            value={model}
            onChange={setModel}
            placeholder="anthropic/claude-haiku-4.5"
          />
          <p className="mt-1 text-xs text-neutral-400">
            e.g. anthropic/claude-haiku-4.5, openai/gpt-5-mini, google/gemini-2.5-flash
          </p>
        </div>
      </div>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// RedLattice Studio connection
// ---------------------------------------------------------------------------

interface StudioStatus {
  connected: boolean;
  studioUrl: string;
  tokenConfigured: boolean;
}

interface StudioTestResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

function StudioSection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const studioUrlId = useId();
  const studioTokenId = useId();
  const [studioUrl, setStudioUrl] = useState(
    String(data['studio-url'] ?? 'https://studio.redlattice.app'),
  );
  const [token, setToken] = useState(String(data['studio-token'] ?? ''));
  const [testResult, setTestResult] = useState<StudioTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusQ = useQuery({
    queryKey: ['studio-status'],
    queryFn: () => api.studio.status(),
    retry: false,
  });

  const saveMut = useMutation({
    mutationFn: () => api.studio.saveSettings({ 'studio-url': studioUrl, 'studio-token': token }),
    onSuccess: () => {
      setError(null);
      toast('success', 'Studio settings saved.');
      onSaved();
      void statusQ.refetch();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => api.studio.disconnect(),
    onSuccess: () => {
      setToken('');
      toast('success', 'Disconnected from Studio.');
      onSaved();
      void statusQ.refetch();
    },
    onError: (err) => {
      toast('error', `Disconnect failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const testConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await api.studio.testConnection();
      setTestResult(result);
      toast(
        result.ok ? 'success' : 'error',
        result.ok
          ? 'Connection test passed.'
          : `Test failed: ${result.error ?? `HTTP ${result.statusCode}`}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, error: msg });
      toast('error', `Test failed: ${msg}`);
    } finally {
      setTestLoading(false);
    }
  };

  const status = statusQ.data as StudioStatus | undefined;
  const connected = status?.connected ?? false;

  return (
    <Section
      title="RedLattice Studio"
      description="Connect this subreddit to RedLattice Studio for cross-sub analytics and custom pipelines."
    >
      {/* Connection status banner */}
      <div
        className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
          connected
            ? 'border-emerald-800 bg-emerald-950/30 text-emerald-200'
            : 'border-neutral-700 bg-neutral-900 text-neutral-400'
        }`}
        data-testid="studio-status-banner"
      >
        <span className="text-base">{connected ? '✓' : '○'}</span>
        {connected ? (
          <span>
            Connected to{' '}
            <span className="font-medium text-emerald-100">{status?.studioUrl ?? studioUrl}</span>
          </span>
        ) : (
          <span>Not connected — enter a Studio URL and connection token below.</span>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor={studioUrlId}>Studio URL</Label>
          <Input
            id={studioUrlId}
            value={studioUrl}
            onChange={setStudioUrl}
            placeholder="https://studio.redlattice.app"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Base URL of your RedLattice Studio instance.
          </p>
        </div>
        <div>
          <Label htmlFor={studioTokenId}>Connection token</Label>
          <Input
            id={studioTokenId}
            type="password"
            value={token}
            onChange={setToken}
            placeholder="Paste the token from Studio > Settings > Connections"
          />
          <p className="mt-1 text-xs text-neutral-400">
            Issued by Studio. Stored encrypted in Redis per installation.
          </p>
        </div>
      </div>

      {testResult ? (
        <div
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            testResult.ok
              ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
              : 'border-rose-700 bg-rose-950/40 text-rose-200'
          }`}
        >
          {testResult.ok
            ? `Connection test passed (HTTP ${testResult.statusCode ?? 200}).`
            : `Connection test failed: ${testResult.error ?? `HTTP ${testResult.statusCode}`}`}
        </div>
      ) : null}

      <FieldError msg={error} />

      <div className="mt-4 flex flex-wrap gap-3">
        <SaveButton onClick={() => saveMut.mutate()} loading={saveMut.isPending} />
        <button
          type="button"
          onClick={testConnection}
          disabled={testLoading || !token.trim()}
          className="rounded-md border border-blue-700 bg-blue-900/20 px-4 py-1.5 text-sm font-medium text-blue-200 transition hover:bg-blue-900/40 disabled:opacity-50"
          data-testid="studio-test-button"
        >
          {testLoading ? 'Testing…' : 'Test connection'}
        </button>
        {connected ? (
          <button
            type="button"
            onClick={() => disconnectMut.mutate()}
            disabled={disconnectMut.isPending}
            className="rounded-md border border-rose-700 bg-rose-900/20 px-4 py-1.5 text-sm font-medium text-rose-200 transition hover:bg-rose-900/40 disabled:opacity-50"
            data-testid="studio-disconnect-button"
          >
            {disconnectMut.isPending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : null}
      </div>
    </Section>
  );
}
