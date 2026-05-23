/**
 * ContentBrowser — Universal content management surface.
 *
 * A full-bleed data table that lets mods slice/dice every post + comment
 * with filters, text search, sort, bulk actions, and inline respond.
 *
 * Track B of the platform expansion.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type ContentItem,
  type ContentSearchParams,
  type ContentSort,
  type ContentType,
  formatDriverPath,
  type PipelineRecord,
  type PostStatus,
  type TaxonomyNode,
} from '../lib/api.ts';
import { decodePipelineTags, encodePipelineTags } from '../lib/content-url.ts';

// ---------------------------------------------------------------------------
// URL state serialization
// ---------------------------------------------------------------------------

export interface ContentFilters {
  q: string;
  drivers: string[];
  sentiments: string[];
  statuses: string[];
  author: string;
  hasAgent: 'yes' | 'no' | 'any';
  dateRange: 'today' | '7d' | '30d' | 'custom' | '';
  from: string;
  to: string;
  type: ContentType;
  sort: ContentSort;
  /** Dynamic pipeline tag filters: pipelineId → selected values */
  pipelineTags: Record<string, string[]>;
}

export const DEFAULT_FILTERS: ContentFilters = {
  q: '',
  drivers: [],
  sentiments: [],
  statuses: [],
  author: '',
  hasAgent: 'any',
  dateRange: '',
  from: '',
  to: '',
  type: 'both',
  sort: 'priority_desc',
  pipelineTags: {},
};

export function filtersToSearchParams(f: ContentFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.drivers.length) p.set('driver', f.drivers.join(','));
  if (f.sentiments.length) p.set('sentiment', f.sentiments.join(','));
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.author) p.set('author', f.author);
  if (f.hasAgent !== 'any') p.set('hasAgent', f.hasAgent);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  if (f.type !== 'both') p.set('type', f.type);
  if (f.sort !== 'priority_desc') p.set('sort', f.sort);
  encodePipelineTags(f.pipelineTags, p);
  return p;
}

export function searchParamsToFilters(p: URLSearchParams): ContentFilters {
  const raw = {
    q: p.get('q') ?? '',
    drivers: p.get('driver') ? (p.get('driver') ?? '').split(',').filter(Boolean) : [],
    sentiments: p.get('sentiment') ? (p.get('sentiment') ?? '').split(',').filter(Boolean) : [],
    statuses: p.get('status') ? (p.get('status') ?? '').split(',').filter(Boolean) : [],
    author: p.get('author') ?? '',
    hasAgent: (p.get('hasAgent') ?? 'any') as ContentFilters['hasAgent'],
    dateRange: (p.get('dateRange') ?? '') as ContentFilters['dateRange'],
    from: p.get('from') ?? '',
    to: p.get('to') ?? '',
    type: (p.get('type') ?? 'both') as ContentType,
    sort: (p.get('sort') ?? 'priority_desc') as ContentSort,
    pipelineTags: decodePipelineTags(p),
  };
  // Validate hasAgent
  if (!['yes', 'no', 'any'].includes(raw.hasAgent)) raw.hasAgent = 'any';
  return raw;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Filter chip dropdown
// ---------------------------------------------------------------------------

interface ChipDropdownProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function ChipDropdown({ label, options, selected, onChange }: ChipDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const isActive = selected.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-pressed={isActive}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
          isActive
            ? 'border-[var(--accent-9)] bg-[var(--accent-3)] text-[var(--accent-11)]'
            : 'border-[var(--n-4)] bg-[var(--n-3)] text-[var(--n-8)] hover:text-[var(--n-11)]'
        }`}
      >
        {label}
        {isActive ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-9)] text-[10px] font-bold text-white">
            {selected.length}
          </span>
        ) : (
          <span className="text-[var(--n-8)]">▾</span>
        )}
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 min-w-[160px] rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] py-1 shadow-[var(--shadow-2)]">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="accent-[var(--accent-9)]"
                aria-label={o.label}
              />
              {o.label}
            </label>
          ))}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--n-8)] hover:text-[var(--n-11)]"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sentiment badge
// ---------------------------------------------------------------------------

function SentimentChip({ label }: { label: 'positive' | 'neutral' | 'negative' | null }) {
  if (!label) return null;
  const style =
    label === 'positive'
      ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
      : label === 'negative'
        ? 'border-[var(--error-9)] bg-[var(--error-3)] text-[var(--error-11)]'
        : 'border-[var(--n-4)] bg-[var(--n-3)] text-[var(--n-11)]';
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${style}`}>{label}</span>;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: PostStatus | null }) {
  if (!status) return null;
  const style =
    status === 'resolved'
      ? 'border-[var(--success-9)] bg-[var(--success-3)] text-[var(--success-11)]'
      : status === 'in-progress'
        ? 'border-[var(--accent-9)] bg-[var(--accent-3)] text-[var(--accent-11)]'
        : status === 'responded'
          ? 'border-[var(--n-6)] bg-[var(--n-3)] text-[var(--n-11)]'
          : 'border-[var(--n-4)] bg-[var(--n-3)] text-[var(--n-8)]';
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${style}`}>{status}</span>;
}

// ---------------------------------------------------------------------------
// Thread drawer (inline respond)
// ---------------------------------------------------------------------------

interface RespondDrawerProps {
  item: ContentItem;
  taxonomy: TaxonomyNode[];
  onClose: () => void;
}

function RespondDrawer({ item, taxonomy, onClose }: RespondDrawerProps) {
  const [body, setBody] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const threadQ = useQuery({
    queryKey: ['post-thread', item.postId],
    queryFn: () => api.postThread(item.postId),
  });

  useEffect(() => {
    if (dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
    // Focus textarea when drawer opens
    setTimeout(() => textareaRef.current?.focus(), 50);
    return () => {
      if (dialogRef.current?.open) {
        dialogRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDraft = async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      const result = await api.draftReply(item.postId);
      if (result.candidates.length > 0) {
        setBody(result.candidates[0]?.reply ?? '');
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : String(err));
    } finally {
      setDrafting(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    try {
      const result = await api.postReply(item.postId, body);
      setSubmitted(result.commentId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  const recentComments = (threadQ.data?.comments ?? []).slice(-5);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: keyboard handled via useEffect above
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-label={`Respond to: ${item.title}`}
        className="relative m-0 flex h-full max-w-2xl flex-col overflow-y-auto border-l border-[var(--n-4)] bg-[var(--n-1)] p-0 text-[var(--n-11)] open:flex"
        style={{ width: 'min(640px, 100vw)' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--n-4)] bg-[var(--n-1)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-[var(--n-8)]">Responding to</p>
            <p className="mt-0.5 truncate text-sm font-medium text-[var(--n-11)]">{item.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex-shrink-0 text-[var(--n-8)] hover:text-[var(--n-11)]"
            aria-label="Close respond drawer"
          >
            ✕
          </button>
        </div>

        {/* Post context */}
        <div className="border-b border-[var(--n-4)] px-5 py-3">
          <div className="flex flex-wrap gap-2 text-xs text-[var(--n-8)]">
            <span>u/{item.authorName}</span>
            <span>·</span>
            <span>{relativeTime(item.createdAt)}</span>
            {item.driverId ? (
              <>
                <span>·</span>
                <span className="text-[var(--accent-11)]">
                  {formatDriverPath(item.driverId, taxonomy)}
                </span>
              </>
            ) : null}
            <SentimentChip label={item.sentimentLabel} />
            <StatusChip status={item.status} />
          </div>
          {item.body ? (
            <p className="mt-2 text-sm text-[var(--n-11)] line-clamp-3">{item.body}</p>
          ) : null}
          <a
            href={item.url}
            target="_top"
            rel="noopener noreferrer"
            className="mt-1 block text-xs text-[var(--accent-11)] underline-offset-2 hover:underline"
          >
            Open on Reddit ↗
          </a>
        </div>

        {/* Recent thread */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]">
            Recent comments
          </p>
          {threadQ.isPending ? (
            <div className="h-20 animate-pulse rounded-[var(--r-2)] bg-[var(--n-3)]" />
          ) : recentComments.length === 0 ? (
            <p className="text-xs text-[var(--n-8)]">No comments yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentComments.map((c) => (
                <li
                  key={c.commentId}
                  className={`rounded-[var(--r-2)] border px-3 py-2 text-sm ${
                    c.isAgent
                      ? 'border-[var(--accent-9)] bg-[var(--accent-3)]'
                      : 'border-[var(--n-4)] bg-[var(--n-2)]'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2 text-xs text-[var(--n-8)]">
                    <span
                      className={
                        c.isAgent ? 'text-[var(--accent-11)] font-medium' : 'text-[var(--n-11)]'
                      }
                    >
                      u/{c.authorName}
                    </span>
                    <span>·</span>
                    <span>{relativeTime(c.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-[var(--n-11)]">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Reply compose */}
        <div className="sticky bottom-0 border-t border-[var(--n-4)] bg-[var(--n-1)] px-5 py-4">
          {submitted ? (
            <div className="rounded-[var(--r-2)] border border-[var(--success-9)] bg-[var(--success-3)] p-3 text-sm text-[var(--success-11)]">
              Reply submitted! Comment ID: {submitted}
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your reply…"
                rows={4}
                className="w-full resize-none rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 text-sm text-[var(--n-11)] placeholder:text-[var(--n-6)] focus:border-[var(--accent-9)] focus:outline-none"
                aria-label="Reply text"
              />
              {draftError ? (
                <p className="mt-1 text-xs text-[var(--error-11)]">{draftError}</p>
              ) : null}
              {submitError ? (
                <p className="mt-1 text-xs text-[var(--error-11)]">{submitError}</p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={handleDraft}
                  disabled={drafting}
                  className="rounded-[var(--r-2)] border border-[var(--n-6)] bg-[var(--n-3)] px-3 py-1.5 text-xs text-[var(--n-11)] transition hover:bg-[var(--n-4)] disabled:opacity-50"
                >
                  {drafting ? 'Drafting…' : '✨ AI draft'}
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!body.trim()}
                  className="ml-auto rounded-[var(--r-2)] bg-[var(--accent-9)] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-10)] disabled:opacity-50"
                >
                  Submit reply
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row action dropdown — full mod actions
// ---------------------------------------------------------------------------

type ConfirmAction = 'remove' | 'spam';

interface ModReplyDrawerProps {
  item: ContentItem;
  onClose: () => void;
  onToast: (msg: string) => void;
}

function ModReplyDrawer({ item, onClose, onToast }: ModReplyDrawerProps) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [as_, setAs] = useState<'app' | 'user'>('user');
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleDraft = async () => {
    setDrafting(true);
    try {
      const result = await api.draftReply(item.postId);
      if (result.candidates.length > 0) setBody(result.candidates[0]?.reply ?? '');
    } catch (err) {
      onToast(`Draft failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDrafting(false);
    }
  };

  const handleSubmit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.mod.replyToPost(item.postId, body, as_);
      onToast('Reply submitted');
      await qc.invalidateQueries({ queryKey: ['content-search'] });
      onClose();
    } catch (err) {
      onToast(`Reply failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: keyboard handled via useEffect above
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-full max-w-lg flex-col border-l border-[var(--n-4)] bg-[var(--n-1)] text-[var(--n-11)]"
        style={{ width: 'min(480px, 100vw)' }}
      >
        <div className="flex items-center justify-between border-b border-[var(--n-4)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-[var(--n-8)]">Reply…</p>
            <p className="mt-0.5 truncate text-sm font-medium">{item.title || '(no title)'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 text-[var(--n-8)] hover:text-[var(--n-11)]"
            aria-label="Close reply drawer"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your reply…"
            rows={6}
            className="w-full resize-none rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 text-sm text-[var(--n-11)] placeholder:text-[var(--n-6)] focus:border-[var(--accent-9)] focus:outline-none"
            aria-label="Reply text"
          />
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--n-8)]">Send as:</span>
            <label className="flex items-center gap-1.5 text-xs text-[var(--n-11)] cursor-pointer">
              <input
                type="radio"
                name="reply-as"
                value="user"
                checked={as_ === 'user'}
                onChange={() => setAs('user')}
                className="accent-[var(--accent-9)]"
              />
              Me (moderator)
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[var(--n-11)] cursor-pointer">
              <input
                type="radio"
                name="reply-as"
                value="app"
                checked={as_ === 'app'}
                onChange={() => setAs('app')}
                className="accent-[var(--accent-9)]"
              />
              RedLattice bot
            </label>
          </div>
        </div>
        <div className="border-t border-[var(--n-4)] px-5 py-4 flex gap-2">
          <button
            type="button"
            onClick={handleDraft}
            disabled={drafting}
            className="rounded-[var(--r-2)] border border-[var(--n-6)] bg-[var(--n-3)] px-3 py-1.5 text-xs text-[var(--n-11)] transition hover:bg-[var(--n-4)] disabled:opacity-50"
          >
            {drafting ? 'Drafting…' : '✨ AI draft'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!body.trim() || busy}
            className="ml-auto rounded-[var(--r-2)] bg-[var(--accent-9)] px-4 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-10)] disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface RowActionsProps {
  item: ContentItem;
  onRespond: () => void;
  onStatusChange: (status: PostStatus) => void;
  onToast: (msg: string) => void;
}

function RowActions({ item, onRespond, onStatusChange, onToast }: RowActionsProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const [showReply, setShowReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isPost = item.type === 'post';

  const runAction = async (action: () => Promise<void>, label: string) => {
    setBusy(true);
    setOpen(false);
    try {
      await action();
      onToast(`${label} succeeded`);
      await qc.invalidateQueries({ queryKey: ['content-search'] });
    } catch (err) {
      onToast(`${label} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = () =>
    runAction(
      isPost ? () => api.mod.approvePost(item.id) : () => api.mod.approveComment(item.id),
      'Approve',
    );

  const handleRemove = (spam: boolean) =>
    runAction(
      isPost
        ? () => api.mod.removePost(item.id, { spam })
        : () => api.mod.removeComment(item.id, { spam }),
      spam ? 'Mark spam' : 'Remove',
    );

  const handleLock = () => runAction(() => api.mod.lockPost(item.postId), 'Lock');

  const handleDistinguish = () =>
    runAction(() => api.mod.distinguishComment(item.id), 'Distinguish');

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={busy}
          className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-3)] px-2 py-1 text-xs text-[var(--n-11)] hover:bg-[var(--n-4)] disabled:opacity-50"
          aria-label="Row actions"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {busy ? '…' : '⋯'}
        </button>
        {open ? (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 min-w-[180px] rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] py-1 shadow-[var(--shadow-2)]"
          >
            {/* Approve */}
            <button
              role="menuitem"
              type="button"
              onClick={handleApprove}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--success-11)] hover:bg-[var(--n-3)]"
            >
              Approve
            </button>

            <div className="my-1 border-t border-[var(--n-4)]" />

            {/* Remove / Spam — destructive, need confirm */}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirming('remove');
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--error-11)] hover:bg-[var(--n-3)]"
            >
              Remove
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirming('spam');
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--error-11)] hover:bg-[var(--n-3)]"
            >
              Mark spam
            </button>

            <div className="my-1 border-t border-[var(--n-4)]" />

            {/* Lock — applies to parent post for comments too */}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                void handleLock();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
            >
              Lock{!isPost ? ' (parent post)' : ''}
            </button>

            {/* Distinguish — comment only */}
            {!isPost ? (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setOpen(false);
                  void handleDistinguish();
                }}
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
              >
                Distinguish
              </button>
            ) : null}

            <div className="my-1 border-t border-[var(--n-4)]" />

            {/* Reply with send-mode choice */}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                setShowReply(true);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--accent-11)] hover:bg-[var(--n-3)]"
            >
              Reply…
            </button>

            {/* Respond (existing tag/status drawer) */}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onRespond();
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
            >
              Respond (tag/status)
            </button>

            <div className="my-1 border-t border-[var(--n-4)]" />

            {/* Status shortcuts */}
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onStatusChange('resolved');
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
            >
              Mark resolved
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onStatusChange('in-progress');
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
            >
              Mark in-progress
            </button>
            <a
              role="menuitem"
              href={item.url}
              target="_top"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
            >
              Open on Reddit ↗
            </a>
          </div>
        ) : null}
      </div>

      {/* Confirmation dialog for destructive actions */}
      {confirming ? (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: keyboard ESC handled by outer handler
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(null);
          }}
        >
          <div className="w-80 rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] p-5 shadow-[var(--shadow-3)]">
            <h3 className="mb-2 text-sm font-semibold text-[var(--n-11)]">
              {confirming === 'spam' ? 'Mark as spam?' : 'Remove this content?'}
            </h3>
            <p className="mb-4 text-xs text-[var(--n-8)]">
              {confirming === 'spam'
                ? 'This will remove the content and flag it as spam.'
                : 'This will remove the content from the subreddit.'}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-[var(--r-2)] border border-[var(--n-4)] px-3 py-1.5 text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = confirming;
                  setConfirming(null);
                  void handleRemove(c === 'spam');
                }}
                className="rounded-[var(--r-2)] border border-[var(--error-9)] bg-[var(--error-3)] px-3 py-1.5 text-xs text-[var(--error-11)] hover:bg-[var(--error-3)]"
              >
                {confirming === 'spam' ? 'Mark spam' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Reply drawer */}
      {showReply ? (
        <ModReplyDrawer item={item} onClose={() => setShowReply(false)} onToast={onToast} />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Column header (sortable)
// ---------------------------------------------------------------------------

interface ColHeaderProps {
  label: string;
  sortKey: ContentSort | null;
  currentSort: ContentSort;
  onSort: (s: ContentSort) => void;
  className?: string;
}

function ColHeader({ label, sortKey, currentSort, onSort, className = '' }: ColHeaderProps) {
  if (!sortKey) {
    return (
      <th
        scope="col"
        className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--n-8)] ${className}`}
      >
        {label}
      </th>
    );
  }

  const isDesc = currentSort === sortKey;
  const isAsc =
    currentSort === (sortKey.replace('desc', 'asc').replace('asc', 'desc') as ContentSort);
  const ariaSortValue = isDesc ? 'descending' : isAsc ? 'ascending' : 'none';

  return (
    <th
      scope="col"
      aria-sort={ariaSortValue}
      className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-wide ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group flex items-center gap-1 transition ${
          isDesc || isAsc ? 'text-[var(--accent-11)]' : 'text-[var(--n-8)] hover:text-[var(--n-11)]'
        }`}
      >
        {label}
        <span className="opacity-60">{isDesc ? '↓' : isAsc ? '↑' : '↕'}</span>
      </button>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Export menu
// ---------------------------------------------------------------------------

function ExportMenu({ items }: { items: ContentItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const downloadCSV = () => {
    const headers = [
      'id',
      'type',
      'title',
      'author',
      'driver',
      'sentiment',
      'status',
      'createdAt',
      'url',
    ];
    const rows = items.map((i) => [
      i.id,
      i.type,
      `"${i.title.replace(/"/g, '""')}"`,
      i.authorName,
      i.driverId ?? '',
      i.sentimentLabel ?? '',
      i.status ?? '',
      new Date(i.createdAt).toISOString(),
      i.url,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `content-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `content-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-1.5 text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
        aria-haspopup="menu"
      >
        Export ▾
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[120px] rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] py-1 shadow-[var(--shadow-2)]"
        >
          <button
            role="menuitem"
            type="button"
            onClick={downloadCSV}
            className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
          >
            Export CSV
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={downloadJSON}
            className="block w-full px-3 py-1.5 text-left text-xs text-[var(--n-11)] hover:bg-[var(--n-3)]"
          >
            Export JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk action toolbar
// ---------------------------------------------------------------------------

interface BulkToolbarProps {
  selected: Set<string>;
  onClear: () => void;
  onSelectAll: () => void;
  taxonomy: TaxonomyNode[];
  onBulkStatus: (status: PostStatus) => Promise<void>;
  onBulkTag: (driverId: string) => Promise<void>;
  busy: boolean;
}

function BulkToolbar({
  selected,
  onClear,
  onSelectAll,
  taxonomy,
  onBulkStatus,
  onBulkTag,
  busy,
}: BulkToolbarProps) {
  const [tagDriver, setTagDriver] = useState('');

  if (selected.size === 0) return null;

  const rootDrivers = taxonomy.filter((t) => !t.parentId);

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t border-[var(--accent-9)]/40 bg-[var(--n-1)]/95 px-4 py-3 text-sm backdrop-blur"
    >
      <span className="font-medium text-[var(--accent-11)]">{selected.size} selected</span>
      <span className="text-[var(--n-8)]">·</span>

      <button
        type="button"
        onClick={() => onBulkStatus('resolved')}
        disabled={busy}
        className="rounded-[var(--r-2)] border border-[var(--success-9)] bg-[var(--success-3)] px-3 py-1 text-xs text-[var(--success-11)] transition hover:opacity-80 disabled:opacity-50"
      >
        Mark resolved
      </button>
      <button
        type="button"
        onClick={() => onBulkStatus('in-progress')}
        disabled={busy}
        className="rounded-[var(--r-2)] border border-[var(--accent-9)] bg-[var(--accent-3)] px-3 py-1 text-xs text-[var(--accent-11)] transition hover:opacity-80 disabled:opacity-50"
      >
        Mark in-progress
      </button>

      {rootDrivers.length > 0 ? (
        <div className="flex items-center gap-1">
          <select
            value={tagDriver}
            onChange={(e) => setTagDriver(e.target.value)}
            className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-xs text-[var(--n-11)]"
            aria-label="Tag with intent"
          >
            <option value="">Tag intent…</option>
            {taxonomy.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {tagDriver ? (
            <button
              type="button"
              onClick={async () => {
                await onBulkTag(tagDriver);
                setTagDriver('');
              }}
              disabled={busy}
              className="rounded-[var(--r-2)] bg-[var(--accent-9)] px-3 py-1 text-xs text-white transition hover:bg-[var(--accent-10)] disabled:opacity-50"
            >
              Apply tag
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSelectAll}
        className="text-xs text-[var(--n-8)] underline-offset-2 hover:text-[var(--n-11)] hover:underline"
      >
        Select all matching
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs text-[var(--n-8)] underline-offset-2 hover:text-[var(--n-11)] hover:underline"
      >
        Clear (Esc)
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ContentBrowser component
// ---------------------------------------------------------------------------

export function ContentBrowser() {
  const qc = useQueryClient();

  // Read initial filters from URL (the tab navigation may carry ?content params)
  const [filters, setFilters] = useState<ContentFilters>(() => {
    const params = new URLSearchParams(window.location.search);
    return searchParamsToFilters(params);
  });

  // Debounce references
  const qDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedFilters, setDebouncedFilters] = useState<ContentFilters>(filters);

  // Debounce text search (500ms) and other filter changes (300ms)
  useEffect(() => {
    if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
    const delay = filters.q !== debouncedFilters.q ? 500 : 300;
    qDebounceRef.current = setTimeout(() => {
      setDebouncedFilters(filters);
    }, delay);
    return () => {
      if (qDebounceRef.current) clearTimeout(qDebounceRef.current);
    };
  }, [filters, debouncedFilters.q]);

  // Sync filters back to URL
  useEffect(() => {
    const params = filtersToSearchParams(filters);
    params.set('tab', 'content');
    history.replaceState(null, '', `?${params.toString()}`);
  }, [filters]);

  // Pagination
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  // Reset pagination when filters change — debouncedFilters as dep is intentional (resets on filter change)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional dependency on filter object identity
  useEffect(() => {
    setOffset(0);
  }, [debouncedFilters]);

  // Build search params
  const searchParams = useMemo((): ContentSearchParams => {
    const p: ContentSearchParams = {
      type: debouncedFilters.type,
      sort: debouncedFilters.sort,
      limit: LIMIT,
      offset,
    };
    if (debouncedFilters.q) p.q = debouncedFilters.q;
    if (debouncedFilters.drivers.length) p.driver = debouncedFilters.drivers.join(',');
    if (debouncedFilters.sentiments.length) p.sentiment = debouncedFilters.sentiments.join(',');
    if (debouncedFilters.statuses.length) p.status = debouncedFilters.statuses.join(',');
    if (debouncedFilters.author) p.author = debouncedFilters.author;
    if (debouncedFilters.hasAgent !== 'any') p.hasAgent = debouncedFilters.hasAgent;
    if (debouncedFilters.from) p.from = debouncedFilters.from;
    if (debouncedFilters.to) p.to = debouncedFilters.to;
    const activeTags = Object.fromEntries(
      Object.entries(debouncedFilters.pipelineTags).filter(([, v]) => v.length > 0),
    );
    if (Object.keys(activeTags).length > 0) p.pipelineTags = activeTags;
    return p;
  }, [debouncedFilters, offset]);

  const contentQ = useQuery({
    queryKey: ['content-search', searchParams],
    queryFn: () => api.contentSearch(searchParams),
    placeholderData: (prev) => prev,
  });

  const taxonomyQ = useQuery({
    queryKey: ['taxonomy'],
    queryFn: () => api.taxonomy(),
    staleTime: 5 * 60 * 1000,
  });

  const pipelinesQ = useQuery({
    queryKey: ['pipelines-enabled'],
    queryFn: () => api.pipelines.enabled(),
    staleTime: 5 * 60 * 1000,
  });

  const taxonomy = taxonomyQ.data?.taxonomy ?? [];

  // Pipelines that can produce filterable tag dimensions (not builtin intent/sentiment handled separately)
  const filterablePipelines: PipelineRecord[] = (pipelinesQ.data?.pipelines ?? []).filter(
    (p) =>
      p.source === 'custom' &&
      (p.kind === 'categorical' || p.kind === 'ordinal' || p.kind === 'boolean') &&
      (p.labels?.length ?? 0) > 0,
  );
  const items = contentQ.data?.items ?? [];
  const total = contentQ.data?.total ?? 0;

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkToast, setBulkToast] = useState<string | null>(null);

  // Respond drawer
  const [respondItem, setRespondItem] = useState<ContentItem | null>(null);

  // Search expand state
  const [searchExpanded, setSearchExpanded] = useState(filters.q.length > 0);

  // Column visibility (score column toggleable; others deferred)
  const [visibleCols] = useState({
    score: false,
    latency: false,
    replyCount: false,
    agent: false,
  });

  // Keyboard: Escape clears selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleOne = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey) {
        // Range select — select from last selected to this one
        const ids = items.map((i) => i.id);
        const clickedIdx = ids.indexOf(id);
        const selectedIds = [...selected];
        const lastSelectedIdx = ids.findIndex((iid) => iid === selectedIds[selectedIds.length - 1]);
        if (lastSelectedIdx >= 0 && clickedIdx >= 0) {
          const [lo, hi] = [
            Math.min(clickedIdx, lastSelectedIdx),
            Math.max(clickedIdx, lastSelectedIdx),
          ];
          const range = ids.slice(lo, hi + 1);
          setSelected((prev) => new Set([...prev, ...range]));
          return;
        }
      }
      if (e.metaKey || e.ctrlKey) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [items, selected],
  );

  const toggleAll = () => {
    const allIds = items.map((i) => i.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const bulkSetStatus = async (status: PostStatus) => {
    setBulkBusy(true);
    try {
      const result = await api.bulkSetStatus([...selected], status);
      setBulkToast(
        `${result.succeeded} updated${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
      );
      setTimeout(() => setBulkToast(null), 3500);
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ['content-search'] });
    } catch (err) {
      setBulkToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkTag = async (driverId: string) => {
    setBulkBusy(true);
    try {
      const result = await api.bulkTag([...selected], driverId);
      setBulkToast(
        `${result.succeeded} tagged${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
      );
      setTimeout(() => setBulkToast(null), 3500);
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ['content-search'] });
    } catch (err) {
      setBulkToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleStatusChange = async (itemId: string, status: PostStatus) => {
    try {
      await api.setPostStatus(itemId, status);
      await qc.invalidateQueries({ queryKey: ['content-search'] });
    } catch (err) {
      setBulkToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const updateFilter = useCallback(
    <K extends keyof ContentFilters>(key: K, value: ContentFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleDateRange = (range: ContentFilters['dateRange']) => {
    const now = new Date();
    const toStr = (d: Date) => d.toISOString().slice(0, 10);
    if (range === 'today') {
      updateFilter('dateRange', 'today');
      updateFilter('from', toStr(now));
      updateFilter('to', toStr(now));
    } else if (range === '7d') {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      updateFilter('dateRange', '7d');
      updateFilter('from', toStr(from));
      updateFilter('to', toStr(now));
    } else if (range === '30d') {
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      updateFilter('dateRange', '30d');
      updateFilter('from', toStr(from));
      updateFilter('to', toStr(now));
    } else {
      updateFilter('dateRange', range);
    }
  };

  const clearAllFilters = () => setFilters({ ...DEFAULT_FILTERS });

  const hasActiveFilters =
    filters.q ||
    filters.drivers.length ||
    filters.sentiments.length ||
    filters.statuses.length ||
    filters.author ||
    filters.hasAgent !== 'any' ||
    filters.from ||
    filters.to ||
    Object.values(filters.pipelineTags).some((v) => v.length > 0);

  const allIds = items.map((i) => i.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const DRIVER_OPTIONS = [
    { value: 'untagged', label: 'Untagged' },
    ...taxonomy.map((t) => ({ value: t.id, label: t.label })),
  ];

  const SENTIMENT_OPTIONS = [
    { value: 'positive', label: 'Positive' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'negative', label: 'Negative' },
    { value: 'unscored', label: 'Unscored' },
  ];

  const STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'in-progress', label: 'In progress' },
    { value: 'responded', label: 'Responded' },
    { value: 'resolved', label: 'Resolved' },
  ];

  const SORT_OPTIONS: { value: ContentSort; label: string }[] = [
    { value: 'priority_desc', label: 'Priority (high first)' },
    { value: 'createdAt_desc', label: 'Newest first' },
    { value: 'createdAt_asc', label: 'Oldest first' },
    { value: 'sentimentScore_asc', label: 'Most negative first' },
    { value: 'sentimentScore_desc', label: 'Most positive first' },
  ];

  return (
    <section className="flex min-h-0 flex-col">
      {/* ------------------------------------------------------------------ */}
      {/* Header */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm uppercase tracking-wide text-[var(--n-8)]">Content</h2>
          <select
            value={filters.type}
            onChange={(e) => updateFilter('type', e.target.value as ContentType)}
            className="rounded border border-[var(--n-4)] bg-[var(--n-3)] px-2 py-1 text-xs text-[var(--n-11)]"
            aria-label="Content type"
          >
            <option value="both">Posts &amp; Comments</option>
            <option value="post">Posts only</option>
            <option value="comment">Comments only</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          {contentQ.isFetching ? (
            <span className="text-xs text-[var(--n-8)]">Loading…</span>
          ) : (
            <span className="text-xs text-[var(--n-8)]">
              {total.toLocaleString()} item{total !== 1 ? 's' : ''}
            </span>
          )}
          <ExportMenu items={items} />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Filter bar */}
      {/* ------------------------------------------------------------------ */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-[var(--n-4)] bg-[var(--n-1)]/95 pb-3 pt-1 backdrop-blur">
        {/* Text search */}
        {searchExpanded ? (
          <div className="flex flex-1 items-center gap-1 rounded-full border border-[var(--accent-9)] bg-[var(--n-2)] px-3 py-1">
            <span className="text-xs text-[var(--n-8)]">🔍</span>
            <input
              type="search"
              value={filters.q}
              onChange={(e) => updateFilter('q', e.target.value)}
              placeholder="Search titles and bodies…"
              className="flex-1 bg-transparent text-xs text-[var(--n-11)] placeholder:text-[var(--n-6)] focus:outline-none"
              aria-label="Text search"
              // biome-ignore lint/a11y/noAutofocus: intentional focus when expanding search
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                updateFilter('q', '');
                setSearchExpanded(false);
              }}
              className="text-xs text-[var(--n-8)] hover:text-[var(--n-11)]"
              aria-label="Close search"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchExpanded(true)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
              filters.q
                ? 'border-[var(--accent-9)] bg-[var(--accent-3)] text-[var(--accent-11)]'
                : 'border-[var(--n-4)] bg-[var(--n-3)] text-[var(--n-8)] hover:text-[var(--n-11)]'
            }`}
            aria-pressed={!!filters.q}
          >
            🔍{' '}
            {filters.q
              ? `"${filters.q.slice(0, 20)}${filters.q.length > 20 ? '…' : ''}"`
              : 'Search'}
          </button>
        )}

        <ChipDropdown
          label="Intent"
          options={DRIVER_OPTIONS}
          selected={filters.drivers}
          onChange={(v) => updateFilter('drivers', v)}
        />
        <ChipDropdown
          label="Sentiment"
          options={SENTIMENT_OPTIONS}
          selected={filters.sentiments}
          onChange={(v) => updateFilter('sentiments', v)}
        />
        <ChipDropdown
          label="Status"
          options={STATUS_OPTIONS}
          selected={filters.statuses}
          onChange={(v) => updateFilter('statuses', v)}
        />

        {/* Dynamic pipeline tag filters */}
        {filterablePipelines.map((p) => (
          <ChipDropdown
            key={p.id}
            label={p.name}
            options={(p.labels ?? []).map((l) => ({ value: l, label: l }))}
            selected={filters.pipelineTags[p.id] ?? []}
            onChange={(v) => updateFilter('pipelineTags', { ...filters.pipelineTags, [p.id]: v })}
          />
        ))}

        {/* Author */}
        <div className="relative">
          <input
            type="text"
            value={filters.author}
            onChange={(e) => updateFilter('author', e.target.value)}
            placeholder="Author…"
            className={`w-28 rounded-full border bg-[var(--n-2)] px-3 py-1 text-xs text-[var(--n-11)] placeholder:text-[var(--n-6)] focus:outline-none ${
              filters.author ? 'border-[var(--accent-9)]' : 'border-[var(--n-4)]'
            }`}
            aria-label="Filter by author"
          />
        </div>

        {/* Has rep reply — simple toggle */}
        <select
          value={filters.hasAgent}
          onChange={(e) => updateFilter('hasAgent', e.target.value as ContentFilters['hasAgent'])}
          className={`rounded-full border bg-[var(--n-2)] px-3 py-1 text-xs text-[var(--n-11)] ${
            filters.hasAgent !== 'any' ? 'border-[var(--accent-9)]' : 'border-[var(--n-4)]'
          }`}
          aria-label="Has rep reply"
        >
          <option value="any">Rep reply: any</option>
          <option value="yes">Rep reply: yes</option>
          <option value="no">Rep reply: no</option>
        </select>

        {/* Date range */}
        <div className="flex items-center gap-1">
          {(['today', '7d', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={filters.dateRange === r}
              onClick={() => handleDateRange(filters.dateRange === r ? '' : r)}
              className={`rounded-full border px-2 py-1 text-xs transition ${
                filters.dateRange === r
                  ? 'border-[var(--accent-9)] bg-[var(--accent-3)] text-[var(--accent-11)]'
                  : 'border-[var(--n-4)] bg-[var(--n-3)] text-[var(--n-8)] hover:text-[var(--n-11)]'
              }`}
            >
              {r === 'today' ? 'Today' : r === '7d' ? 'Last 7d' : 'Last 30d'}
            </button>
          ))}
          {filters.dateRange === 'custom' || (filters.from && filters.dateRange === '') ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filters.from}
                onChange={(e) => updateFilter('from', e.target.value)}
                className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-0.5 text-xs text-[var(--n-11)]"
                aria-label="From date"
              />
              <span className="text-xs text-[var(--n-8)]">–</span>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => updateFilter('to', e.target.value)}
                className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-0.5 text-xs text-[var(--n-11)]"
                aria-label="To date"
              />
            </div>
          ) : null}
        </div>

        {/* Sort */}
        <select
          value={filters.sort}
          onChange={(e) => updateFilter('sort', e.target.value as ContentSort)}
          className="ml-auto rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-xs text-[var(--n-11)]"
          aria-label="Sort order"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs text-[var(--n-8)] underline-offset-2 hover:text-[var(--n-11)] hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>

      {/* Bulk toast — fixed position bottom-right so the user sees it
          regardless of scroll position. Was previously inline at the
          top of the table, invisible when scrolling at the bulk
          toolbar. */}
      {bulkToast ? (
        <output
          aria-live="polite"
          className="fixed bottom-20 right-6 z-40 block max-w-sm rounded-[var(--r-2)] border border-[var(--success-9)] bg-[var(--success-3)] px-4 py-2 text-sm text-[var(--success-11)] shadow-[var(--shadow-2)]"
        >
          {bulkToast}
        </output>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Table */}
      {/* ------------------------------------------------------------------ */}
      {/* Dropped `overflow-x-auto` wrapper — its overflow:hidden side effect
          on the y-axis was clipping the per-row ⋯ action menu so clicks
          appeared to "do nothing" (menu opened but invisible). Page-level
          horizontal scroll handles narrow viewports just fine. */}
      <div className="mt-3">
        {contentQ.isPending ? (
          <div className="space-y-2 py-4" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-3)]"
              />
            ))}
          </div>
        ) : contentQ.isError ? (
          <div className="rounded-[var(--r-2)] border border-[var(--error-9)] bg-[var(--error-3)] p-4 text-sm text-[var(--error-11)]">
            Failed to load content.{' '}
            <button type="button" onClick={() => contentQ.refetch()} className="underline">
              Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] p-6 text-sm text-[var(--n-8)]">
            No content matches the current filters.{' '}
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-[var(--accent-11)] underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            ) : (
              'Submit some posts in your subreddit to start seeing data here.'
            )}
          </div>
        ) : (
          <>
            <table className="w-full border-collapse text-sm" aria-label="Content table">
              <thead>
                <tr className="border-b border-[var(--n-4)] text-left">
                  <th scope="col" className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all visible"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="accent-[var(--accent-9)]"
                    />
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 w-8 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]"
                  >
                    Type
                  </th>
                  <ColHeader
                    label="Title / Preview"
                    sortKey={null}
                    currentSort={filters.sort}
                    onSort={(s) => updateFilter('sort', s)}
                    className="min-w-[200px]"
                  />
                  <th
                    scope="col"
                    className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]"
                  >
                    Author
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]"
                  >
                    Intent
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]"
                  >
                    Sentiment
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]"
                  >
                    Status
                  </th>
                  <ColHeader
                    label="Age"
                    sortKey="createdAt_desc"
                    currentSort={filters.sort}
                    onSort={(s) => updateFilter('sort', s)}
                  />
                  {visibleCols.score ? (
                    <ColHeader
                      label="Score"
                      sortKey="sentimentScore_desc"
                      currentSort={filters.sort}
                      onSort={(s) => updateFilter('sort', s)}
                    />
                  ) : null}
                  <th
                    scope="col"
                    className="px-3 py-2 w-16 text-xs font-medium uppercase tracking-wide text-[var(--n-8)]"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <ContentRow
                    key={item.id}
                    item={item}
                    taxonomy={taxonomy}
                    selected={selected.has(item.id)}
                    onToggle={toggleOne}
                    onRespond={() => setRespondItem(item)}
                    onStatusChange={(status) => handleStatusChange(item.id, status)}
                    showScore={visibleCols.score}
                    currentSort={filters.sort}
                    onSort={(s) => updateFilter('sort', s)}
                    onToast={(msg) => {
                      setBulkToast(msg);
                      setTimeout(() => setBulkToast(null), 3500);
                    }}
                  />
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-[var(--n-4)] px-3 py-3 text-xs text-[var(--n-8)]">
              <span>
                Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-1 text-xs text-[var(--n-11)] disabled:opacity-50 hover:bg-[var(--n-3)]"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={offset + LIMIT >= total}
                  onClick={() => setOffset(offset + LIMIT)}
                  className="rounded-[var(--r-1)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-1 text-xs text-[var(--n-11)] disabled:opacity-50 hover:bg-[var(--n-3)]"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bulk toolbar (sticky bottom) */}
      {/* ------------------------------------------------------------------ */}
      <BulkToolbar
        selected={selected}
        onClear={() => setSelected(new Set())}
        onSelectAll={() => setSelected(new Set(items.map((i) => i.id)))}
        taxonomy={taxonomy}
        onBulkStatus={bulkSetStatus}
        onBulkTag={bulkTag}
        busy={bulkBusy}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Respond drawer */}
      {/* ------------------------------------------------------------------ */}
      {respondItem ? (
        <RespondDrawer
          item={respondItem}
          taxonomy={taxonomy}
          onClose={() => setRespondItem(null)}
        />
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Individual table row
// ---------------------------------------------------------------------------

interface ContentRowProps {
  item: ContentItem;
  taxonomy: TaxonomyNode[];
  selected: boolean;
  onToggle: (id: string, e: React.MouseEvent) => void;
  onRespond: () => void;
  onStatusChange: (status: PostStatus) => void;
  showScore: boolean;
  currentSort: ContentSort;
  onSort: (s: ContentSort) => void;
  onToast: (msg: string) => void;
}

function ContentRow({
  item,
  taxonomy,
  selected,
  onToggle,
  onRespond,
  onStatusChange,
  showScore,
  onToast,
}: ContentRowProps) {
  const [expanded, setExpanded] = useState(false);

  const driverLabel = item.driverId ? formatDriverPath(item.driverId, taxonomy) : null;

  return (
    <tr
      className={`border-b border-[var(--n-4)]/50 transition-colors ${
        selected ? 'bg-[var(--accent-3)]' : 'hover:bg-[var(--n-3)]'
      }`}
      onContextMenu={(e) => {
        // Right-click selects the row (without losing other selection)
        e.preventDefault();
        onToggle(item.id, { ...e, metaKey: true } as React.MouseEvent);
      }}
    >
      {/* Checkbox */}
      <td className="px-3 py-2.5 w-8">
        <input
          type="checkbox"
          aria-label={`Select: ${item.title}`}
          checked={selected}
          onChange={(e) => onToggle(item.id, e as unknown as React.MouseEvent)}
          className="accent-[var(--accent-9)]"
        />
      </td>

      {/* Type icon */}
      <td className="px-3 py-2.5 text-center text-sm text-[var(--n-8)]">
        {item.type === 'post' ? (
          <span title="Post" aria-hidden="true">
            📄
          </span>
        ) : (
          <span title="Comment" aria-hidden="true">
            💬
          </span>
        )}
      </td>

      {/* Title / body preview */}
      <td className="px-3 py-2.5 max-w-xs">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="block w-full text-left"
          aria-expanded={expanded}
        >
          <span className="block truncate text-sm font-medium text-[var(--n-11)] hover:text-[var(--accent-11)]">
            {item.title || '(no title)'}
          </span>
          {expanded && item.body ? (
            <span className="mt-1 block text-xs text-[var(--n-8)] whitespace-pre-wrap">
              {item.body.slice(0, 400)}
              {item.body.length > 400 ? '…' : ''}
            </span>
          ) : null}
        </button>
      </td>

      {/* Author */}
      <td className="px-3 py-2.5 text-xs text-[var(--n-11)] whitespace-nowrap">
        u/{item.authorName}
      </td>

      {/* Intent */}
      <td className="px-3 py-2.5 text-xs">
        {driverLabel ? (
          <span className="text-[var(--accent-11)]">{driverLabel}</span>
        ) : (
          <span className="text-[var(--n-6)]">—</span>
        )}
      </td>

      {/* Sentiment */}
      <td className="px-3 py-2.5">
        <SentimentChip label={item.sentimentLabel} />
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        <StatusChip status={item.status} />
      </td>

      {/* Age */}
      <td className="px-3 py-2.5 text-xs text-[var(--n-8)] whitespace-nowrap">
        <span title={formatDate(item.createdAt)}>{relativeTime(item.createdAt)}</span>
      </td>

      {/* Score (optional) */}
      {showScore ? (
        <td className="px-3 py-2.5 text-xs text-[var(--n-8)]">
          {item.sentimentScore != null ? item.sentimentScore.toFixed(2) : '—'}
        </td>
      ) : null}

      {/* Actions */}
      <td className="px-3 py-2.5">
        <RowActions
          item={item}
          onRespond={onRespond}
          onStatusChange={onStatusChange}
          onToast={onToast}
        />
      </td>
    </tr>
  );
}
