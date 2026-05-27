/**
 * Typed fetch helpers for the dashboard. All requests go same-origin to the
 * Hono server mounted at `/api/*`.
 */

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'tag-issue'
  | 'mark-resolved'
  | 'mark-open'
  | 'mark-agent'
  | 'unmark-agent'
  | 'settings-update'
  | 'incident-resolve'
  | 'theme-regenerate'
  | 'bulk-status'
  | 'mod-approve'
  | 'mod-remove'
  | 'mod-spam'
  | 'mod-lock'
  | 'mod-distinguish'
  | 'mod-reply';

export interface AuditEntry {
  ts: number;
  actor: string | null;
  action: AuditAction;
  target: string | null;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export interface SavedView {
  id: string;
  name: string;
  tab: 'inbox' | 'drivers';
  params: Record<string, string>;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Dashboard summary types
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  today: string;
  month: string;
  drivers: {
    today: { date: string; totalPosts: number; counts: Record<string, number> } | null;
    topDriverId: string | null;
    topDriverLabel: string | null;
    topDriverCount: number;
  };
  sentiment: {
    date: string;
    positive: number;
    neutral: number;
    negative: number;
    total: number;
    averageScore: number;
  } | null;
  llm: {
    monthCents: number;
    monthTokensIn: number;
    monthTokensOut: number;
  };
}

export interface DriverVolume {
  from: string;
  to: string;
  series: Array<{ date: string; totalPosts: number; counts: Record<string, number> }>;
}

export interface TaxonomyNode {
  id: string;
  label: string;
  color?: string;
  description?: string;
  keywords?: string[];
  /** null or missing = root driver. Non-null = child of named parent. */
  parentId?: string | null;
}

export interface Agent {
  username: string;
  role: 'verified' | 'lead' | 'removed';
  verifiedAt: number;
  verifiedBy: string;
}

export interface SentimentRollup {
  date: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  averageScore: number;
}

export type PostStatus = 'open' | 'in-progress' | 'responded' | 'resolved';

export interface DriverPost {
  postId: string;
  title: string;
  authorName: string;
  url: string;
  createdAt: number;
  driverId: string;
  taggedBy?: 'manual' | 'auto' | 'ai' | null;
  confidence?: number | null;
  reasoning?: string | null;
  status: PostStatus;
}

export interface RecentPost {
  postId: string;
  title: string;
  authorName: string;
  url: string;
  createdAt: number;
  driverId: string | null;
  taggedBy: 'manual' | 'auto' | 'ai' | null;
  confidence: number | null;
  reasoning: string | null;
  status: PostStatus | null;
  sentimentLabel: 'positive' | 'neutral' | 'negative' | null;
  sentimentScore: number | null;
  sentimentScoredBy: 'lexicon' | 'ai' | null;
}

export type CustomPipelineAction =
  | { type: 'tag-driver'; driverId: string }
  | { type: 'send-modmail'; bodyTemplate: string }
  | { type: 'set-status'; status: 'open' | 'in-progress' | 'resolved' };

export type PipelineKind = 'categorical' | 'ordinal' | 'cluster' | 'scalar' | 'boolean';
export type PipelineTrigger = 'post-create' | 'comment-create' | 'status-change' | 'scheduled';
export type PipelineOutputSchema =
  | 'single-label'
  | 'label-confidence'
  | 'boolean'
  | 'scalar'
  | 'cluster';
export type PipelineSource = 'builtin' | 'custom';

export interface PipelineRecord {
  id: string;
  name: string;
  description?: string;
  kind: PipelineKind;
  trigger: PipelineTrigger;
  systemPrompt?: string;
  userPrompt?: string;
  outputSchema: PipelineOutputSchema;
  source: PipelineSource;
  enabled: boolean;
  labels?: string[];
  order?: number;
  logic?: string;
  moduleKey?: string;
  alpha?: boolean;
  /** Which UI surfaces render this pipeline's output (mirrors shared Pipeline.showIn) */
  showIn?: Array<'insights' | 'pipelines' | 'incidents' | 'team' | 'audit'>;
}

// ---------------------------------------------------------------------------
// Pipeline instance + template types (new model)
// ---------------------------------------------------------------------------

export type PipelineInstanceSource = 'preinstalled' | 'installed' | 'scratch';
export type PipelineShowIn = 'insights' | 'incidents' | 'team' | 'audit';

export interface PipelineInstanceConfig {
  trigger: PipelineTrigger;
  systemPrompt: string;
  userPrompt: string;
  outputSchema: PipelineOutputSchema;
  labels?: string[];
  threshold?: number;
}

export interface PipelineInstance {
  id: string;
  templateId: string;
  name: string;
  description?: string;
  enabled: boolean;
  config: PipelineInstanceConfig;
  source: PipelineInstanceSource;
  createdAt: number;
  updatedAt: number;
  showIn: PipelineShowIn[];
  order?: number;
}

export type PipelineCategory = 'tagging' | 'scoring' | 'flagging' | 'clustering' | 'extraction';

export interface PipelineTemplateRecord {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  category: PipelineCategory;
  kind: PipelineKind;
  iconEmoji?: string;
  defaultConfig: PipelineInstanceConfig;
  configurable: string[];
  example?: { input: string; output: string };
  moduleKey?: string;
  logic?: string;
  alpha?: boolean;
}

export interface TagDistributionEntry {
  value: string;
  count: number;
}

export interface CustomPipelineSummary {
  id: string;
  name: string;
  description: string;
  kind: PipelineKind;
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: PipelineOutputSchema;
  labels?: string[];
  action: CustomPipelineAction;
  createdAt: number;
  updatedAt: number;
}

export interface CustomPipelineBody {
  name: string;
  description: string;
  kind: PipelineKind;
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: PipelineOutputSchema;
  labels?: string[];
  action: CustomPipelineAction;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export type WebhookFormat = 'slack' | 'discord' | 'pagerduty' | 'generic';

export type WebhookEventKind =
  | 'post-tag'
  | 'sentiment-spike'
  | 'incident-open'
  | 'incident-resolve'
  | 'theme-regenerate'
  | 'custom-rule-fire'
  | '*';

export interface Webhook {
  id: string;
  name: string;
  targetUrl: string;
  events: string[];
  enabled: boolean;
  secret: string;
  format: WebhookFormat;
  createdAt: number;
}

export interface WebhookDelivery {
  eventKind: string;
  statusCode: number | null;
  success: boolean;
  responseExcerpt: string;
  attemptedAt: number;
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** Guarantee a value is an array; otherwise return []. */
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ---------------------------------------------------------------------------
// Pulse stats — 7-day sentiment rollup + active incidents for the Blocks view
// ---------------------------------------------------------------------------

export interface PulseSentimentDay {
  date: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  averageScore: number;
}

export interface PulseStats {
  today: string;
  postsToday: number;
  topDriver: {
    id: string | null;
    label: string | null;
    count: number;
  };
  negativeShare: number | null;
  negativeShareTrend: 'up' | 'down' | 'flat';
  activeIncidents: number;
  sentimentTrend: PulseSentimentDay[];
}

export const api = {
  health: () => getJson<{ ok: boolean; ts: number }>('/api/health'),
  summary: () => getJson<DashboardSummary>('/api/dashboard/summary'),
  pulseStats: () => getJson<PulseStats>('/api/dashboard/pulse-stats'),
  recentPosts: async (limit = 25) => {
    const raw = await getJson<{ items: RecentPost[]; count: number }>(
      `/api/dashboard/recent-posts?limit=${limit}`,
    );
    return { ...raw, items: arr<RecentPost>(raw.items) };
  },
  taxonomy: async () => {
    const raw = await getJson<{ taxonomy: TaxonomyNode[] }>('/api/drivers/taxonomy');
    return { taxonomy: arr<TaxonomyNode>(raw.taxonomy) };
  },
  driverVolume: async () => {
    const raw = await getJson<DriverVolume>('/api/drivers/volume');
    return { ...raw, series: arr<DriverVolume['series'][number]>(raw.series) };
  },
  triageQueue: async (opts: { limit?: number; status?: PostStatus | 'all' } = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.status) q.set('status', opts.status);
    const raw = await getJson<{
      items: Array<RecentPost & { priority: number; status: PostStatus | null }>;
      count: number;
      generatedAt: number;
    }>(`/api/triage/queue?${q.toString()}`);
    return { ...raw, items: arr<(typeof raw.items)[number]>(raw.items) };
  },
  userHistory: (username: string, limit = 20) =>
    getJson<{
      username: string;
      items: Array<{
        postId: string;
        title: string;
        authorName: string;
        url: string;
        createdAt: number;
        driverId: string | null;
        status: PostStatus | null;
        sentimentLabel: 'positive' | 'neutral' | 'negative' | null;
        sentimentScore: number | null;
      }>;
      aggregate: {
        totalPosts: number;
        totalScored: number;
        averageScore: number | null;
        negativeShare: number | null;
        topDrivers: Array<{ id: string; count: number }>;
      };
    }>(`/api/users/${encodeURIComponent(username)}/history?limit=${limit}`),
  postThread: (postId: string) =>
    getJson<{
      post: {
        postId: string;
        title: string;
        authorName: string;
        url: string;
        createdAt: number;
        driverId: string | null;
        taggedBy: 'manual' | 'auto' | 'ai' | null;
        status: PostStatus | null;
        sentimentLabel: 'positive' | 'neutral' | 'negative' | null;
        sentimentScore: number | null;
      } | null;
      comments: Array<{
        commentId: string;
        parentId: string | null;
        authorName: string;
        body: string;
        createdAt: number;
        isAgent: boolean;
        agentSource: 'distinguished' | 'mod-list' | 'flair' | 'record' | null;
        sentimentLabel: 'positive' | 'neutral' | 'negative' | null;
        sentimentScore: number | null;
        sentimentScoredBy: 'lexicon' | 'ai' | null;
      }>;
      heat: { sampleSize: number; negativeShare: number; isHot: boolean };
    }>(`/api/posts/${encodeURIComponent(postId)}/thread`),
  driverPosts: async (driverId: string, opts: { limit?: number; status?: PostStatus } = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.status) q.set('status', opts.status);
    const raw = await getJson<{ driverId: string; posts: DriverPost[]; count: number }>(
      `/api/drivers/${encodeURIComponent(driverId)}/posts?${q.toString()}`,
    );
    return { ...raw, posts: arr<DriverPost>(raw.posts) };
  },
  draftReply: async (postId: string) => {
    const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/draft-reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const err = new Error(
        (body as { hint?: string; error?: string }).hint ??
          (body as { error?: string }).error ??
          `HTTP ${r.status}`,
      );
      throw err;
    }
    return (await r.json()) as {
      postId: string;
      cached: boolean;
      tokensIn: number;
      tokensOut: number;
      costCents: number;
      candidates: Array<{
        tone: 'empathetic' | 'direct' | 'concise' | 'investigative';
        rationale: string;
        reply: string;
      }>;
    };
  },
  setPostStatus: async (postId: string, status: PostStatus): Promise<void> => {
    const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error(`status update failed: HTTP ${r.status}`);
  },
  agents: async () => {
    const raw = await getJson<{ agents: Agent[] }>('/api/agents');
    return { agents: arr<Agent>(raw.agents) };
  },
  agentLeaderboard: async (days = 30) => {
    type Row = {
      username: string;
      replies: number;
      firstResponses: number;
      latencyMsSum: number;
      latencyCount: number;
      sentBeforeSum: number;
      sentAfterSum: number;
      sentDeltaN: number;
      avgLatencyMs: number | null;
      avgSentimentDelta: number | null;
      firstResponseRate: number | null;
    };
    const raw = await getJson<{ days: number; count: number; rows: Row[] }>(
      `/api/agents/leaderboard?days=${days}`,
    );
    return { ...raw, rows: arr<Row>(raw.rows) };
  },
  incidents: async (status: 'active' | 'resolved' | 'all' = 'active') => {
    type Inc = {
      id: string;
      startedAt: number;
      reason: string;
      postIds: string[];
      commentIds: string[];
      status: 'open' | 'resolved';
      resolvedAt?: number;
      resolvedBy?: string;
    };
    const raw = await getJson<{ count: number; incidents: Inc[] }>(
      `/api/incidents?status=${status}`,
    );
    return {
      ...raw,
      incidents: arr<Inc>(raw.incidents).map((i) => ({
        ...i,
        postIds: arr<string>(i.postIds),
        commentIds: arr<string>(i.commentIds),
      })),
    };
  },
  resolveIncident: async (id: string): Promise<void> => {
    const r = await fetch(`/api/incidents/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
    if (!r.ok) throw new Error(`resolve failed: HTTP ${r.status}`);
  },
  themes: async () => {
    const raw = await getJson<{
      generatedAt: number | null;
      themes: Array<{
        name: string;
        summary: string;
        samplePostIds: string[];
        postCount: number;
        avgSentiment: number;
      }> | null;
    }>('/api/themes/latest');
    return {
      generatedAt: raw.generatedAt,
      themes: arr<{
        name: string;
        summary: string;
        samplePostIds: string[];
        postCount: number;
        avgSentiment: number;
      }>(raw.themes).map((t) => ({ ...t, samplePostIds: arr<string>(t.samplePostIds) })),
    };
  },
  regenerateThemes: async () => {
    const r = await fetch('/api/themes/regenerate', { method: 'POST' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(
        (body as { hint?: string; error?: string }).hint ??
          (body as { error?: string }).error ??
          `HTTP ${r.status}`,
      );
    }
    const raw = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    // The server now returns 200 with a `hint` field when there's no data to
    // cluster (rather than 503). Throw a friendly error so the UI surfaces it
    // via the existing error path.
    if (raw.ok === false && typeof raw.hint === 'string') {
      throw new Error(raw.hint);
    }
    return {
      generatedAt: (raw as { generatedAt?: number | null }).generatedAt ?? null,
      themes:
        (
          raw as {
            themes?: Array<{
              name: string;
              summary: string;
              samplePostIds: string[];
              postCount: number;
              avgSentiment: number;
            }> | null;
          }
        ).themes ?? [],
    } satisfies Awaited<ReturnType<typeof api.themes>>;
  },
  sentimentRollup: async () => {
    const raw = await getJson<{ from: string; to: string; series: SentimentRollup[] }>(
      '/api/sentiment/rollup',
    );
    return { ...raw, series: arr<SentimentRollup>(raw.series) };
  },

  sentimentPosts: async (
    label: 'positive' | 'neutral' | 'negative',
    opts: { days?: number; limit?: number } = {},
  ) => {
    const q = new URLSearchParams();
    q.set('label', label);
    if (opts.days) q.set('days', String(opts.days));
    if (opts.limit) q.set('limit', String(opts.limit));
    const raw = await getJson<{ label: string; count: number; posts: RecentPost[] }>(
      `/api/sentiment/posts?${q.toString()}`,
    );
    return { ...raw, posts: arr<RecentPost>(raw.posts) };
  },
  audit: async (opts: { limit?: number; action?: AuditAction; actor?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.action) q.set('action', opts.action);
    if (opts.actor) q.set('actor', opts.actor);
    const qs = q.toString();
    const raw = await getJson<{ count: number; entries: AuditEntry[] }>(
      `/api/audit${qs ? `?${qs}` : ''}`,
    );
    return { ...raw, entries: arr<AuditEntry>(raw.entries) };
  },
  bulkSetStatus: async (
    postIds: string[],
    status: PostStatus,
  ): Promise<{ ok: boolean; succeeded: number; failed: number }> => {
    // Server caps at 50 — chunk if needed.
    const CHUNK = 50;
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < postIds.length; i += CHUNK) {
      const chunk = postIds.slice(i, i + CHUNK);
      const r = await fetch('/api/posts/bulk-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postIds: chunk, status }),
      });
      if (r.ok) {
        const body = (await r.json()) as { succeeded: number; failed: number };
        succeeded += body.succeeded;
        failed += body.failed;
      } else {
        failed += chunk.length;
      }
    }
    return { ok: failed === 0, succeeded, failed };
  },
  views: {
    list: () => getJson<{ views: SavedView[] }>('/api/views'),
    save: async (view: {
      name: string;
      tab: 'inbox' | 'drivers';
      params: Record<string, string>;
    }) => {
      const r = await fetch('/api/views', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(view),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as SavedView;
    },
    delete: async (id: string) => {
      const r = await fetch(`/api/views/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`delete view failed: HTTP ${r.status}`);
    },
  },
  ai: {
    status: () =>
      getJson<{
        effectiveModel: string;
        isFallback: boolean;
        originalSlug: string | null;
        defaultModel: string;
        catalog: Array<{
          slug: string;
          label: string;
          provider: string;
          tier: string;
          pricePer1kTaggingCalls: number;
          supportsStructuredOutput: boolean;
          notes?: string;
        }>;
      }>('/api/ai/status'),
    validateModel: async (slug: string) => {
      const r = await fetch('/api/ai/validate-model', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      return (await r.json()) as {
        valid: boolean;
        supportsStructuredOutput: boolean;
        inCatalog?: boolean;
        estimatedCostCents?: number | null;
        error?: string;
        hint?: string;
      };
    },
    clearFallback: async () => {
      const r = await fetch('/api/ai/clear-fallback', { method: 'POST' });
      if (!r.ok) throw new Error(`clear-fallback failed: HTTP ${r.status}`);
      return (await r.json()) as { ok: boolean; slug?: string; message?: string };
    },
    setKey: async (key: string): Promise<{ ok: boolean }> => {
      const r = await fetch('/api/ai/set-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { ok: boolean };
    },
  },
  adminDebug: () =>
    getJson<{
      server: { ts: number; uptimeSec: number };
      modules: string[];
      llm: { monthCents: number; tokensIn: number; tokensOut: number; capCents: number };
      taxonomy: string[];
      recentPostIds: string[];
      dashboardPostId: string | null;
      subreddit: string | null;
      username: string | null;
    }>('/api/admin/debug'),
  settings: {
    get: () =>
      getJson<
        Record<string, unknown> & { openrouterKeyConfigured: boolean; 'brand-accent'?: string }
      >('/api/settings'),
    put: async (body: Record<string, unknown>) => {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as Record<string, unknown> & {
        openrouterKeyConfigured: boolean;
      };
    },
    testDraft: async () => {
      const r = await fetch('/api/settings/test-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(
          (err as { hint?: string; error?: string }).hint ??
            (err as { error?: string }).error ??
            `HTTP ${r.status}`,
        );
      }
      return (await r.json()) as {
        postId: string;
        postTitle: string;
        candidates: Array<{
          tone: 'empathetic' | 'direct' | 'concise' | 'investigative';
          rationale: string;
          reply: string;
        }>;
        tokensIn: number;
        tokensOut: number;
        costCents: number;
        cached: boolean;
      };
    },
    resetBrand: async (): Promise<{ ok: boolean; brandName: string; brandVoice: string }> => {
      const r = await fetch('/api/settings/reset-brand', { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { ok: boolean; brandName: string; brandVoice: string };
    },
  },
  pipelines: {
    getBuiltin: (id: string) =>
      getJson<{
        id: string;
        overrides: {
          systemPrompt?: string;
          userPrompt?: string;
          thresholds?: Record<string, number>;
          enabled?: boolean;
        };
      }>(`/api/pipelines/builtin/${encodeURIComponent(id)}`),

    putBuiltin: async (
      id: string,
      patch: {
        systemPrompt?: string;
        userPrompt?: string;
        thresholds?: Record<string, number>;
        enabled?: boolean;
      },
    ) => {
      const r = await fetch(`/api/pipelines/builtin/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { id: string; overrides: typeof patch };
    },

    testBuiltin: async (id: string, sampleInput: string) => {
      const r = await fetch(`/api/pipelines/builtin/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sampleInput }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as {
        id: string;
        output: { output: string; label?: string };
        tokensIn: number;
        tokensOut: number;
        costCents: number;
      };
    },

    listCustom: async () => {
      const raw = await getJson<{
        count: number;
        pipelines: CustomPipelineSummary[];
      }>('/api/pipelines/custom');
      return { ...raw, pipelines: arr<CustomPipelineSummary>(raw.pipelines) };
    },

    createCustom: async (body: CustomPipelineBody) => {
      const r = await fetch('/api/pipelines/custom', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { pipeline: CustomPipelineSummary };
    },

    deleteCustom: async (id: string) => {
      const r = await fetch(`/api/pipelines/custom/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`delete failed: HTTP ${r.status}`);
    },

    all: async () => {
      const raw = await getJson<{ count: number; pipelines: PipelineRecord[] }>(
        '/api/pipelines/all',
      );
      return { ...raw, pipelines: arr<PipelineRecord>(raw.pipelines) };
    },

    enabled: async () => {
      const raw = await getJson<{ count: number; pipelines: PipelineRecord[] }>(
        '/api/pipelines/enabled',
      );
      return { ...raw, pipelines: arr<PipelineRecord>(raw.pipelines) };
    },

    setOrder: async (id: string, order: number): Promise<void> => {
      const r = await fetch(`/api/pipelines/${encodeURIComponent(id)}/order`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      if (!r.ok) throw new Error(`set order failed: HTTP ${r.status}`);
    },

    // New instances API
    listInstances: async () => {
      const raw = await getJson<{ count: number; instances: PipelineInstance[] }>(
        '/api/pipelines/instances',
      );
      return { ...raw, instances: arr<PipelineInstance>(raw.instances) };
    },

    installFromTemplate: async (body: {
      templateId: string;
      name?: string;
      configOverrides?: Partial<PipelineInstanceConfig>;
      showIn?: string[];
    }) => {
      const r = await fetch('/api/pipelines/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { instance: PipelineInstance };
    },

    patchInstance: async (
      id: string,
      patch: Partial<
        Pick<PipelineInstance, 'name' | 'description' | 'enabled' | 'config' | 'showIn' | 'order'>
      >,
    ) => {
      const r = await fetch(`/api/pipelines/instances/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { instance: PipelineInstance };
    },

    deleteInstance: async (id: string) => {
      const r = await fetch(`/api/pipelines/instances/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`delete failed: HTTP ${r.status}`);
      return (await r.json()) as { ok: boolean; deleted: boolean; disabled?: boolean };
    },

    duplicateInstance: async (id: string) => {
      const r = await fetch(`/api/pipelines/instances/${encodeURIComponent(id)}/duplicate`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`duplicate failed: HTTP ${r.status}`);
      return (await r.json()) as { instance: PipelineInstance };
    },

    reorderInstances: async (orderedIds: string[]) => {
      const r = await fetch('/api/pipelines/instances/order', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      });
      if (!r.ok) throw new Error(`reorder failed: HTTP ${r.status}`);
    },
  },

  templates: {
    list: async () => {
      const raw = await getJson<{ count: number; templates: PipelineTemplateRecord[] }>(
        '/api/templates',
      );
      return { ...raw, templates: arr<PipelineTemplateRecord>(raw.templates) };
    },
  },

  tags: {
    distribution: async (pipelineId: string, labels: string[], days?: number) => {
      const q = new URLSearchParams({ pipelineId, labels: labels.join(',') });
      if (days) q.set('days', String(days));
      const raw = await getJson<{ pipelineId: string; distribution: TagDistributionEntry[] }>(
        `/api/tags/distribution?${q.toString()}`,
      );
      return { ...raw, distribution: arr<TagDistributionEntry>(raw.distribution) };
    },

    posts: async (pipelineId: string, value: string, limit?: number) => {
      const q = new URLSearchParams({ pipelineId, value });
      if (limit) q.set('limit', String(limit));
      const raw = await getJson<{
        pipelineId: string;
        value: string;
        count: number;
        posts: RecentPost[];
      }>(`/api/tags/posts?${q.toString()}`);
      return { ...raw, posts: arr<RecentPost>(raw.posts) };
    },
  },

  // ---------------------------------------------------------------------------
  // Content Browser
  // ---------------------------------------------------------------------------

  contentSearch: async (params: ContentSearchParams): Promise<ContentSearchResult> => {
    const q = new URLSearchParams();
    if (params.q) q.set('q', params.q);
    if (params.driver) q.set('driver', params.driver);
    if (params.sentiment) q.set('sentiment', params.sentiment);
    if (params.status) q.set('status', params.status);
    if (params.author) q.set('author', params.author);
    if (params.hasAgent) q.set('hasAgent', params.hasAgent);
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.type) q.set('type', params.type);
    if (params.sort) q.set('sort', params.sort);
    q.set('limit', String(params.limit ?? 50));
    q.set('offset', String(params.offset ?? 0));
    if (params.pipelineTags) {
      for (const [pipelineId, values] of Object.entries(params.pipelineTags)) {
        if (values.length > 0) {
          q.set(`tag_${pipelineId}`, values.join(','));
        }
      }
    }
    const raw = await getJson<ContentSearchResult>(`/api/content/search?${q.toString()}`);
    return { ...raw, items: arr<ContentItem>(raw.items) };
  },

  postReply: async (postId: string, body: string): Promise<{ commentId: string }> => {
    const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error ?? `HTTP ${r.status}`);
    }
    return (await r.json()) as { commentId: string };
  },

  taxonomyTemplates: {
    list: async () => {
      const raw = await getJson<{
        templates: Array<{
          id: string;
          name: string;
          description: string;
          driverCount: number;
          deepestDepth: number;
        }>;
      }>('/api/taxonomy/templates');
      return { templates: arr<(typeof raw.templates)[number]>(raw.templates) };
    },
    apply: async (
      templateId: 'ecommerce' | 'saas' | 'hardware' | 'gaming' | 'finance' | 'media',
      mode: 'replace' | 'merge',
    ) => {
      const r = await fetch('/api/taxonomy/apply-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId, mode }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { taxonomy: TaxonomyNode[]; driverCount: number };
    },
  },

  bulkTag: async (
    postIds: string[],
    driverId: string,
  ): Promise<{ succeeded: number; failed: number }> => {
    const r = await fetch('/api/posts/bulk-tag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postIds, driverId }),
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}));
      throw new Error((errBody as { error?: string }).error ?? `HTTP ${r.status}`);
    }
    return (await r.json()) as { succeeded: number; failed: number };
  },

  // ---------------------------------------------------------------------------
  // Mod actions (Content Browser)
  // ---------------------------------------------------------------------------

  mod: {
    approvePost: async (postId: string): Promise<void> => {
      const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/approve`, { method: 'POST' });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
    },
    removePost: async (postId: string, opts: { spam?: boolean } = {}): Promise<void> => {
      const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spam: opts.spam ?? false }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
    },
    lockPost: async (postId: string): Promise<void> => {
      const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/lock`, { method: 'POST' });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
    },
    replyToPost: async (
      postId: string,
      body: string,
      as_: 'app' | 'user',
    ): Promise<{ commentId: string }> => {
      const r = await fetch(`/api/posts/${encodeURIComponent(postId)}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, as: as_ }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { commentId: string };
    },
    approveComment: async (commentId: string): Promise<void> => {
      const r = await fetch(`/api/comments/${encodeURIComponent(commentId)}/approve`, {
        method: 'POST',
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
    },
    removeComment: async (commentId: string, opts: { spam?: boolean } = {}): Promise<void> => {
      const r = await fetch(`/api/comments/${encodeURIComponent(commentId)}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spam: opts.spam ?? false }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
    },
    distinguishComment: async (commentId: string): Promise<void> => {
      const r = await fetch(`/api/comments/${encodeURIComponent(commentId)}/distinguish`, {
        method: 'POST',
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
      }
    },
  },

  // ---------------------------------------------------------------------------
  // Data Lab
  // ---------------------------------------------------------------------------

  webhooks: {
    list: async () => {
      const raw = await getJson<{ count: number; webhooks: Webhook[] }>('/api/webhooks');
      return { ...raw, webhooks: arr<Webhook>(raw.webhooks) };
    },
    create: async (body: {
      name: string;
      targetUrl: string;
      events: string[];
      format?: 'auto' | WebhookFormat;
    }) => {
      const r = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { webhook: Webhook };
    },
    update: async (
      id: string,
      patch: { enabled?: boolean; events?: string[]; format?: WebhookFormat; name?: string },
    ) => {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { webhook: Webhook };
    },
    delete: async (id: string) => {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`delete webhook failed: HTTP ${r.status}`);
    },
    test: async (id: string) => {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(id)}/test`, { method: 'POST' });
      return (await r.json()) as { ok: boolean; statusCode?: number; error?: string };
    },
    deliveries: async (id: string) => {
      const raw = await getJson<{ count: number; deliveries: WebhookDelivery[] }>(
        `/api/webhooks/${encodeURIComponent(id)}/deliveries`,
      );
      return { ...raw, deliveries: arr<WebhookDelivery>(raw.deliveries) };
    },
  },

  lab: {
    simulatePost: async (body: {
      title: string;
      body?: string;
      authorName?: string;
      driverOverride?: string;
      sentimentOverride?: 'positive' | 'neutral' | 'negative';
    }): Promise<{ postId: string }> => {
      const r = await fetch('/api/lab/simulate-post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { postId: string };
    },

    simulateComment: async (body: {
      postId: string;
      body: string;
      authorName?: string;
    }): Promise<{ commentId: string }> => {
      const r = await fetch('/api/lab/simulate-comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { commentId: string };
    },

    importJson: async (body: {
      posts: Array<{
        title: string;
        body?: string;
        author?: string;
        comments?: Array<{ body: string; author?: string }>;
      }>;
    }): Promise<{ imported: number; results: Array<{ postId: string; commentIds: string[] }> }> => {
      const r = await fetch('/api/lab/import-json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as {
        imported: number;
        results: Array<{ postId: string; commentIds: string[] }>;
      };
    },

    scenarios: () =>
      getJson<{
        scenarios: Array<{
          name: string;
          description: string;
          status: {
            state: 'idle' | 'running' | 'done' | 'error';
            lastRunAt: number | null;
            error?: string;
          };
        }>;
      }>('/api/lab/scenarios'),

    runScenario: async (name: string): Promise<{ status: string; name: string }> => {
      const r = await fetch(`/api/lab/scenario/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { status: string; name: string };
    },

    scenarioStatus: (name: string) =>
      getJson<{
        name: string;
        state: 'idle' | 'running' | 'done' | 'error';
        lastRunAt: number | null;
        error?: string;
      }>(`/api/lab/scenario/status/${encodeURIComponent(name)}`),

    recentPosts: () =>
      getJson<{ posts: Array<{ postId: string; title: string }> }>('/api/lab/recent-posts-full'),

    clear: async (): Promise<{ deleted: number }> => {
      const r = await fetch('/api/lab/clear', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'YES' }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { deleted: number };
    },
  },

  // ─── Copilot ────────────────────────────────────────────────────────────
  copilot: {
    catalogue: () =>
      getJson<{ tools: Array<{ name: string; description: string; safety: 'read' | 'write' }> }>(
        '/api/copilot/catalogue',
      ),
    chat: async (body: {
      message: string;
      conversationId?: string;
      context?: { currentTab?: string; currentInstanceId?: string; currentPostId?: string };
    }): Promise<{ conversationId: string; message: CopilotMessageWire }> => {
      const r = await fetch('/api/copilot/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `HTTP ${r.status}`);
      }
      return (await r.json()) as { conversationId: string; message: CopilotMessageWire };
    },
    execute: async (body: {
      conversationId: string;
      messageId: string;
      toolCallId: string;
    }): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
      const r = await fetch('/api/copilot/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: unknown;
        error?: string;
      };
      return { ok: r.ok && json.ok !== false, ...json };
    },
    history: () =>
      getJson<{
        conversations: Array<{
          id: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          messageCount: number;
        }>;
      }>('/api/copilot/history'),
    conversation: (id: string) =>
      getJson<{
        conversation: {
          id: string;
          title: string;
          createdAt: number;
          updatedAt: number;
          messages: CopilotMessageWire[];
        };
      }>(`/api/copilot/history/${encodeURIComponent(id)}`),
    clearHistory: async () => {
      const r = await fetch('/api/copilot/history/clear', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { ok: boolean; cleared: number };
    },
    deleteConversation: async (id: string) => {
      const r = await fetch(`/api/copilot/history/${encodeURIComponent(id)}/delete`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
  },
};

// ---------------------------------------------------------------------------
// Copilot wire types
// ---------------------------------------------------------------------------

export interface CopilotToolCallWire {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  preview?: { ok: boolean; summary?: string; error?: string; [k: string]: unknown };
  committed?: { ok: boolean; result?: unknown; error?: string; at: number };
}

export interface CopilotMessageWire {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: CopilotToolCallWire[];
  ts: number;
}

// ---------------------------------------------------------------------------
// Content Browser types
// ---------------------------------------------------------------------------

export type ContentType = 'post' | 'comment' | 'both';
export type ContentSort =
  | 'priority_desc'
  | 'createdAt_desc'
  | 'createdAt_asc'
  | 'sentimentScore_asc'
  | 'sentimentScore_desc'
  | 'responseTime_asc';

export interface ContentItem {
  id: string;
  type: 'post' | 'comment';
  /** For posts: post title. For comments: first 200 chars of body. */
  title: string;
  /** Full body text (used for search and expand preview) */
  body: string | null;
  authorName: string;
  url: string;
  createdAt: number;
  driverId: string | null;
  taggedBy: 'manual' | 'auto' | 'ai' | null;
  sentimentLabel: 'positive' | 'neutral' | 'negative' | null;
  sentimentScore: number | null;
  status: PostStatus | null;
  /** postId — for comments this is their parent post. Used for threading. */
  postId: string;
  /** Only set for comments */
  hasAgentReply: boolean | null;
  replyCount: number | null;
  /** First-response latency in ms, if applicable */
  responseLatencyMs: number | null;
  /** Which agent replied, if any */
  agentUsername: string | null;
}

export interface ContentSearchParams {
  q?: string;
  driver?: string;
  sentiment?: string;
  status?: string;
  author?: string;
  hasAgent?: string;
  from?: string;
  to?: string;
  type?: ContentType;
  sort?: ContentSort;
  limit?: number;
  offset?: number;
  /** Dynamic pipeline tag filters: pipelineId → selected values (OR within, AND across) */
  pipelineTags?: Record<string, string[]>;
}

export interface ContentSearchResult {
  items: ContentItem[];
  total: number;
  offset: number;
  limit: number;
}

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
