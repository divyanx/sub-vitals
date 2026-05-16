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
  driverPosts: (driverId: string, opts: { limit?: number; status?: PostStatus } = {}) => {
    const q = new URLSearchParams();
    q.set('limit', String(opts.limit ?? 50));
    if (opts.status) q.set('status', opts.status);
    return getJson<{ driverId: string; posts: DriverPost[]; count: number }>(
      `/api/drivers/${encodeURIComponent(driverId)}/posts?${q.toString()}`,
    );
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
  sentimentRollup: () =>
    getJson<{ from: string; to: string; series: SentimentRollup[] }>('/api/sentiment/rollup'),
};
