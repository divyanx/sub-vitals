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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useId, useState } from 'react';
import { api, type Webhook, type WebhookDelivery, type WebhookFormat } from '../lib/api.ts';
import { OnboardingSettingsSection } from './Onboarding.tsx';

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
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h3 className="mb-1 text-sm font-semibold text-[var(--text)]">{title}</h3>
      {description ? <p className="mb-4 text-xs text-[var(--text-muted)]">{description}</p> : null}
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
    <div className="mt-6 flex justify-end border-t border-[var(--border)] pt-4">
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

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-[var(--text)]">
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
      className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900"
    />
  );
}

// ---------------------------------------------------------------------------
// Settings view — root
// ---------------------------------------------------------------------------

type SettingsSection = 'brand' | 'team-roster' | 'thresholds' | 'ai' | 'webhooks' | 'all';

export function Settings({ initialSection = 'all' }: { initialSection?: SettingsSection }) {
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
            className="h-40 animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          />
        ))}
      </div>
    );
  }

  if (settingsQ.isError) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Settings</h2>
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
  const show = (s: SettingsSection) => initialSection === 'all' || initialSection === s;

  return (
    <div className="space-y-6">
      <ToastContainer toasts={toasts} />
      {initialSection === 'all' && (
        <header>
          <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Settings</h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--text-muted)]">
            Changes take effect immediately. All values are stored in Redis and override Devvit
            settings defaults. The OpenRouter API key must be set via{' '}
            <code className="rounded bg-[var(--input-bg)] px-1">
              npx devvit settings set openrouter-api-key
            </code>
            .
          </p>
        </header>
      )}

      {show('brand') && <BrandIdentitySection data={data} toast={toast} onSaved={invalidate} />}
      {show('brand') && <BrandAccentSection data={data} toast={toast} onSaved={invalidate} />}
      {show('team-roster') && (
        <IdentityTrustSection data={data} toast={toast} onSaved={invalidate} />
      )}
      {show('thresholds') && <ThresholdsSection data={data} toast={toast} onSaved={invalidate} />}
      {show('ai') && <AISection data={data} toast={toast} onSaved={invalidate} />}
      {show('webhooks') && <WebhooksSection toast={toast} />}
      {initialSection === 'all' && <StudioSection data={data} toast={toast} onSaved={invalidate} />}
      {initialSection === 'all' && <OnboardingSettingsSection />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand identity
// ---------------------------------------------------------------------------

const TONE_COLOR: Record<string, string> = {
  empathetic: 'border-emerald-700 bg-emerald-900/30 text-emerald-200',
  direct: 'border-orange-700 bg-orange-900/30 text-orange-200',
  concise: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]',
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
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Used in impostor detection. Leave blank to disable.
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label htmlFor={brandVoiceId}>Brand voice</Label>
            <span className="text-[10px] text-[var(--text-muted)]">{brandVoice.length}/2000</span>
          </div>
          <textarea
            id={brandVoiceId}
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="Friendly, empathetic, never defensive. Acknowledge frustration first. Sign off as the Acme support team."
            className="w-full resize-y rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-1 focus-visible:ring-offset-neutral-900"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Shapes AI draft replies. Describe tone, things to avoid, sign-off style.
          </p>
        </div>
      </div>
      <FieldError msg={error} />
      <div className="mt-4">
        <button
          type="button"
          onClick={testDraft}
          disabled={draftLoading}
          className="rounded-md border border-violet-700 bg-violet-900/20 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-900/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500"
        >
          {draftLoading ? '✨ Generating…' : '✨ Test brand voice'}
        </button>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Generates 3 sample AI replies against a recent post to preview your tone.
        </p>
      </div>
      {draftError ? (
        <div className="mt-3 rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {draftError}
        </div>
      ) : null}
      {draftData ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Draft against: <span className="text-[var(--text)]">"{draftData.postTitle}"</span>
            <span className="ml-2 text-[var(--text-muted)]">
              · {draftData.tokensIn + draftData.tokensOut} tokens · $
              {(draftData.costCents / 100).toFixed(4)}
              {draftData.cached ? ' · cached' : ''}
            </span>
          </p>
          <ul className="space-y-2">
            {draftData.candidates.map((c, i) => (
              <li
                key={`${c.tone}-${i}`}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)]/50 p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${TONE_COLOR[c.tone] ?? TONE_COLOR.concise}`}
                  >
                    {c.tone}
                  </span>
                  <span className="text-[var(--text-muted)]">{c.rationale}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-[var(--text)]">{c.reply}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <SaveButton onClick={() => mut.mutate()} loading={mut.isPending} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Brand accent color
// ---------------------------------------------------------------------------

function BrandAccentSection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [hex, setHex] = useState<string>(
    typeof data['brand-accent'] === 'string' ? data['brand-accent'] : '#FF4500',
  );

  const mut = useMutation({
    mutationFn: (updates: Record<string, unknown>) => api.settings.put(updates),
    onSuccess: () => {
      toast('success', 'Accent color saved.');
      void qc.invalidateQueries({ queryKey: ['settings'] });
      onSaved();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <Section
      title="Brand accent color"
      description="Overrides the Reddit orange accent across the dashboard. The color is derived into 4 tonal stops automatically."
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="accent-picker" className="text-xs font-medium text-[var(--n-11)]">
            Accent hex
          </label>
          <div className="flex items-center gap-3">
            <input
              id="accent-picker"
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] p-1"
              aria-label="Pick brand accent color"
            />
            <input
              type="text"
              value={hex}
              onChange={(e) => {
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setHex(v);
              }}
              maxLength={7}
              className="w-28 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-3 py-2 text-sm font-mono text-[var(--n-11)] uppercase outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
              aria-label="Accent color hex value"
            />
            <span
              aria-hidden="true"
              style={{ background: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : undefined }}
              className="h-8 w-8 rounded-full border border-[var(--n-4)]"
            />
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={() => mut.mutate({ 'brand-accent': hex })}
          disabled={mut.isPending || !/^#[0-9a-fA-F]{6}$/.test(hex)}
          className="rounded-md border border-[var(--accent-9)] bg-[var(--accent-3)] px-4 py-1.5 text-sm font-medium text-[var(--accent-11)] transition hover:bg-[var(--accent-9)] hover:text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
        >
          {mut.isPending ? 'Saving…' : 'Save accent'}
        </button>
      </div>
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
      description="Configure how RedLattice detects and displays verified brand reps."
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor={patternId}>Verified-rep flair regex</Label>
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
              className="flex-1 rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
            />
            {regexResult ? (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${
                  regexResult === 'MATCH'
                    ? 'bg-emerald-900/50 text-emerald-200'
                    : regexResult === 'NO MATCH'
                      ? 'bg-[var(--input-bg)] text-[var(--text-muted)]'
                      : 'bg-rose-900/50 text-rose-200'
                }`}
              >
                {regexResult}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Commenters whose flair matches this regex are treated as verified reps.
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
              className="h-9 w-14 cursor-pointer rounded border border-[var(--border)] bg-[var(--input-bg)] p-0.5"
            />
            <span className="text-xs text-[var(--text-muted)]">{flairColor}</span>
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
            className="w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
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
            className="w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Posts unanswered beyond this SLA appear in the breach feed.
          </p>
        </div>
        <div>
          <Label htmlFor={costCapId}>Monthly AI cost cap</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-muted)]" aria-hidden="true">
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
              className="w-full rounded border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
            />
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
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

const TIER_BADGE: Record<string, string> = {
  recommended: 'bg-orange-900/50 text-orange-200 border-orange-700',
  fast: 'bg-blue-900/50 text-blue-200 border-blue-700',
  cheapest: 'bg-emerald-900/50 text-emerald-200 border-emerald-700',
  best: 'bg-violet-900/50 text-violet-200 border-violet-700',
  'eu-hosted': 'bg-sky-900/50 text-sky-200 border-sky-700',
};

const TIER_LABELS: Record<string, string> = {
  recommended: 'Recommended',
  fast: 'Fast',
  cheapest: 'Cheapest',
  best: 'Best',
  'eu-hosted': 'EU',
};

type ValidationResult = {
  valid: boolean;
  supportsStructuredOutput: boolean;
  inCatalog?: boolean;
  estimatedCostCents?: number | null;
  error?: string;
  hint?: string;
};

function AISection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
  const customModelId = useId();

  // AI status query (catalog + fallback state).
  const aiStatusQ = useQuery({
    queryKey: ['ai-status'],
    queryFn: api.ai.status,
    staleTime: 30_000,
  });

  const catalog = aiStatusQ.data?.catalog ?? [];
  const isFallback = aiStatusQ.data?.isFallback ?? false;
  const originalSlug = aiStatusQ.data?.originalSlug ?? null;
  const defaultModel = aiStatusQ.data?.defaultModel ?? 'anthropic/claude-haiku-4.5';

  // Current effective model slug from settings (may be a custom slug not in catalog).
  const currentSlug = String(data['llm-model'] ?? defaultModel);
  const inCatalog = catalog.some((m) => m.slug === currentSlug);

  const [selectedSlug, setSelectedSlug] = useState(inCatalog ? currentSlug : defaultModel);
  const [customModel, setCustomModel] = useState(inCatalog ? '' : currentSlug);
  const [useCustom, setUseCustom] = useState(!inCatalog && currentSlug !== defaultModel);

  const effectiveSlug = useCustom && customModel.trim() ? customModel.trim() : selectedSlug;

  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const qc = useQueryClient();

  const saveMut = useMutation({
    mutationFn: () => api.settings.put({ 'llm-model': effectiveSlug }),
    onSuccess: () => {
      setSaveError(null);
      toast('success', 'AI settings saved.');
      onSaved();
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      toast('error', `Save failed: ${msg}`);
    },
  });

  const clearFallbackMut = useMutation({
    mutationFn: api.ai.clearFallback,
    onSuccess: () => {
      toast('success', 'Fallback cleared — original model will be tried again.');
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
    onError: (err) => {
      toast('error', `Clear failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const acceptDefaultMut = useMutation({
    mutationFn: async () => {
      // Clear the fallback flag then save the default model explicitly.
      await api.ai.clearFallback();
      return api.settings.put({ 'llm-model': defaultModel });
    },
    onSuccess: () => {
      toast('success', `Model set to ${defaultModel}.`);
      setSelectedSlug(defaultModel);
      setUseCustom(false);
      setCustomModel('');
      onSaved();
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
    },
    onError: (err) => {
      toast('error', `Failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const validate = async (slug: string) => {
    if (!slug.trim()) return;
    setValidating(true);
    setValidation(null);
    try {
      const result = await api.ai.validateModel(slug);
      setValidation(result);
    } catch (err) {
      setValidation({
        valid: false,
        supportsStructuredOutput: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setValidating(false);
    }
  };

  const handleDropdownChange = (slug: string) => {
    setSelectedSlug(slug);
    setValidation(null);
    void validate(slug);
  };

  const handleCustomChange = (v: string) => {
    setCustomModel(v);
    setValidation(null);
  };

  const handleCustomBlur = () => {
    if (customModel.trim()) {
      void validate(customModel.trim());
    }
  };

  // Cost estimate widget — read daily volume from driver rollup.
  const todayDriverQ = useQuery({
    queryKey: ['driver-volume-today'],
    queryFn: api.driverVolume,
    staleTime: 60_000,
  });
  const dailyPosts =
    todayDriverQ.data?.series?.[todayDriverQ.data.series.length - 1]?.totalPosts ?? null;

  const catalogEntry = catalog.find((m) => m.slug === effectiveSlug);
  const monthlyCostEst =
    catalogEntry && dailyPosts !== null
      ? ((dailyPosts * 30 * catalogEntry.pricePer1kTaggingCalls) / 1000).toFixed(2)
      : null;

  return (
    <Section title="AI" description="OpenRouter model selection, validation, and API key status.">
      <div className="space-y-4">
        {/* API Key status */}
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

        {/* Auto-fallback alert */}
        {isFallback && originalSlug ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-amber-700 bg-amber-950/30 px-4 py-3 text-sm text-amber-200"
            data-testid="fallback-alert"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base">⚠</span>
              <span>
                <strong>AI auto-fallback active</strong> — using{' '}
                <code className="rounded bg-amber-900/40 px-1">{defaultModel}</code> because{' '}
                <code className="rounded bg-amber-900/40 px-1">{originalSlug}</code> had repeated
                errors.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => acceptDefaultMut.mutate()}
                disabled={acceptDefaultMut.isPending}
                className="rounded border border-emerald-700 bg-emerald-900/30 px-3 py-1 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/50 disabled:opacity-50"
              >
                Use default permanently
              </button>
              <button
                type="button"
                onClick={() => clearFallbackMut.mutate()}
                disabled={clearFallbackMut.isPending}
                className="rounded border border-amber-700 bg-amber-900/30 px-3 py-1 text-xs font-medium text-amber-200 transition hover:bg-amber-900/50 disabled:opacity-50"
              >
                Try {originalSlug} again
              </button>
            </div>
          </div>
        ) : null}

        {/* Model dropdown */}
        <div>
          <Label>AI model</Label>
          {aiStatusQ.isPending ? (
            <div className="h-10 animate-pulse rounded-md border border-[var(--border)] bg-[var(--input-bg)]" />
          ) : (
            <select
              value={useCustom ? '__custom__' : selectedSlug}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setUseCustom(true);
                } else {
                  setUseCustom(false);
                  handleDropdownChange(e.target.value);
                }
              }}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500"
              data-testid="model-dropdown"
            >
              {catalog.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.label} ({TIER_LABELS[m.tier] ?? m.tier}) — ~$
                  {m.pricePer1kTaggingCalls.toFixed(4)}/1k calls
                </option>
              ))}
              <option value="__custom__">Custom model…</option>
            </select>
          )}

          {/* Tier + price chips for selected model */}
          {!useCustom && catalogEntry ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                  TIER_BADGE[catalogEntry.tier] ??
                  'bg-[var(--input-bg)] text-[var(--text)] border-[var(--border)]'
                }`}
              >
                {TIER_LABELS[catalogEntry.tier] ?? catalogEntry.tier}
              </span>
              <span className="rounded-full border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-xs text-[var(--text)]">
                ~${catalogEntry.pricePer1kTaggingCalls.toFixed(4)}/1k posts
              </span>
              {catalogEntry.notes ? (
                <span className="text-xs text-[var(--text-muted)]">{catalogEntry.notes}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Custom model input */}
        {useCustom ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <Label htmlFor={customModelId}>Custom model slug</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id={customModelId}
                value={customModel}
                onChange={handleCustomChange}
                placeholder="provider/model-name"
              />
              <button
                type="button"
                onClick={handleCustomBlur}
                disabled={validating || !customModel.trim()}
                className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs font-medium text-[var(--text)] transition hover:bg-neutral-700 disabled:opacity-50"
              >
                {validating ? 'Checking…' : 'Validate'}
              </button>
            </div>
            <p className="mt-1 text-xs text-amber-400">
              Unverified — may not work with all pipelines.
            </p>
          </div>
        ) : null}

        {/* Validation result */}
        {validating ? (
          <div className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
            <span className="animate-spin">⟳</span> Validating model…
          </div>
        ) : validation ? (
          <div
            className={`rounded border px-3 py-2 text-xs ${
              !validation.valid
                ? 'border-rose-700 bg-rose-950/40 text-rose-200'
                : !validation.supportsStructuredOutput
                  ? 'border-amber-700 bg-amber-950/40 text-amber-200'
                  : 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
            }`}
            data-testid="validation-result"
          >
            <span className="mr-1 font-bold">
              {!validation.valid ? '✗' : !validation.supportsStructuredOutput ? '⚠' : '✓'}
            </span>
            {!validation.valid
              ? `Model invalid: ${validation.hint ?? validation.error ?? 'unknown error'}`
              : !validation.supportsStructuredOutput
                ? 'This model returned a result but does not reliably support structured output. Tagging pipelines may fail; free-text drafts will work.'
                : 'Validated — this model supports all pipelines.'}
            {!validation.inCatalog && validation.valid ? (
              <span className="ml-1 text-amber-400">(Not in curated catalog.)</span>
            ) : null}
          </div>
        ) : null}

        {/* Cost estimate widget */}
        {monthlyCostEst !== null && dailyPosts !== null ? (
          <div className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text)]">
            At {dailyPosts} posts/day, estimated monthly AI cost ≈{' '}
            <strong className="text-[var(--text)]">${monthlyCostEst}</strong>
          </div>
        ) : null}
      </div>

      <FieldError msg={saveError} />

      <div className="mt-6 flex justify-end border-t border-[var(--border)] pt-4">
        <button
          type="button"
          onClick={() => {
            void validate(effectiveSlug);
            saveMut.mutate();
          }}
          disabled={saveMut.isPending}
          className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
        >
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
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
            : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]'
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
          <p className="mt-1 text-xs text-[var(--text-muted)]">
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
          <p className="mt-1 text-xs text-[var(--text-muted)]">
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={testConnection}
          disabled={testLoading || !token.trim()}
          className="rounded-md border border-blue-700 bg-blue-900/20 px-3 py-1.5 text-xs font-medium text-blue-200 transition hover:bg-blue-900/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
          data-testid="studio-test-button"
        >
          {testLoading ? 'Testing…' : '🔌 Test connection'}
        </button>
        {connected ? (
          <button
            type="button"
            onClick={() => disconnectMut.mutate()}
            disabled={disconnectMut.isPending}
            className="rounded-md border border-rose-800 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-900/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-500"
            data-testid="studio-disconnect-button"
          >
            {disconnectMut.isPending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : null}
      </div>
      <SaveButton onClick={() => saveMut.mutate()} loading={saveMut.isPending} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const ALL_EVENT_KINDS: Array<{ value: string; label: string }> = [
  { value: 'post-tag', label: 'Post tagged' },
  { value: 'sentiment-spike', label: 'Sentiment spike' },
  { value: 'incident-open', label: 'Incident opened' },
  { value: 'incident-resolve', label: 'Incident resolved' },
  { value: 'theme-regenerate', label: 'Themes regenerated' },
  { value: 'custom-rule-fire', label: 'Custom rule fired' },
  { value: '*', label: 'All events' },
];

const FORMAT_LABELS: Record<string, string> = {
  slack: 'Slack',
  discord: 'Discord',
  pagerduty: 'PagerDuty',
  generic: 'Generic JSON',
};

function FormatChip({ format }: { format: WebhookFormat }) {
  const colors: Record<string, string> = {
    slack: 'border-emerald-700 bg-emerald-900/30 text-emerald-200',
    discord: 'border-indigo-700 bg-indigo-900/30 text-indigo-200',
    pagerduty: 'border-green-700 bg-green-900/30 text-green-200',
    generic: 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]',
  };
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${colors[format] ?? colors.generic}`}
    >
      {FORMAT_LABELS[format] ?? format}
    </span>
  );
}

function DeliveryRow({ d }: { d: WebhookDelivery }) {
  const ts = new Date(d.attemptedAt).toLocaleString();
  return (
    <tr className="border-t border-[var(--border)] text-xs">
      <td className="py-1 pr-3 text-[var(--text-muted)]">{ts}</td>
      <td className="py-1 pr-3 font-mono text-[var(--text)]">{d.eventKind}</td>
      <td className="py-1 pr-3">
        {d.success ? (
          <span className="text-emerald-400">&#x2713; {d.statusCode}</span>
        ) : (
          <span className="text-rose-400">&#x2717; {d.statusCode ?? 'err'}</span>
        )}
      </td>
      <td className="max-w-[180px] truncate py-1 text-[var(--text-muted)]">{d.responseExcerpt}</td>
    </tr>
  );
}

function WebhookRow({
  hook,
  onToggle,
  onDelete,
  onTest,
  onEdit,
}: {
  hook: Webhook;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onEdit: (hook: Webhook) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const deliveriesQ = useQuery({
    queryKey: ['webhook-deliveries', hook.id],
    queryFn: () => api.webhooks.deliveries(hook.id),
    enabled: expanded,
  });

  const lastDelivery = deliveriesQ.data?.deliveries[0] ?? null;

  return (
    <>
      <tr className="border-t border-[var(--border)] text-xs">
        <td className="py-2 pr-3 font-medium text-[var(--text)]">{hook.name}</td>
        <td className="py-2 pr-3">
          <FormatChip format={hook.format} />
        </td>
        <td className="py-2 pr-3">
          {lastDelivery == null ? (
            <span className="text-[var(--text-muted)]">—</span>
          ) : lastDelivery.success ? (
            <span className="text-emerald-400">&#x2713;</span>
          ) : (
            <span className="text-rose-400">&#x2717;</span>
          )}
        </td>
        <td className="py-2 pr-3">
          <button
            type="button"
            onClick={() => onToggle(hook.id, !hook.enabled)}
            className={`relative inline-flex h-5 w-10 items-center rounded-full transition ${
              hook.enabled ? 'bg-orange-500' : 'bg-neutral-600'
            }`}
            aria-label={hook.enabled ? 'Disable' : 'Enable'}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                hook.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </td>
        <td className="py-2">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[10px] text-[var(--text)] hover:bg-neutral-700"
            >
              {expanded ? 'Hide' : 'Logs'}
            </button>
            <button
              type="button"
              onClick={() => onTest(hook.id)}
              className="rounded border border-blue-700 bg-blue-900/20 px-2 py-0.5 text-[10px] text-blue-200 hover:bg-blue-900/40"
            >
              Test
            </button>
            <button
              type="button"
              onClick={() => onEdit(hook)}
              className="rounded border border-[var(--border)] bg-[var(--input-bg)] px-2 py-0.5 text-[10px] text-[var(--text)] hover:bg-neutral-700"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(hook.id)}
              className="rounded border border-rose-800 bg-rose-950/20 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-900/40"
            >
              Del
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={5} className="pb-3 pt-1">
            {deliveriesQ.isPending ? (
              <p className="text-xs text-[var(--text-muted)]">Loading…</p>
            ) : deliveriesQ.data && deliveriesQ.data.deliveries.length > 0 ? (
              <table className="w-full">
                <tbody>
                  {deliveriesQ.data.deliveries.slice(0, 5).map((d, i) => (
                    <DeliveryRow key={i} d={d} />
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">No deliveries yet.</p>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

interface WebhookFormState {
  name: string;
  targetUrl: string;
  events: string[];
  format: 'auto' | WebhookFormat;
}

const BLANK_FORM: WebhookFormState = {
  name: '',
  targetUrl: '',
  events: [],
  format: 'auto',
};

function WebhooksSection({ toast }: { toast: (type: 'success' | 'error', msg: string) => void }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editHook, setEditHook] = useState<Webhook | null>(null);
  const [form, setForm] = useState<WebhookFormState>(BLANK_FORM);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(
    null,
  );

  const hooksQ = useQuery({
    queryKey: ['webhooks'],
    queryFn: api.webhooks.list,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['webhooks'] });

  const createMut = useMutation({
    mutationFn: () =>
      api.webhooks.create({
        name: form.name,
        targetUrl: form.targetUrl,
        events: form.events,
        format: form.format,
      }),
    onSuccess: () => {
      toast('success', 'Webhook created.');
      setShowForm(false);
      setForm(BLANK_FORM);
      void invalidate();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; patch: Parameters<typeof api.webhooks.update>[1] }) =>
      api.webhooks.update(vars.id, vars.patch),
    onSuccess: () => {
      toast('success', 'Webhook updated.');
      setEditHook(null);
      setShowForm(false);
      setForm(BLANK_FORM);
      void invalidate();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.webhooks.delete(id),
    onSuccess: () => {
      toast('success', 'Webhook deleted.');
      void invalidate();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const handleToggle = (id: string, enabled: boolean) => {
    updateMut.mutate({ id, patch: { enabled } });
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this webhook?')) return;
    deleteMut.mutate(id);
  };

  const handleTest = async (id: string) => {
    setTestResult(null);
    try {
      const r = await api.webhooks.test(id);
      setTestResult({
        id,
        ok: r.ok,
        msg: r.ok
          ? `Test passed (HTTP ${r.statusCode ?? 200}).`
          : `Test failed: ${r.error ?? `HTTP ${r.statusCode}`}`,
      });
    } catch (e) {
      setTestResult({
        id,
        ok: false,
        msg: `Test error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  const handleEdit = (hook: Webhook) => {
    setEditHook(hook);
    setForm({
      name: hook.name,
      targetUrl: hook.targetUrl,
      events: hook.events,
      format: hook.format,
    });
    setShowForm(true);
  };

  const handleEventToggle = (value: string) => {
    setForm((prev) => ({
      ...prev,
      events:
        value === '*'
          ? prev.events.includes('*')
            ? []
            : ['*']
          : prev.events.includes(value)
            ? prev.events.filter((e) => e !== value && e !== '*')
            : [...prev.events.filter((e) => e !== '*'), value],
    }));
  };

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast('error', 'Name is required.');
      return;
    }
    if (!form.targetUrl.trim()) {
      toast('error', 'Target URL is required.');
      return;
    }
    if (form.events.length === 0) {
      toast('error', 'Select at least one event type.');
      return;
    }
    if (editHook) {
      const patch: { name: string; events: string[]; format?: WebhookFormat } = {
        name: form.name,
        events: form.events,
      };
      if (form.format !== 'auto') patch.format = form.format;
      updateMut.mutate({ id: editHook.id, patch });
    } else {
      createMut.mutate();
    }
  };

  const hooks = hooksQ.data?.webhooks ?? [];

  return (
    <Section
      title="Webhooks"
      description="Send event notifications to Slack, Discord, PagerDuty, or any HTTP endpoint."
    >
      {hooksQ.isPending ? (
        <div className="h-12 animate-pulse rounded bg-[var(--input-bg)]" />
      ) : hooks.length > 0 ? (
        <table className="w-full table-auto">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              <th className="pb-1 pr-3">Name</th>
              <th className="pb-1 pr-3">Format</th>
              <th className="pb-1 pr-3">Last</th>
              <th className="pb-1 pr-3">Enabled</th>
              <th className="pb-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <WebhookRow
                key={h.id}
                hook={h}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onTest={handleTest}
                onEdit={handleEdit}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">No webhooks configured yet.</p>
      )}

      {testResult ? (
        <div
          className={`mt-3 rounded border px-3 py-2 text-xs ${
            testResult.ok
              ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
              : 'border-rose-700 bg-rose-950/40 text-rose-200'
          }`}
        >
          {testResult.msg}
        </div>
      ) : null}

      {showForm ? (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-4">
          <h4 className="mb-3 text-xs font-semibold text-[var(--text)]">
            {editHook ? 'Edit webhook' : 'Add webhook'}
          </h4>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="wh-name"
                className="mb-1 block text-xs font-medium text-[var(--text)]"
              >
                Name
              </label>
              <input
                id="wh-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="My Slack Alert"
                className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-500"
              />
            </div>
            {!editHook ? (
              <div>
                <label
                  htmlFor="wh-url"
                  className="mb-1 block text-xs font-medium text-[var(--text)]"
                >
                  Target URL
                </label>
                <input
                  id="wh-url"
                  type="url"
                  value={form.targetUrl}
                  onChange={(e) => setForm((p) => ({ ...p, targetUrl: e.target.value }))}
                  placeholder="https://hooks.slack.com/…"
                  className="w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-orange-500"
                />
              </div>
            ) : null}
            <div>
              <p className="mb-1 block text-xs font-medium text-[var(--text)]">Events</p>
              <div className="flex flex-wrap gap-2">
                {ALL_EVENT_KINDS.map((ek) => (
                  <label
                    key={ek.value}
                    className="flex cursor-pointer items-center gap-1 text-xs text-[var(--text)]"
                  >
                    <input
                      type="checkbox"
                      checked={form.events.includes(ek.value)}
                      onChange={() => handleEventToggle(ek.value)}
                      className="accent-orange-500"
                    />
                    {ek.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor="wh-format"
                className="mb-1 block text-xs font-medium text-[var(--text)]"
              >
                Format
              </label>
              <select
                id="wh-format"
                value={form.format}
                onChange={(e) =>
                  setForm((p) => ({ ...p, format: e.target.value as 'auto' | WebhookFormat }))
                }
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-orange-500"
              >
                <option value="auto">Auto-detect</option>
                <option value="slack">Slack</option>
                <option value="discord">Discord</option>
                <option value="pagerduty">PagerDuty</option>
                <option value="generic">Generic JSON</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={createMut.isPending || updateMut.isPending}
              className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50"
            >
              {createMut.isPending || updateMut.isPending ? 'Saving…' : editHook ? 'Update' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditHook(null);
                setForm(BLANK_FORM);
              }}
              className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-4 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-neutral-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              setEditHook(null);
              setForm(BLANK_FORM);
              setShowForm(true);
            }}
            className="rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-neutral-700"
          >
            + Add webhook
          </button>
        </div>
      )}
    </Section>
  );
}
