/**
 * Data Lab tab — inject synthetic posts/comments through the real dispatcher
 * pipeline so every module (drivers, sentiment, crisis, themes…) processes
 * them identically to real Reddit events.
 *
 * Sections:
 *  1. Simulate a post
 *  2. Simulate a comment (with last-5 quick-pick chips)
 *  3. Run a scenario (card grid)
 *  4. Clear lab data (danger zone)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  msg: string;
}

let _seq = 0;
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const add = (type: Toast['type'], msg: string) => {
    const id = ++_seq;
    setToasts((prev) => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };
  return { toasts, toast: add };
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
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
              : t.type === 'info'
                ? 'border-sky-700 bg-sky-950 text-sky-100'
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
// Section wrapper (mirrors Settings.tsx)
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  children,
  danger,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`rounded-lg border p-6 ${
        danger ? 'border-rose-800 bg-rose-950/20' : 'border-neutral-800 bg-neutral-900'
      }`}
    >
      <h3 className={`mb-1 text-sm font-semibold ${danger ? 'text-rose-300' : 'text-neutral-100'}`}>
        {title}
      </h3>
      {description ? <p className="mb-4 text-xs text-neutral-400">{description}</p> : null}
      {children}
    </section>
  );
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
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
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none disabled:opacity-50"
    />
  );
}

function Textarea({
  id,
  value,
  onChange,
  placeholder,
  rows,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder={placeholder}
      rows={rows ?? 3}
      disabled={disabled}
      className="w-full resize-y rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none disabled:opacity-50"
    />
  );
}

// ---------------------------------------------------------------------------
// Section 1: Simulate a post
// ---------------------------------------------------------------------------

function SimulatePostSection({
  taxonomy,
  toast,
  onPosted,
}: {
  taxonomy: Array<{ id: string; label: string }>;
  toast: (type: Toast['type'], msg: string) => void;
  onPosted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('lab_test_user_1');
  const [driverOverride, setDriverOverride] = useState('');
  const [sentimentOverride, setSentimentOverride] = useState<
    '' | 'positive' | 'neutral' | 'negative'
  >('');

  const mut = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof api.lab.simulatePost>[0] = {
        title,
        body,
        authorName: author,
      };
      if (driverOverride) payload.driverOverride = driverOverride;
      if (sentimentOverride)
        payload.sentimentOverride = sentimentOverride as 'positive' | 'neutral' | 'negative';
      return api.lab.simulatePost(payload);
    },
    onSuccess: (data) => {
      toast('success', `Post created: ${data.postId}`);
      setTitle('');
      setBody('');
      onPosted();
    },
    onError: (err: Error) => toast('error', err.message),
  });

  return (
    <Section
      title="Simulate a post"
      description="Creates a synthetic post that flows through all pipelines (drivers, sentiment, crisis…) exactly like a real Reddit post."
    >
      <div className="grid gap-3">
        <div>
          <Label htmlFor="lab-title">Title</Label>
          <Input
            id="lab-title"
            value={title}
            onChange={setTitle}
            placeholder="e.g. App crashes on startup"
            disabled={mut.isPending}
          />
        </div>

        <div>
          <Label htmlFor="lab-body">Body</Label>
          <Textarea
            id="lab-body"
            value={body}
            onChange={setBody}
            placeholder="Post body (optional)"
            rows={3}
            disabled={mut.isPending}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label htmlFor="lab-author">Author</Label>
            <Input
              id="lab-author"
              value={author}
              onChange={setAuthor}
              placeholder="lab_test_user_1"
              disabled={mut.isPending}
            />
          </div>

          <div>
            <Label htmlFor="lab-driver">Driver override</Label>
            <select
              id="lab-driver"
              value={driverOverride}
              onChange={(e) => setDriverOverride(e.currentTarget.value)}
              disabled={mut.isPending}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">Auto (let pipeline decide)</option>
              {taxonomy.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="lab-sentiment">Sentiment override</Label>
            <select
              id="lab-sentiment"
              value={sentimentOverride}
              onChange={(e) =>
                setSentimentOverride(
                  e.currentTarget.value as '' | 'positive' | 'neutral' | 'negative',
                )
              }
              disabled={mut.isPending}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none disabled:opacity-50"
            >
              <option value="">Auto</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => mut.mutate()}
            disabled={!title.trim() || mut.isPending}
            data-testid="lab-simulate-post-btn"
            className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
          >
            {mut.isPending ? 'Simulating…' : 'Simulate post'}
          </button>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section 2: Simulate a comment
// ---------------------------------------------------------------------------

function SimulateCommentSection({
  toast,
  recentPosts,
}: {
  toast: (type: Toast['type'], msg: string) => void;
  recentPosts: Array<{ postId: string; title: string }>;
}) {
  const [postId, setPostId] = useState('');
  const [body, setBody] = useState('');
  const [author, setAuthor] = useState('lab_test_user_1');

  const mut = useMutation({
    mutationFn: () => api.lab.simulateComment({ postId, body, authorName: author }),
    onSuccess: (data) => {
      toast('success', `Comment created: ${data.commentId}`);
      setBody('');
    },
    onError: (err: Error) => toast('error', err.message),
  });

  return (
    <Section
      title="Simulate a comment"
      description="Adds a synthetic comment to an existing (real or simulated) post."
    >
      <div className="mb-3">
        <p className="mb-2 text-xs text-neutral-400">Recent simulated posts — click to select:</p>
        <div className="flex flex-wrap gap-2">
          {recentPosts.length === 0 ? (
            <span className="text-xs text-neutral-500">No simulated posts yet.</span>
          ) : (
            recentPosts.map((p) => (
              <button
                key={p.postId}
                type="button"
                onClick={() => setPostId(p.postId)}
                data-testid={`lab-recent-post-chip-${p.postId}`}
                className={`max-w-[200px] truncate rounded-full border px-3 py-1 text-xs transition ${
                  postId === p.postId
                    ? 'border-orange-500 bg-orange-500/20 text-orange-200'
                    : 'border-neutral-700 text-neutral-300 hover:border-orange-500'
                }`}
                title={p.postId}
              >
                {p.title || p.postId}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="grid gap-3">
        <div>
          <Label htmlFor="lab-cmt-postid">Post ID</Label>
          <Input
            id="lab-cmt-postid"
            value={postId}
            onChange={setPostId}
            placeholder="t3_lab_… or any real post id"
            disabled={mut.isPending}
          />
        </div>

        <div>
          <Label htmlFor="lab-cmt-body">Comment body</Label>
          <Textarea
            id="lab-cmt-body"
            value={body}
            onChange={setBody}
            placeholder="What the user says…"
            rows={3}
            disabled={mut.isPending}
          />
        </div>

        <div>
          <Label htmlFor="lab-cmt-author">Author</Label>
          <Input
            id="lab-cmt-author"
            value={author}
            onChange={setAuthor}
            placeholder="lab_test_user_1"
            disabled={mut.isPending}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => mut.mutate()}
            disabled={!postId.trim() || !body.trim() || mut.isPending}
            data-testid="lab-simulate-comment-btn"
            className="rounded-md border border-orange-600 bg-orange-600/20 px-4 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-600/40 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"
          >
            {mut.isPending ? 'Simulating…' : 'Simulate comment'}
          </button>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section 3: Scenarios
// ---------------------------------------------------------------------------

interface ScenarioCard {
  name: string;
  description: string;
  status: {
    state: 'idle' | 'running' | 'done' | 'error';
    lastRunAt: number | null;
    error?: string;
  };
}

function ScenarioStatusBadge({ state }: { state: ScenarioCard['status']['state'] }) {
  const styles = {
    idle: 'border-neutral-700 text-neutral-500',
    running: 'border-sky-700 text-sky-300 animate-pulse',
    done: 'border-emerald-700 text-emerald-300',
    error: 'border-rose-700 text-rose-300',
  };
  const labels = { idle: 'Not run', running: 'Running…', done: 'Done', error: 'Error' };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

function ScenarioProgress({ name, onDone }: { name: string; onDone: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['lab-scenario-status', name],
    queryFn: () => api.lab.scenarioStatus(name),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  });

  const prevState = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    if (prevState.current === 'running' && (data.state === 'done' || data.state === 'error')) {
      void qc.invalidateQueries({ queryKey: ['lab-scenarios'] });
      onDone();
    }
    prevState.current = data.state;
  }, [data, qc, onDone]);

  if (!data || data.state === 'idle') return null;

  const pct = data.state === 'running' ? 60 : 100;
  return (
    <div className="mt-2">
      <div className="h-1 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-1 rounded-full transition-all duration-1000 ${
            data.state === 'error' ? 'bg-rose-500' : 'bg-orange-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {data.state === 'error' && data.error ? (
        <p className="mt-1 text-[10px] text-rose-400">{data.error}</p>
      ) : null}
    </div>
  );
}

function ScenariosSection({ toast }: { toast: (type: Toast['type'], msg: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['lab-scenarios'],
    queryFn: () => api.lab.scenarios(),
  });

  const [runningName, setRunningName] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (name: string) => api.lab.runScenario(name),
    onSuccess: (_data, name) => {
      toast('info', `Scenario "${name}" started`);
      setRunningName(name);
      void qc.invalidateQueries({ queryKey: ['lab-scenarios'] });
    },
    onError: (err: Error) => toast('error', err.message),
  });

  const scenarios: ScenarioCard[] = data?.scenarios ?? [];

  return (
    <Section
      title="Run a scenario"
      description="Pre-built simulation packs — inject realistic data patterns in one click."
    >
      {isLoading ? (
        <p className="text-xs text-neutral-500">Loading scenarios…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scenarios.map((s) => (
            <div
              key={s.name}
              className="flex flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-4"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-neutral-100">{s.name}</span>
                <ScenarioStatusBadge state={s.status.state} />
              </div>
              <p className="mb-3 flex-1 text-xs text-neutral-400">{s.description}</p>
              {s.status.lastRunAt ? (
                <p className="mb-2 text-[10px] text-neutral-600">
                  Last run:{' '}
                  {new Date(s.status.lastRunAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              ) : null}

              {runningName === s.name ? (
                <ScenarioProgress
                  name={s.name}
                  onDone={() => {
                    setRunningName(null);
                    toast('success', `Scenario "${s.name}" complete`);
                  }}
                />
              ) : null}

              <button
                type="button"
                onClick={() => mut.mutate(s.name)}
                disabled={mut.isPending || s.status.state === 'running'}
                data-testid={`lab-scenario-run-${s.name}`}
                className="mt-3 rounded-md border border-orange-700 bg-orange-700/20 px-3 py-1 text-xs font-medium text-orange-200 transition hover:bg-orange-700/40 disabled:opacity-50"
              >
                {s.status.state === 'running' ? 'Running…' : 'Run'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section 4: Clear lab data
// ---------------------------------------------------------------------------

function ClearSection({ toast }: { toast: (type: Toast['type'], msg: string) => void }) {
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const mut = useMutation({
    mutationFn: () => api.lab.clear(),
    onSuccess: (data) => {
      toast('success', `Cleared ${data.deleted} simulated post(s) and derived state.`);
      setConfirmOpen(false);
      setConfirmText('');
      void qc.invalidateQueries({ queryKey: ['lab-recent-posts'] });
      void qc.invalidateQueries({ queryKey: ['lab-scenarios'] });
    },
    onError: (err: Error) => toast('error', err.message),
  });

  return (
    <Section
      title="Clear lab data"
      description="Permanently deletes all simulated posts, comments, tags, and sentiment scores from Redis. Real posts are unaffected."
      danger
    >
      {!confirmOpen ? (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="rounded-md border border-rose-700 bg-rose-700/20 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-700/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-500"
        >
          Delete all simulated posts
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-rose-200">
            Type <strong>DELETE</strong> to confirm deletion of all lab data.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.currentTarget.value)}
            placeholder="DELETE"
            className="w-48 rounded-md border border-rose-700 bg-rose-950/40 px-3 py-2 text-sm text-rose-100 placeholder:text-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-500"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => mut.mutate()}
              disabled={confirmText !== 'DELETE' || mut.isPending}
              data-testid="lab-clear-confirm-btn"
              className="rounded-md border border-rose-600 bg-rose-600/30 px-4 py-1.5 text-sm font-medium text-rose-200 transition hover:bg-rose-600/50 disabled:opacity-50"
            >
              {mut.isPending ? 'Clearing…' : 'Confirm delete'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                setConfirmText('');
              }}
              className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm text-neutral-300 transition hover:border-neutral-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Lab root
// ---------------------------------------------------------------------------

export function Lab() {
  const { toasts, toast } = useToast();
  const qc = useQueryClient();

  const { data: taxonomyData } = useQuery({
    queryKey: ['taxonomy'],
    queryFn: () => api.taxonomy(),
  });

  const { data: recentPostsData, refetch: refetchRecent } = useQuery({
    queryKey: ['lab-recent-posts'],
    queryFn: () => api.lab.recentPosts(),
  });

  const taxonomy = taxonomyData?.taxonomy ?? [];
  const recentPosts = recentPostsData?.posts ?? [];

  const handlePosted = () => {
    void refetchRecent();
    void qc.invalidateQueries({ queryKey: ['recent-posts'] });
  };

  return (
    <div className="space-y-6" data-testid="lab-tab">
      <ToastContainer toasts={toasts} />

      <div>
        <h2 className="text-xl font-semibold text-neutral-100">Data Lab</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Inject synthetic Reddit events through the full RedLattice pipeline — no real API access
          needed. Simulated posts are prefixed <code className="text-orange-300">lab_</code> and can
          be cleared at any time.
        </p>
      </div>

      <SimulatePostSection taxonomy={taxonomy} toast={toast} onPosted={handlePosted} />
      <SimulateCommentSection toast={toast} recentPosts={recentPosts} />
      <ScenariosSection toast={toast} />
      <ClearSection toast={toast} />
    </div>
  );
}
