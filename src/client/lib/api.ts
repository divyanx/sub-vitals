/**
 * Typed fetch helpers for the dashboard. All requests go same-origin to the
 * Hono server mounted at `/api/*`.
 */

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

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const api = {
  health: () => getJson<{ ok: boolean; ts: number }>('/api/health'),
  summary: () => getJson<DashboardSummary>('/api/dashboard/summary'),
  recentPosts: (limit = 25) =>
    getJson<{ items: RecentPost[]; count: number }>(`/api/dashboard/recent-posts?limit=${limit}`),
  taxonomy: () => getJson<{ taxonomy: TaxonomyNode[] }>('/api/drivers/taxonomy'),
  driverVolume: () => getJson<DriverVolume>('/api/drivers/volume'),
  triageQueue: (opts: { limit?: number; status?: PostStatus | 'all' } = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.status) q.set('status', opts.status);
    return getJson<{
      items: Array<RecentPost & { priority: number; status: PostStatus | null }>;
      count: number;
      generatedAt: number;
    }>(`/api/triage/queue?${q.toString()}`);
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
  driverPosts: (driverId: string, opts: { limit?: number; status?: PostStatus } = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.status) q.set('status', opts.status);
    return getJson<{ driverId: string; posts: DriverPost[]; count: number }>(
      `/api/drivers/${encodeURIComponent(driverId)}/posts?${q.toString()}`,
    );
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
  agents: () => getJson<{ agents: Agent[] }>('/api/agents'),
  agentLeaderboard: (days = 30) =>
    getJson<{
      days: number;
      count: number;
      rows: Array<{
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
      }>;
    }>(`/api/agents/leaderboard?days=${days}`),
  incidents: (status: 'active' | 'resolved' | 'all' = 'active') =>
    getJson<{
      count: number;
      incidents: Array<{
        id: string;
        startedAt: number;
        reason: string;
        postIds: string[];
        commentIds: string[];
        status: 'open' | 'resolved';
        resolvedAt?: number;
        resolvedBy?: string;
      }>;
    }>(`/api/incidents?status=${status}`),
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
      themes: raw.themes ?? [],
    };
  },
  regenerateThemes: async () => {
    const r = await fetch('/api/themes/regenerate', { method: 'POST' });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
    }
    return (await r.json()) as Awaited<ReturnType<typeof api.themes>>;
  },
  sentimentRollup: () =>
    getJson<{ from: string; to: string; series: SentimentRollup[] }>('/api/sentiment/rollup'),
  settings: {
    get: () =>
      getJson<Record<string, unknown> & { openrouterKeyConfigured: boolean }>('/api/settings'),
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
  },
};
