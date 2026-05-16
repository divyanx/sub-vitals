/**
 * Redis key builders.
 *
 * Single source of truth for every key string. If two modules ever need the
 * same key, they import it from here. Devvit Redis is per-installation
 * scoped automatically — we don't prefix with subreddit names.
 */

export const K = {
  // contact-drivers
  taxonomy: () => 'rl:tx',
  postTag: (postId: string) => `rl:tag:${postId}`,
  driverIndex: (driverId: string) => `rl:dr:idx:${driverId}`,
  driverRollup: (date: string) => `rl:dr:roll:${date}`,

  // post metadata (cross-module)
  postMeta: (postId: string) => `rl:meta:${postId}`,
  recentPosts: () => 'rl:meta:recent',

  // pinned daily pulse
  pulsePostId: () => 'rl:pulse:postId',

  // agent-verification
  agent: (username: string) => `rl:ag:${username.toLowerCase()}`,
  agentList: () => 'rl:ag:list',

  // sentiment
  sentimentScore: (contentId: string) => `rl:sent:${contentId}`,
  sentimentRollup: (date: string) => `rl:sent:roll:${date}`,
  sentimentAlertCooldown: (postId: string) => `rl:sent:cd:${postId}`,

  // shared infra
  processed: (handler: string, contentId: string) => `rl:proc:${handler}:${contentId}`,
  rateLimit: (name: string) => `rl:rl:${name}`,
  modPermCache: (username: string) => `rl:perm:mod:${username.toLowerCase()}`,
  llmCache: (hash: string) => `rl:llm:cache:${hash}`,
  llmCostMonth: (yyyymm: string) => `rl:cost:${yyyymm}`,
} as const;

// ---------------------------------------------------------------------------
// Date helpers — UTC-based ISO date strings (YYYY-MM-DD) for rollup keys
// ---------------------------------------------------------------------------

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function yyyymm(): string {
  return new Date().toISOString().slice(0, 7);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
