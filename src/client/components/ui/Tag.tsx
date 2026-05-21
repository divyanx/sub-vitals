/**
 * Tag — semantic chip for displaying *values* (vs Badge, which is for
 * status labels).
 *
 * Use cases: pipeline tag values on a post row, condition summaries in
 * rule flows, action pills, category filters, kind chips on cards.
 *
 * The 10-tone palette is anchored to the design tokens so dark + light
 * modes stay correct and brand-accent overrides don't break it. Pair
 * with `toneFromValue()` to derive the right tone from a pipelineId +
 * value pair — that's what makes the same `negative` tag look red
 * everywhere it appears, without each call site reinventing the mapping.
 */

import type React from 'react';

export type TagTone =
  // Semantic states — first choice when the value carries meaning
  | 'positive' // praise, sentiment=positive
  | 'negative' // sentiment=negative
  | 'danger' // spam=true, fraud=true, removed
  | 'warning' // bug, refund, billing
  | 'info' // question, feature_request, account
  | 'success' // approve, resolved
  | 'brand' // tied to the installation accent — for highlight-without-meaning chips
  | 'neutral' // unknown / generic
  | 'muted' // de-emphasized rows (audit-only, no-op)
  | 'mono'; // code-like values (pipeline IDs, post IDs, raw conditions)

export type TagSize = 'xs' | 'sm';

export interface TagProps {
  tone?: TagTone;
  size?: TagSize;
  /** Leading icon — emoji string or React node. */
  icon?: React.ReactNode;
  /** Show a small colored dot before the label (mutually meaningful with `tone`). */
  dot?: boolean;
  /** Use monospace font — auto on for tone="mono" but overridable. */
  mono?: boolean;
  /** Truncate at maxWidth (in px). Without this, long values wrap. */
  truncate?: number | true;
  /** Tooltip when the value is truncated or otherwise abbreviated. */
  title?: string;
  /** Click to drill in. Adds hover lift + cursor. */
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

const TONE: Record<TagTone, { bg: string; fg: string; dot: string }> = {
  positive: {
    bg: 'bg-[var(--success-3)]',
    fg: 'text-[var(--success-11)]',
    dot: 'bg-[var(--success-9)]',
  },
  negative: {
    bg: 'bg-[var(--error-3)]',
    fg: 'text-[var(--error-11)]',
    dot: 'bg-[var(--error-9)]',
  },
  danger: {
    bg: 'bg-[var(--error-3)]',
    fg: 'text-[var(--error-11)]',
    dot: 'bg-[var(--error-9)]',
  },
  warning: {
    bg: 'bg-[var(--warn-3)]',
    fg: 'text-[var(--warn-11)]',
    dot: 'bg-[var(--warn-9)]',
  },
  info: {
    // Cool blue-tinged variant of accent for "informational" without
    // competing with the brand accent. We use n-3/n-9 so it stays neutral
    // even when accent is overridden to a hot color.
    bg: 'bg-[var(--n-3)]',
    fg: 'text-[var(--n-11)]',
    dot: 'bg-[var(--n-8)]',
  },
  success: {
    bg: 'bg-[var(--success-3)]',
    fg: 'text-[var(--success-11)]',
    dot: 'bg-[var(--success-9)]',
  },
  brand: {
    bg: 'bg-[var(--accent-3)]',
    fg: 'text-[var(--accent-11)]',
    dot: 'bg-[var(--accent-9)]',
  },
  neutral: {
    bg: 'bg-[var(--n-3)]',
    fg: 'text-[var(--n-10)]',
    dot: 'bg-[var(--n-8)]',
  },
  muted: {
    bg: 'bg-[var(--n-2)]',
    fg: 'text-[var(--n-8)]',
    dot: 'bg-[var(--n-7)]',
  },
  mono: {
    bg: 'bg-[var(--n-3)]',
    fg: 'text-[var(--n-11)]',
    dot: 'bg-[var(--n-8)]',
  },
};

const SIZE: Record<TagSize, string> = {
  xs: 'px-1.5 py-0.5 text-[length:var(--t-xs)]',
  sm: 'px-2 py-0.5 text-[length:var(--t-xs)]',
};

export function Tag({
  tone = 'neutral',
  size = 'sm',
  icon,
  dot = false,
  mono,
  truncate,
  title,
  onClick,
  className = '',
  children,
}: TagProps) {
  const interactive = typeof onClick === 'function';
  const isMono = mono ?? tone === 'mono';
  const truncateClass =
    truncate === true ? 'max-w-[160px] truncate' : typeof truncate === 'number' ? 'truncate' : '';
  const truncateStyle = typeof truncate === 'number' ? { maxWidth: `${truncate}px` } : undefined;

  const className_ = [
    'inline-flex items-center gap-1 rounded-[var(--r-1)] font-medium leading-snug',
    'transition-[transform,background-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease)]',
    SIZE[size],
    TONE[tone].bg,
    TONE[tone].fg,
    isMono ? 'font-mono tracking-tight' : '',
    interactive
      ? 'cursor-pointer hover:-translate-y-px hover:shadow-[var(--shadow-1)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]'
      : '',
    truncateClass,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {dot ? (
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} />
      ) : null}
      {icon ? (
        <span aria-hidden="true" className="text-[1em] leading-none">
          {icon}
        </span>
      ) : null}
      <span className={truncateClass ? 'truncate' : ''}>{children}</span>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={className_}
        style={truncateStyle}
        title={title}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={className_} style={truncateStyle} title={title}>
      {content}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Semantic helpers
// ---------------------------------------------------------------------------

/**
 * Map a pipeline tag (`pipelineId` + `value`) to a tone. Centralizes the
 * "what color is bug?" decision so the same value looks the same wherever
 * it appears. Unknown combos fall back to `neutral`.
 *
 * - pipelineId is matched loosely: handles 'pi_sentiment-scorer',
 *   'sentiment-scorer', 'sentiment', etc. via substring tests.
 * - value is string-compared case-insensitively (boolean true/false too).
 */
export function toneFromValue(pipelineId: string, value: string | number | boolean): TagTone {
  const pid = pipelineId.toLowerCase();
  const vStr = typeof value === 'string' ? value.toLowerCase() : String(value).toLowerCase();

  // Boolean-output pipelines: true = danger/warning, false = muted
  if (pid.includes('fraud')) return vStr === 'true' ? 'danger' : 'muted';
  if (pid.includes('spam')) return vStr === 'true' ? 'danger' : 'muted';
  if (pid.includes('pii')) return vStr === 'true' ? 'warning' : 'muted';
  if (pid.includes('impostor')) return vStr === 'true' ? 'warning' : 'muted';
  if (pid.includes('crisis') || pid.includes('volume-spike'))
    return vStr === 'true' ? 'danger' : 'muted';

  // Sentiment
  if (pid.includes('sentiment')) {
    if (vStr === 'positive') return 'positive';
    if (vStr === 'negative') return 'negative';
    return 'neutral';
  }

  // Intent / contact-drivers
  if (pid.includes('intent') || pid.includes('contact-driver') || pid.includes('drivers')) {
    if (vStr === 'praise') return 'positive';
    if (vStr === 'bug') return 'warning';
    if (vStr === 'refund' || vStr === 'billing') return 'warning';
    if (vStr === 'feature_request' || vStr === 'question' || vStr === 'account') return 'info';
    return 'neutral';
  }

  // Themes / clusters — neutral pills, the cluster ID is the signal
  if (pid.includes('theme') || pid.includes('cluster')) return 'neutral';

  // Numeric scalar tags
  if (typeof value === 'number') return 'neutral';

  return 'neutral';
}

/**
 * Tone for a generic kind/category label (used on PipelineSummaryCard,
 * Catalogue cards). Distinct from `toneFromValue` because kinds describe
 * shape, not state.
 */
export function toneFromKind(
  kind: 'categorical' | 'ordinal' | 'cluster' | 'scalar' | 'boolean',
): TagTone {
  switch (kind) {
    case 'boolean':
      return 'warning';
    case 'cluster':
      return 'info';
    case 'scalar':
      return 'neutral';
    default:
      return 'mono';
  }
}
