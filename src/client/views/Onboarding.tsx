/**
 * Onboarding.tsx — First-run wizard for RedLettuce mods.
 *
 * Renders as a <dialog> modal overlay over the dashboard. Four steps:
 * Welcome → Triage Inbox → Contact Drivers → Done.
 *
 * Shown once per (subreddit, user) pair; Redis key `rl:onboarded:{userId}`
 * tracks completion. TanStack Query drives status fetch and completion mutation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface OnboardingStatus {
  onboarded: boolean;
}

async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const r = await fetch('/api/onboarding/status', { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`onboarding/status → HTTP ${r.status}`);
  return (await r.json()) as OnboardingStatus;
}

async function completeOnboarding(): Promise<void> {
  const r = await fetch('/api/onboarding/complete', { method: 'POST' });
  if (!r.ok) throw new Error(`onboarding/complete → HTTP ${r.status}`);
}

async function resetOnboarding(): Promise<void> {
  const r = await fetch('/api/onboarding/reset', { method: 'POST' });
  if (!r.ok) throw new Error(`onboarding/reset → HTTP ${r.status}`);
}

export const onboardingApi = { fetchOnboardingStatus, completeOnboarding, resetOnboarding };

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface Step {
  title: string;
  icon: string;
  body: string;
  detail: string;
}

const STEPS: [Step, Step, Step, Step] = [
  {
    title: 'Welcome to RedLettuce',
    icon: '◈',
    body: 'Native CX analytics for your Reddit brand community.',
    detail:
      'RedLettuce lives entirely inside your subreddit — no external logins, no third-party cookies. Everything you see is scoped to your installation.',
  },
  {
    title: 'Triage Inbox',
    icon: '⬡',
    body: "This is where you'll spend most of your time.",
    detail:
      'Posts auto-prioritize by severity × sentiment × age. High-urgency threads bubble to the top automatically — no manual sorting required.',
  },
  {
    title: 'Contact Drivers',
    icon: '◎',
    body: 'Every post gets tagged into a driver category.',
    detail:
      'Edit your taxonomy in Settings → Contact Driver Taxonomy to match how YOUR community talks. The auto-tagger learns your label vocabulary within seconds of a post hitting the queue.',
  },
  {
    title: "You're ready",
    icon: '✓',
    body: 'Submit a test post to see RedLettuce in action.',
    detail:
      'It auto-tags within 5 seconds. Check the Inbox tab — the post will appear with its sentiment score and suggested driver already filled in.',
  },
];

// ---------------------------------------------------------------------------
// Dot indicator
// ---------------------------------------------------------------------------

function StepDots({ total, current }: { total: number; current: number }) {
  const steps = Array.from({ length: total }, (_, i) => i);
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      {steps.map((i) => (
        <span
          key={`dot-${i}`}
          aria-hidden="true"
          className={`block rounded-full transition-all duration-300 ${
            i === current
              ? 'h-2 w-6 bg-[var(--accent-9)]'
              : i < current
                ? 'h-2 w-2 bg-[var(--accent-3)]'
                : 'h-2 w-2 bg-[var(--n-4)]'
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding modal
// ---------------------------------------------------------------------------

interface OnboardingProps {
  onComplete: () => void;
}

function OnboardingModal({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isLast = step === STEPS.length - 1;
  // step is always clamped to [0, STEPS.length - 1] so this fallback is unreachable.
  const current = STEPS[step] ?? STEPS[0];

  const completeMut = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: onComplete,
    onError: () => {
      // Fail silently — don't block the user; mark locally done.
      onComplete();
    },
  });

  const dismiss = () => completeMut.mutate();

  // Open dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Escape key closes + completes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  });

  return (
    <dialog
      ref={dialogRef}
      aria-label="RedLettuce onboarding tour"
      aria-modal="true"
      onClose={dismiss}
      className="m-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] p-0 shadow-[var(--shadow-3)] backdrop:bg-black/60 open:flex open:flex-col max-sm:fixed max-sm:inset-0 max-sm:m-0 max-sm:max-w-none max-sm:rounded-none max-sm:h-dvh"
    >
      {/* Skip button */}
      <div className="flex items-center justify-end px-6 pt-5">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-[var(--r-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-8)] transition hover:text-[var(--n-11)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
          aria-label="Skip onboarding"
        >
          Skip
        </button>
      </div>

      {/* Icon */}
      <div className="flex justify-center px-6 pt-2">
        <span
          className={`flex h-20 w-20 items-center justify-center rounded-[var(--r-3)] text-4xl transition-all duration-300 ${
            step === 0
              ? 'bg-[var(--accent-3)] text-[var(--accent-11)]'
              : step === STEPS.length - 1
                ? 'bg-[var(--success-3)] text-[var(--success-11)]'
                : 'bg-[var(--n-3)] text-[var(--accent-11)]'
          }`}
          aria-hidden="true"
        >
          {current.icon}
        </span>
      </div>

      {/* Content */}
      <div className="px-8 pt-6 pb-4 text-center">
        <h2 className="text-[length:var(--t-xl)] font-semibold text-[var(--n-12)]">
          {current.title}
        </h2>
        <p className="mt-2 text-[length:var(--t-sm)] font-medium text-[var(--n-11)]">
          {current.body}
        </p>
        <p className="mt-3 text-[length:var(--t-sm)] leading-relaxed text-[var(--n-8)]">
          {current.detail}
        </p>
      </div>

      {/* Footer */}
      <div className="flex flex-col items-center gap-4 px-8 pb-8 pt-2">
        <StepDots total={STEPS.length} current={step} />

        <div className="flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-2 text-[length:var(--t-sm)] text-[var(--n-11)] transition hover:bg-[var(--n-3)] disabled:pointer-events-none disabled:opacity-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
            aria-label="Previous step"
          >
            Back
          </button>

          {isLast ? (
            <div className="flex flex-1 justify-end gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-2 text-[length:var(--t-sm)] text-[var(--n-8)] transition hover:bg-[var(--n-3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
              >
                Skip for now
              </button>
              <button
                type="button"
                onClick={dismiss}
                disabled={completeMut.isPending}
                className="rounded-[var(--r-2)] bg-[var(--accent-9)] px-5 py-2 text-[length:var(--t-sm)] font-semibold text-white transition hover:bg-[var(--accent-10)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
              >
                Open Inbox
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="ml-auto rounded-[var(--r-2)] bg-[var(--accent-9)] px-5 py-2 text-[length:var(--t-sm)] font-semibold text-white transition hover:bg-[var(--accent-10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
              aria-label="Next step"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Public entry point — mounted in Dashboard.tsx
// ---------------------------------------------------------------------------

/**
 * Fetches onboarding status and renders the modal when needed.
 * Suspends nothing; renders null until data arrives so the dashboard
 * is never blocked.
 */
export function Onboarding() {
  const qc = useQueryClient();

  const statusQ = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: fetchOnboardingStatus,
    // Only fetch once per session; no stale refetch.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const markDone = () => {
    qc.setQueryData<OnboardingStatus>(['onboarding-status'], { onboarded: true });
  };

  if (statusQ.isPending || statusQ.isError) return null;
  if (statusQ.data.onboarded) return null;

  return <OnboardingModal onComplete={markDone} />;
}

// ---------------------------------------------------------------------------
// Settings section — "Replay onboarding tour" button
// ---------------------------------------------------------------------------

export function OnboardingSettingsSection() {
  const qc = useQueryClient();

  const resetMut = useMutation({
    mutationFn: resetOnboarding,
    onSuccess: () => {
      qc.setQueryData<OnboardingStatus>(['onboarding-status'], { onboarded: false });
    },
  });

  return (
    <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-6 shadow-[var(--shadow-1)]">
      <h3 className="mb-1 text-[length:var(--t-sm)] font-semibold text-[var(--n-12)]">
        Onboarding
      </h3>
      <p className="mb-4 text-[length:var(--t-xs)] text-[var(--n-8)]">
        Replay the first-run walkthrough to re-familiarise yourself or onboard a new mod.
      </p>
      <button
        type="button"
        onClick={() => resetMut.mutate()}
        disabled={resetMut.isPending}
        className="rounded-[var(--r-2)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-4 py-1.5 text-[length:var(--t-sm)] font-medium text-[var(--accent-11)] transition hover:bg-[var(--accent-3)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-9)]"
        data-testid="replay-onboarding"
      >
        {resetMut.isPending ? 'Resetting…' : 'Replay onboarding tour'}
      </button>
      {resetMut.isError ? (
        <p className="mt-2 text-[length:var(--t-xs)] text-[var(--error-11)]">
          Failed to reset — try again.
        </p>
      ) : null}
    </div>
  );
}
