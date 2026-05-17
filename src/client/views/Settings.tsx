/**
 * Settings tab — in-dashboard configuration UI.
 *
 * Sections:
 *   - Brand identity (brand-name, brand-voice + test draft)
 *   - Taxonomy (editable table of contact drivers)
 *   - Routing rules (per-driver modmail routing)
 *   - Identity & trust (agent flair pattern/text/color)
 *   - Thresholds (sentiment-threshold, sla-minutes, cost-cap)
 *   - AI (openrouter key status, llm-model)
 *
 * Each section has its own Save button, isolated mutation. TanStack Query
 * powers the load + invalidation cycle.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useState } from 'react';
import { api } from '../lib/api.ts';

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
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg transition-all ${
            t.type === 'success'
              ? 'border-emerald-700 bg-emerald-950 text-emerald-100'
              : 'border-rose-700 bg-rose-950 text-rose-100'
          }`}
        >
          {t.msg}
        </div>
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
      {description ? <p className="mb-4 text-xs text-neutral-500">{description}</p> : null}
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
      className="mt-4 rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
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

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-xs font-medium text-neutral-300">{children}</span>;
}

function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
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
      <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
        Failed to load settings.{' '}
        <button type="button" onClick={() => settingsQ.refetch()} className="underline">
          Retry
        </button>
      </div>
    );
  }

  const data = settingsQ.data;

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} />
      <header>
        <h2 className="text-sm uppercase tracking-wide text-neutral-400">Settings</h2>
        <p className="mt-1 max-w-2xl text-xs text-neutral-500">
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
          <Label>Brand name</Label>
          <Input
            value={brandName}
            onChange={setBrandName}
            placeholder="e.g. Acme, Sonos, Duolingo"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Used in impostor detection. Leave blank to disable.
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Brand voice</Label>
            <span className="text-[10px] text-neutral-500">{brandVoice.length}/2000</span>
          </div>
          <textarea
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Friendly, empathetic, never defensive. Acknowledge frustration first. Sign off as the Acme support team."
            className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
          />
          <p className="mt-1 text-xs text-neutral-500">
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
            <span className="ml-2 text-neutral-500">
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
                  <span className="text-neutral-500">{c.rationale}</span>
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
// Taxonomy
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
      }>;
      return arr.map((r) => ({
        _uid: ++_rowCounter,
        id: r.id ?? '',
        label: r.label ?? '',
        color: r.color ?? '#94a3b8',
        description: r.description ?? '',
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
    },
    {
      _uid: ++_rowCounter,
      id: 'feature',
      label: 'Feature Request',
      color: '#60a5fa',
      description: '',
    },
    {
      _uid: ++_rowCounter,
      id: 'question',
      label: 'Question / How-to',
      color: '#fbbf24',
      description: '',
    },
    {
      _uid: ++_rowCounter,
      id: 'billing',
      label: 'Billing / Account',
      color: '#a78bfa',
      description: '',
    },
    {
      _uid: ++_rowCounter,
      id: 'praise',
      label: 'Praise / Feedback',
      color: '#4ade80',
      description: '',
    },
    { _uid: ++_rowCounter, id: 'complaint', label: 'Complaint', color: '#fb923c', description: '' },
    { _uid: ++_rowCounter, id: 'other', label: 'Other', color: '#94a3b8', description: '' },
  ];
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
  const [error, setError] = useState<string | null>(null);

  const update = (uid: number, field: keyof Omit<TaxRow, '_uid'>, val: string) => {
    setRows((prev) => prev.map((r) => (r._uid === uid ? { ...r, [field]: val } : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { _uid: ++_rowCounter, id: '', label: '', color: '#94a3b8', description: '' },
    ]);
  };

  const removeRow = (uid: number) => {
    setRows((prev) => prev.filter((r) => r._uid !== uid));
  };

  const mut = useMutation({
    mutationFn: () =>
      api.settings.put({
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        'taxonomy-json': JSON.stringify(rows.map(({ _uid: _u, ...rest }) => rest)),
      }),
    onSuccess: () => {
      setError(null);
      toast('success', 'Taxonomy saved.');
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
      title="Contact driver taxonomy"
      description="The category list used for tagging posts. Changes take effect on the next post auto-tagged."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-neutral-500">
              <th className="pb-2 pr-3 font-medium">ID</th>
              <th className="pb-2 pr-3 font-medium">Label</th>
              <th className="pb-2 pr-3 font-medium">Color</th>
              <th className="pb-2 pr-3 font-medium">Description</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/60">
            {rows.map((r) => (
              <tr key={r._uid}>
                <td className="py-2 pr-3">
                  <input
                    value={r.id}
                    onChange={(e) => update(r._uid, 'id', e.target.value)}
                    placeholder="bug"
                    className="w-24 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    value={r.label}
                    onChange={(e) => update(r._uid, 'label', e.target.value)}
                    placeholder="Bug / Issue Report"
                    className="w-40 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="color"
                    value={r.color}
                    onChange={(e) => update(r._uid, 'color', e.target.value)}
                    className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-800 p-0.5"
                  />
                </td>
                <td className="py-2 pr-3">
                  <input
                    value={r.description}
                    onChange={(e) => update(r._uid, 'description', e.target.value)}
                    placeholder="Optional description"
                    className="w-48 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
                  />
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => removeRow(r._uid)}
                    className="text-neutral-600 hover:text-rose-400"
                    title="Remove row"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-3 text-xs text-neutral-400 underline-offset-2 hover:text-orange-300 hover:underline"
      >
        + Add row
      </button>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
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
        <p className="mb-3 text-xs text-neutral-500">No routing rules yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
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
                      className="text-neutral-600 hover:text-rose-400"
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
          <Label>Verified-agent flair regex</Label>
          <Input
            value={pattern}
            onChange={setPattern}
            placeholder="^(Verified|Brand Team|Acme Support)$"
          />
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              value={testFlair}
              onChange={(e) => setTestFlair(e.target.value)}
              placeholder="Test flair text…"
              className="flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-orange-500"
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
          <p className="mt-1 text-xs text-neutral-500">
            Commenters whose flair matches this regex are treated as verified agents.
          </p>
        </div>
        <div>
          <Label>Flair text to apply on verification</Label>
          <Input value={flairText} onChange={setFlairText} placeholder="Verified Agent" />
        </div>
        <div>
          <Label>Flair background color</Label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={flairColor}
              onChange={(e) => setFlairColor(e.target.value)}
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
          <Label>Negative comment alert threshold</Label>
          <input
            type="number"
            min={2}
            max={50}
            value={sentThreshold}
            onChange={(e) => setSentThreshold(Number(e.target.value))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Modmail fires when a thread has this many negative comments in the last{' '}
            {Math.round(sentThreshold)} sampled.
          </p>
        </div>
        <div>
          <Label>First-response SLA (minutes)</Label>
          <input
            type="number"
            min={15}
            max={1440}
            value={slaMinutes}
            onChange={(e) => setSlaMinutes(Number(e.target.value))}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
          />
          <p className="mt-1 text-xs text-neutral-500">
            Posts unanswered beyond this SLA appear in the breach feed.
          </p>
        </div>
        <div>
          <Label>Monthly AI cost cap</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-neutral-400">$</span>
            <input
              type="number"
              min={0}
              max={1000}
              step={0.01}
              value={(costCapCents / 100).toFixed(2)}
              onChange={(e) => setCostCapCents(Math.round(Number(e.target.value) * 100))}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-orange-500"
            />
          </div>
          <p className="mt-1 text-xs text-neutral-500">
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
          <Label>OpenRouter model slug</Label>
          <Input value={model} onChange={setModel} placeholder="anthropic/claude-haiku-4.5" />
          <p className="mt-1 text-xs text-neutral-500">
            e.g. anthropic/claude-haiku-4.5, openai/gpt-5-mini, google/gemini-2.5-flash
          </p>
        </div>
      </div>
      <FieldError msg={error} />
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}
