/**
 * Settings tab — in-dashboard configuration UI.
 *
 * Sections:
 *   - Brand identity (brand-name, brand-voice + test draft)
 *   - Taxonomy (visual card editor + JSON fallback for intent taxonomy)
 *   - Routing rules (per-intent modmail routing)
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
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '../components/ui/index.ts';
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
          className={[
            'pointer-events-auto block max-w-sm rounded-[var(--r-3)] border px-4 py-3',
            'text-[length:var(--t-sm)] shadow-[var(--shadow-2)] transition-all',
            t.type === 'success'
              ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
              : 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]',
          ].join(' ')}
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
    <Card padding="lg">
      <h3 className="mb-1 text-[length:var(--t-base)] font-semibold text-[var(--n-12)]">{title}</h3>
      {description ? (
        <p className="mb-4 text-[length:var(--t-sm)] text-[var(--n-8)]">{description}</p>
      ) : null}
      {children}
    </Card>
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
      <Button variant="primary" size="sm" onClick={onClick} isLoading={loading} disabled={disabled}>
        Save
      </Button>
    </div>
  );
}

function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="mt-2 rounded-[var(--r-2)] border border-[var(--error-9)] bg-[var(--error-3)] px-3 py-2 text-[length:var(--t-xs)] text-[var(--error-11)]">
      {msg}
    </div>
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
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }

  if (settingsQ.isError) {
    return (
      <div className="space-y-4">
        <h2 className="text-[length:var(--t-sm)] uppercase tracking-wide text-[var(--n-8)]">
          Settings
        </h2>
        <div className="rounded-[var(--r-3)] border border-[var(--error-9)] bg-[var(--error-3)] p-4 text-[length:var(--t-sm)] text-[var(--error-11)]">
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
          <h2 className="text-[length:var(--t-sm)] uppercase tracking-wide text-[var(--n-8)]">
            Settings
          </h2>
          <p className="mt-1 max-w-2xl text-[length:var(--t-xs)] text-[var(--n-8)]">
            Changes take effect immediately. All values are stored in Redis and override Devvit
            settings defaults. The OpenRouter API key must be set via{' '}
            <code className="rounded-[var(--r-1)] bg-[var(--n-3)] px-1">
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

const TONE_COLOR: Record<string, BadgeVariant> = {
  empathetic: 'success',
  direct: 'accent',
  concise: 'neutral',
  investigative: 'warn',
};

type BadgeVariant = 'success' | 'accent' | 'neutral' | 'warn' | 'error';

function BrandIdentitySection({
  data,
  toast,
  onSaved,
}: {
  data: Record<string, unknown> & { openrouterKeyConfigured: boolean };
  toast: (type: 'success' | 'error', msg: string) => void;
  onSaved: () => void;
}) {
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
        <Input
          label="Brand name"
          value={brandName}
          onChange={setBrandName}
          placeholder="e.g. Acme, Sonos, Duolingo"
          helper="Used in impostor detection. Leave blank to disable."
        />
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label
              htmlFor={brandVoiceId}
              className="text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
            >
              Brand voice
            </label>
            <span className="text-[length:var(--t-xs)] text-[var(--n-8)] tabular-nums">
              {brandVoice.length}/2000
            </span>
          </div>
          <Textarea
            id={brandVoiceId}
            value={brandVoice}
            onChange={setBrandVoice}
            rows={5}
            maxLength={2000}
            placeholder="Friendly, empathetic, never defensive. Acknowledge frustration first. Sign off as the Acme support team."
            helper="Shapes AI draft replies. Describe tone, things to avoid, sign-off style."
          />
        </div>
      </div>
      <FieldError msg={error} />
      <div className="mt-4">
        <Button variant="secondary" size="sm" onClick={testDraft} isLoading={draftLoading}>
          Test brand voice
        </Button>
        <p className="mt-2 text-[length:var(--t-xs)] text-[var(--n-8)]">
          Generates 3 sample AI replies against a recent post to preview your tone.
        </p>
      </div>
      {draftError ? (
        <div className="mt-3 rounded-[var(--r-2)] border border-[var(--error-9)] bg-[var(--error-3)] px-3 py-2 text-[length:var(--t-xs)] text-[var(--error-11)]">
          {draftError}
        </div>
      ) : null}
      {draftData ? (
        <div className="mt-4 space-y-3">
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
            Draft against:{' '}
            <span className="text-[var(--n-11)]">&ldquo;{draftData.postTitle}&rdquo;</span>
            <span className="ml-2 tabular-nums text-[var(--n-8)]">
              &middot; {draftData.tokensIn + draftData.tokensOut} tokens &middot; $
              {(draftData.costCents / 100).toFixed(4)}
              {draftData.cached ? ' · cached' : ''}
            </span>
          </p>
          <ul className="space-y-2">
            {draftData.candidates.map((c, i) => (
              <li
                key={`${c.tone}-${i}`}
                className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-1)] p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-[length:var(--t-xs)]">
                  <Badge variant={TONE_COLOR[c.tone] ?? 'neutral'}>{c.tone}</Badge>
                  <span className="text-[var(--n-8)]">{c.rationale}</span>
                </div>
                <p className="whitespace-pre-wrap text-[length:var(--t-sm)] text-[var(--n-11)]">
                  {c.reply}
                </p>
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
          <label
            htmlFor="accent-picker"
            className="text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
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
              className="w-28 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-3 py-2 text-[length:var(--t-sm)] font-mono text-[var(--n-11)] uppercase outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
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
      <div className="mt-6 flex justify-end border-t border-[var(--n-4)] pt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={() => mut.mutate({ 'brand-accent': hex })}
          isLoading={mut.isPending}
          disabled={!/^#[0-9a-fA-F]{6}$/.test(hex)}
        >
          Save accent
        </Button>
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
  const testFlairId = useId();
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
        <Input
          label="Verified-rep flair regex"
          value={pattern}
          onChange={setPattern}
          placeholder="^(Verified|Brand Team|Acme Support)$"
          helper="Commenters whose flair matches this regex are treated as verified reps."
        />
        <div>
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
              className="min-h-[44px] flex-1 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-2 py-1 text-[length:var(--t-sm)] text-[var(--n-11)] outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
            />
            {regexResult ? (
              <Badge
                variant={
                  regexResult === 'MATCH'
                    ? 'success'
                    : regexResult === 'INVALID REGEX'
                      ? 'error'
                      : 'neutral'
                }
              >
                {regexResult}
              </Badge>
            ) : null}
          </div>
        </div>
        <Input
          label="Flair text to apply on verification"
          value={flairText}
          onChange={setFlairText}
          placeholder="Verified Agent"
        />
        <div>
          <label
            htmlFor="flair-color-picker"
            className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
            Flair background color
          </label>
          <div className="flex items-center gap-3">
            <input
              id="flair-color-picker"
              type="color"
              value={flairColor}
              onChange={(e) => setFlairColor(e.target.value)}
              aria-label="Flair background color picker"
              className="h-9 w-14 cursor-pointer rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] p-0.5"
            />
            <span className="text-[length:var(--t-xs)] text-[var(--n-8)] tabular-nums">
              {flairColor}
            </span>
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
          <label
            htmlFor={sentThreshId}
            className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
            Negative comment alert threshold
          </label>
          <input
            id={sentThreshId}
            type="number"
            min={2}
            max={50}
            value={sentThreshold}
            onChange={(e) => setSentThreshold(Number(e.target.value))}
            className="min-h-[44px] w-full rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-3 py-2 text-[length:var(--t-base)] tabular-nums text-[var(--n-11)] outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
          />
          <p className="mt-1 text-[length:var(--t-xs)] text-[var(--n-8)]">
            Modmail fires when a thread has this many negative comments in the last{' '}
            <span className="tabular-nums">{Math.round(sentThreshold)}</span> sampled.
          </p>
        </div>
        <div>
          <label
            htmlFor={slaMinutesId}
            className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
            First-response SLA (minutes)
          </label>
          <input
            id={slaMinutesId}
            type="number"
            min={15}
            max={1440}
            value={slaMinutes}
            onChange={(e) => setSlaMinutes(Number(e.target.value))}
            className="min-h-[44px] w-full rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-3 py-2 text-[length:var(--t-base)] tabular-nums text-[var(--n-11)] outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
          />
          <p className="mt-1 text-[length:var(--t-xs)] text-[var(--n-8)]">
            Posts unanswered beyond this SLA appear in the breach feed.
          </p>
        </div>
        <div>
          <label
            htmlFor={costCapId}
            className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
            Monthly AI cost cap
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[length:var(--t-sm)] text-[var(--n-8)]" aria-hidden="true">
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
              className="min-h-[44px] w-full rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-3 py-2 text-[length:var(--t-base)] tabular-nums text-[var(--n-11)] outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
            />
          </div>
          <p className="mt-1 text-[length:var(--t-xs)] text-[var(--n-8)]">
            When exceeded, AI tagging falls back to lexicon-only. Current:{' '}
            <span className="tabular-nums">{costCapCents}</span> cents.
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

const TIER_BADGE: Record<string, BadgeVariant> = {
  recommended: 'accent',
  fast: 'neutral',
  cheapest: 'success',
  best: 'warn',
  'eu-hosted': 'neutral',
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

  const aiStatusQ = useQuery({
    queryKey: ['ai-status'],
    queryFn: api.ai.status,
    staleTime: 30_000,
  });

  const catalog = aiStatusQ.data?.catalog ?? [];
  const isFallback = aiStatusQ.data?.isFallback ?? false;
  const originalSlug = aiStatusQ.data?.originalSlug ?? null;
  const defaultModel = aiStatusQ.data?.defaultModel ?? 'anthropic/claude-haiku-4.5';

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
          className={[
            'flex items-center gap-3 rounded-[var(--r-3)] border px-4 py-3',
            'text-[length:var(--t-sm)]',
            data.openrouterKeyConfigured
              ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
              : 'border-[var(--warn-9)] bg-[var(--warn-3)] text-[var(--warn-11)]',
          ].join(' ')}
        >
          <span className="text-base" aria-hidden="true">
            {data.openrouterKeyConfigured ? '✓' : '⚠'}
          </span>
          {data.openrouterKeyConfigured ? (
            <span>OpenRouter API key is configured.</span>
          ) : (
            <span>
              No API key set. Run{' '}
              <code className="rounded-[var(--r-1)] bg-[var(--warn-3)] px-1">
                npx devvit settings set openrouter-api-key
              </code>{' '}
              to enable AI features.
            </span>
          )}
        </div>

        {/* Auto-fallback alert */}
        {isFallback && originalSlug ? (
          <div
            className="flex flex-col gap-3 rounded-[var(--r-3)] border border-[var(--warn-9)] bg-[var(--warn-3)] px-4 py-3 text-[length:var(--t-sm)] text-[var(--warn-11)]"
            data-testid="fallback-alert"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base" aria-hidden="true">
                ⚠
              </span>
              <span>
                <strong>AI auto-fallback active</strong> — using{' '}
                <code className="rounded-[var(--r-1)] bg-[var(--warn-3)] px-1">{defaultModel}</code>{' '}
                because{' '}
                <code className="rounded-[var(--r-1)] bg-[var(--warn-3)] px-1">{originalSlug}</code>{' '}
                had repeated errors.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => acceptDefaultMut.mutate()}
                isLoading={acceptDefaultMut.isPending}
              >
                Use default permanently
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearFallbackMut.mutate()}
                isLoading={clearFallbackMut.isPending}
              >
                Try {originalSlug} again
              </Button>
            </div>
          </div>
        ) : null}

        {/* Model dropdown */}
        <div>
          <label
            htmlFor="ai-model-select"
            className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
            AI model
          </label>
          {aiStatusQ.isPending ? (
            <Skeleton className="h-11" />
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
              id="ai-model-select"
              className="min-h-[44px] w-full rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--input-bg)] px-3 py-2 text-[length:var(--t-base)] text-[var(--n-11)] outline-none focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
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
              <Badge variant={TIER_BADGE[catalogEntry.tier] ?? 'neutral'}>
                {TIER_LABELS[catalogEntry.tier] ?? catalogEntry.tier}
              </Badge>
              <Badge variant="neutral">
                ~${catalogEntry.pricePer1kTaggingCalls.toFixed(4)}/1k posts
              </Badge>
              {catalogEntry.notes ? (
                <span className="text-[length:var(--t-xs)] text-[var(--n-8)]">
                  {catalogEntry.notes}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Custom model input */}
        {useCustom ? (
          <Card variant="subtle" padding="md">
            <label
              htmlFor={customModelId}
              className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
            >
              Custom model slug
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id={customModelId}
                value={customModel}
                onChange={handleCustomChange}
                placeholder="provider/model-name"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCustomBlur}
                isLoading={validating}
                disabled={!customModel.trim()}
                className="shrink-0"
              >
                Validate
              </Button>
            </div>
            <p className="mt-1 text-[length:var(--t-xs)] text-[var(--warn-11)]">
              Unverified — may not work with all pipelines.
            </p>
          </Card>
        ) : null}

        {/* Validation result */}
        {validating ? (
          <div className="flex items-center gap-2 rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 text-[length:var(--t-xs)] text-[var(--n-8)]">
            <span className="animate-spin" aria-hidden="true">
              ⟳
            </span>{' '}
            Validating model…
          </div>
        ) : validation ? (
          <div
            className={[
              'rounded-[var(--r-2)] border px-3 py-2 text-[length:var(--t-xs)]',
              !validation.valid
                ? 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]'
                : !validation.supportsStructuredOutput
                  ? 'border-[var(--warn-9)] bg-[var(--warn-3)] text-[var(--warn-11)]'
                  : 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]',
            ].join(' ')}
            data-testid="validation-result"
          >
            <span className="mr-1 font-bold" aria-hidden="true">
              {!validation.valid ? '✗' : !validation.supportsStructuredOutput ? '⚠' : '✓'}
            </span>
            {!validation.valid
              ? `Model invalid: ${validation.hint ?? validation.error ?? 'unknown error'}`
              : !validation.supportsStructuredOutput
                ? 'This model returned a result but does not reliably support structured output. Tagging pipelines may fail; free-text drafts will work.'
                : 'Validated — this model supports all pipelines.'}
            {!validation.inCatalog && validation.valid ? (
              <span className="ml-1 text-[var(--warn-11)]">(Not in curated catalog.)</span>
            ) : null}
          </div>
        ) : null}

        {/* Cost estimate widget */}
        {monthlyCostEst !== null && dailyPosts !== null ? (
          <div className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 text-[length:var(--t-xs)] text-[var(--n-11)]">
            At <span className="tabular-nums">{dailyPosts}</span> posts/day, estimated monthly AI
            cost ≈ <strong className="tabular-nums">${monthlyCostEst}</strong>
          </div>
        ) : null}
      </div>

      <FieldError msg={saveError} />

      <div className="mt-6 flex justify-end border-t border-[var(--n-4)] pt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            void validate(effectiveSlug);
            saveMut.mutate();
          }}
          isLoading={saveMut.isPending}
        >
          Save
        </Button>
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
        className={[
          'mb-4 flex items-center gap-3 rounded-[var(--r-3)] border px-4 py-3',
          'text-[length:var(--t-sm)]',
          connected
            ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
            : 'border-[var(--n-4)] bg-[var(--n-2)] text-[var(--n-8)]',
        ].join(' ')}
        data-testid="studio-status-banner"
      >
        <span className="text-base" aria-hidden="true">
          {connected ? '✓' : '○'}
        </span>
        {connected ? (
          <span>
            Connected to{' '}
            <span className="font-medium text-[var(--success-11)]">
              {status?.studioUrl ?? studioUrl}
            </span>
          </span>
        ) : (
          <span>Not connected — enter a Studio URL and connection token below.</span>
        )}
      </div>

      <div className="space-y-4">
        <Input
          label="Studio URL"
          value={studioUrl}
          onChange={setStudioUrl}
          placeholder="https://studio.redlattice.app"
          helper="Base URL of your RedLattice Studio instance."
        />
        <Input
          label="Connection token"
          type="password"
          value={token}
          onChange={setToken}
          placeholder="Paste the token from Studio > Settings > Connections"
          helper="Issued by Studio. Stored encrypted in Redis per installation."
        />
      </div>

      {testResult ? (
        <div
          className={[
            'mt-3 rounded-[var(--r-2)] border px-3 py-2 text-[length:var(--t-xs)]',
            testResult.ok
              ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
              : 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]',
          ].join(' ')}
        >
          {testResult.ok
            ? `Connection test passed (HTTP ${testResult.statusCode ?? 200}).`
            : `Connection test failed: ${testResult.error ?? `HTTP ${testResult.statusCode}`}`}
        </div>
      ) : null}

      <FieldError msg={error} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={testConnection}
          isLoading={testLoading}
          disabled={!token.trim()}
          data-testid="studio-test-button"
        >
          Test connection
        </Button>
        {connected ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => disconnectMut.mutate()}
            isLoading={disconnectMut.isPending}
            data-testid="studio-disconnect-button"
          >
            Disconnect
          </Button>
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
  const variantMap: Record<string, BadgeVariant> = {
    slack: 'success',
    discord: 'accent',
    pagerduty: 'success',
    generic: 'neutral',
  };
  return <Badge variant={variantMap[format] ?? 'neutral'}>{FORMAT_LABELS[format] ?? format}</Badge>;
}

function DeliveryRow({ d }: { d: WebhookDelivery }) {
  const ts = new Date(d.attemptedAt).toLocaleString();
  return (
    <tr className="border-t border-[var(--n-4)] text-[length:var(--t-xs)]">
      <td className="py-1 pr-3 text-[var(--n-8)] tabular-nums">{ts}</td>
      <td className="py-1 pr-3 font-mono text-[var(--n-11)]">{d.eventKind}</td>
      <td className="py-1 pr-3">
        {d.success ? (
          <Badge variant="success" dot>
            {d.statusCode}
          </Badge>
        ) : (
          <Badge variant="error" dot>
            {d.statusCode ?? 'err'}
          </Badge>
        )}
      </td>
      <td className="max-w-[180px] truncate py-1 text-[var(--n-8)]">{d.responseExcerpt}</td>
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
      <tr className="border-t border-[var(--n-4)] text-[length:var(--t-xs)]">
        <td className="py-2 pr-3 font-medium text-[var(--n-11)]">{hook.name}</td>
        <td className="py-2 pr-3">
          <FormatChip format={hook.format} />
        </td>
        <td className="py-2 pr-3">
          {lastDelivery == null ? (
            <span className="text-[var(--n-8)]">—</span>
          ) : lastDelivery.success ? (
            <Badge variant="success" dot>
              OK
            </Badge>
          ) : (
            <Badge variant="error" dot>
              Fail
            </Badge>
          )}
        </td>
        <td className="py-2 pr-3">
          <Switch checked={hook.enabled} onChange={(checked) => onToggle(hook.id, checked)} />
        </td>
        <td className="py-2">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Hide' : 'Logs'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onTest(hook.id)}>
              Test
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onEdit(hook)}>
              Edit
            </Button>
            <Button variant="destructive" size="sm" onClick={() => onDelete(hook.id)}>
              Del
            </Button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={5} className="pb-3 pt-1">
            {deliveriesQ.isPending ? (
              <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">Loading…</p>
            ) : deliveriesQ.data && deliveriesQ.data.deliveries.length > 0 ? (
              <table className="w-full">
                <tbody>
                  {deliveriesQ.data.deliveries.slice(0, 5).map((d, i) => (
                    <DeliveryRow key={i} d={d} />
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">No deliveries yet.</p>
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
        <Skeleton className="h-12" />
      ) : hooks.length > 0 ? (
        <table className="w-full table-auto">
          <thead>
            <tr className="text-left text-[length:var(--t-xs)] uppercase tracking-wide text-[var(--n-8)]">
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
        <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">No webhooks configured yet.</p>
      )}

      {testResult ? (
        <div
          className={[
            'mt-3 rounded-[var(--r-2)] border px-3 py-2 text-[length:var(--t-xs)]',
            testResult.ok
              ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
              : 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]',
          ].join(' ')}
        >
          {testResult.msg}
        </div>
      ) : null}

      {showForm ? (
        <Card variant="subtle" padding="md" className="mt-4">
          <h4 className="mb-3 text-[length:var(--t-xs)] font-semibold text-[var(--n-11)]">
            {editHook ? 'Edit webhook' : 'Add webhook'}
          </h4>
          <div className="space-y-3">
            <Input
              label="Name"
              id="wh-name"
              value={form.name}
              onChange={(v) => setForm((p) => ({ ...p, name: v }))}
              placeholder="My Slack Alert"
            />
            {!editHook ? (
              <Input
                label="Target URL"
                id="wh-url"
                type="url"
                value={form.targetUrl}
                onChange={(v) => setForm((p) => ({ ...p, targetUrl: v }))}
                placeholder="https://hooks.slack.com/…"
              />
            ) : null}
            <div>
              <p className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]">
                Events
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_EVENT_KINDS.map((ek) => (
                  <label
                    key={ek.value}
                    className="flex cursor-pointer items-center gap-1 text-[length:var(--t-xs)] text-[var(--n-11)]"
                  >
                    <input
                      type="checkbox"
                      checked={form.events.includes(ek.value)}
                      onChange={() => handleEventToggle(ek.value)}
                      className="accent-[var(--accent-9)]"
                    />
                    {ek.label}
                  </label>
                ))}
              </div>
            </div>
            <Select
              label="Format"
              id="wh-format"
              value={form.format}
              onChange={(v) => setForm((p) => ({ ...p, format: v as 'auto' | WebhookFormat }))}
            >
              <option value="auto">Auto-detect</option>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
              <option value="pagerduty">PagerDuty</option>
              <option value="generic">Generic JSON</option>
            </Select>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              isLoading={createMut.isPending || updateMut.isPending}
            >
              {editHook ? 'Update' : 'Add'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setEditHook(null);
                setForm(BLANK_FORM);
              }}
            >
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <div className="mt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditHook(null);
              setForm(BLANK_FORM);
              setShowForm(true);
            }}
          >
            + Add webhook
          </Button>
        </div>
      )}
    </Section>
  );
}
