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

  // comment metadata + per-post thread index
  commentMeta: (commentId: string) => `rl:cmt:${commentId}`,
  commentsForPost: (postId: string) => `rl:cmt:post:${postId}`,

  // per-user (post author) index for context drawer
  userPosts: (username: string) => `rl:user:posts:${username.toLowerCase()}`,
  userComments: (username: string) => `rl:user:comments:${username.toLowerCase()}`,

  // pinned daily pulse
  pulsePostId: () => 'rl:pulse:postId',

  // routing notification de-dup (per post)
  routingSent: (postId: string) => `rl:route:${postId}`,

  // agent-verification
  agent: (username: string) => `rl:ag:${username.toLowerCase()}`,
  agentList: () => 'rl:ag:list',

  // sentiment
  sentimentScore: (contentId: string) => `rl:sent:${contentId}`,
  sentimentRollup: (date: string) => `rl:sent:roll:${date}`,
  sentimentAlertCooldown: (postId: string) => `rl:sent:cd:${postId}`,

  // sentiment — per-label ZSET (score = createdAt ms, member = postId)
  sentimentLabelIndex: (label: 'positive' | 'neutral' | 'negative') => `rl:sent:label:${label}`,

  // pipeline overrides (STRING: JSON blob per pipeline id)
  pipelineOverrides: (id: string) => `rl:pipeline:${id}:overrides`,

  // custom pipelines (ZSET: score = createdAt, member = id) + per-pipeline detail
  customPipelineList: () => 'rl:pipeline:custom:list',
  customPipeline: (id: string) => `rl:pipeline:custom:${id}`,

  // crisis-detection — per-hour rolling counters (HASH: total, neg)
  hourBucket: (hourSlot: string) => `rl:hr:cmt:${hourSlot}`,
  // crisis-detection — active incident pointer (STRING: incident id)
  incidentActive: () => 'rl:incident:active',
  // crisis-detection — incident detail (STRING: JSON)
  incident: (id: string) => `rl:incident:${id}`,
  // crisis-detection — incident archive (ZSET: score = startedAt)
  incidentList: () => 'rl:incident:list',

  // theme-clustering — latest cluster snapshot (STRING: JSON)
  themesLatest: () => 'rl:themes:latest',

  // weekly-digest — de-dup sentinel (STRING: ISO timestamp)
  digestLast: () => 'rl:digest:last',

  // shared infra
  processed: (handler: string, contentId: string) => `rl:proc:${handler}:${contentId}`,
  rateLimit: (name: string) => `rl:rl:${name}`,
  modPermCache: (username: string) => `rl:perm:mod:${username.toLowerCase()}`,
  llmCache: (hash: string) => `rl:llm:cache:${hash}`,
  llmCostMonth: (yyyymm: string) => `rl:cost:${yyyymm}`,

  // audit-log
  auditLog: () => 'rl:audit:log',
} as const;

// ---------------------------------------------------------------------------
// Date helpers — UTC-based ISO date strings (YYYY-MM-DD) for rollup keys
// ---------------------------------------------------------------------------

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Current UTC hour slot for crisis-detection buckets: "YYYY-MM-DDTHH" */
export function currentHourSlot(): string {
  return new Date().toISOString().slice(0, 13);
}

/** Hour slot for an arbitrary timestamp (ms) */
export function hourSlotOf(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 13);
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
