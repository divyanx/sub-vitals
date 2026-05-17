/**
 * Typed Redis accessors.
 *
 * All key construction goes through `K` from `./keys.ts`. Daily rollups use
 * HASH + hIncrBy for atomic concurrent increments.
 */

import { redis } from '@devvit/web/server';
import { K, today } from './keys.js';
import { log } from './log.js';
import type {
  AgentRecord,
  CommentMeta,
  DriverRollup,
  Incident,
  PostMeta,
  PostStatus,
  PostTag,
  SentimentLabel,
  SentimentRollup,
  SentimentScore,
  TaxonomyNode,
  ThemeSnapshot,
} from './types.js';
import { taxonomyArraySchema } from './validation.js';

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export const DEFAULT_TAXONOMY: TaxonomyNode[] = [
  { id: 'bug', label: 'Bug / Issue Report', color: '#f87171' },
  { id: 'feature', label: 'Feature Request', color: '#60a5fa' },
  { id: 'question', label: 'Question / How-to', color: '#fbbf24' },
  { id: 'billing', label: 'Billing / Account', color: '#a78bfa' },
  { id: 'praise', label: 'Praise / Feedback', color: '#4ade80' },
  { id: 'complaint', label: 'Complaint', color: '#fb923c' },
  { id: 'other', label: 'Other', color: '#94a3b8' },
];

export async function getTaxonomy(): Promise<TaxonomyNode[]> {
  const raw = await redis.get(K.taxonomy());
  if (!raw) return DEFAULT_TAXONOMY;
  try {
    const parsed = JSON.parse(raw);
    const result = taxonomyArraySchema.safeParse(parsed);
    if (!result.success) {
      log.warn('taxonomy parse failed, falling back to default', { issues: result.error.issues });
      return DEFAULT_TAXONOMY;
    }
    return result.data;
  } catch (err) {
    log.warn('taxonomy JSON.parse error', { err: String(err) });
    return DEFAULT_TAXONOMY;
  }
}

export async function setTaxonomy(taxonomy: TaxonomyNode[]): Promise<void> {
  await redis.set(K.taxonomy(), JSON.stringify(taxonomy));
}

// ---------------------------------------------------------------------------
// Post tags
// ---------------------------------------------------------------------------

export async function setPostTag(tag: PostTag): Promise<void> {
  await redis.set(K.postTag(tag.postId), JSON.stringify(tag));
  await redis.zAdd(K.driverIndex(tag.driverId), {
    score: tag.taggedAt,
    member: tag.postId,
  });
}

export async function getPostTag(postId: string): Promise<PostTag | null> {
  const raw = await redis.get(K.postTag(postId));
  return raw ? (JSON.parse(raw) as PostTag) : null;
}

export async function getPostsByDriver(driverId: string, limit = 100): Promise<string[]> {
  const members = await redis.zRange(K.driverIndex(driverId), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });
  return members.map((m) => m.member);
}

/**
 * Update a post's workflow status in place. Idempotent.
 * Returns the updated PostTag, or null if no tag exists for that post.
 */
export async function setPostStatus(
  postId: string,
  status: PostStatus,
  changedBy: string,
): Promise<PostTag | null> {
  const existing = await getPostTag(postId);
  if (!existing) return null;
  const updated: PostTag = {
    ...existing,
    status,
    statusChangedAt: Date.now(),
    statusChangedBy: changedBy,
  };
  await redis.set(K.postTag(postId), JSON.stringify(updated));
  return updated;
}

// ---------------------------------------------------------------------------
// Post metadata — written once per post for dashboard drill-through
// ---------------------------------------------------------------------------

const RECENT_POSTS_CAP = 1000;

export async function ensurePostMeta(meta: PostMeta): Promise<void> {
  const existing = await redis.get(K.postMeta(meta.postId));
  if (existing) return;
  await redis.set(K.postMeta(meta.postId), JSON.stringify(meta));
  await redis.zAdd(K.recentPosts(), { score: meta.createdAt, member: meta.postId });
  const count = await redis.zCard(K.recentPosts());
  if (count > RECENT_POSTS_CAP) {
    await redis.zRemRangeByRank(K.recentPosts(), 0, count - RECENT_POSTS_CAP - 1);
  }
  // Per-user index for context drawer / history view.
  if (meta.authorName && meta.authorName !== 'unknown') {
    await redis.zAdd(K.userPosts(meta.authorName), {
      score: meta.createdAt,
      member: meta.postId,
    });
  }
}

export async function getUserPostIds(username: string, limit = 25): Promise<string[]> {
  const members = await redis.zRange(K.userPosts(username), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });
  return members.map((m) => m.member);
}

export async function getPostMeta(postId: string): Promise<PostMeta | null> {
  const raw = await redis.get(K.postMeta(postId));
  return raw ? (JSON.parse(raw) as PostMeta) : null;
}

export async function getPostMetaMany(postIds: string[]): Promise<PostMeta[]> {
  if (postIds.length === 0) return [];
  const records = await Promise.all(postIds.map((id) => getPostMeta(id)));
  return records.filter((r): r is PostMeta => r !== null);
}

/**
 * Like getPostMetaMany but returns a Map keyed by postId, including null
 * entries for missing ones. Used by endpoints that want to render a row
 * for every requested id (even if meta is missing) so old posts don't
 * silently disappear from the dashboard.
 */
export async function getPostMetaMap(postIds: string[]): Promise<Map<string, PostMeta | null>> {
  const out = new Map<string, PostMeta | null>();
  if (postIds.length === 0) return out;
  const records = await Promise.all(postIds.map((id) => getPostMeta(id)));
  for (let i = 0; i < postIds.length; i++) {
    const id = postIds[i];
    if (id) out.set(id, records[i] ?? null);
  }
  return out;
}

export async function getRecentPostIds(limit = 25): Promise<string[]> {
  const members = await redis.zRange(K.recentPosts(), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });
  return members.map((m) => m.member);
}

// ---------------------------------------------------------------------------
// Comment metadata — persisted per comment for thread reconstruction
// ---------------------------------------------------------------------------

const COMMENTS_PER_POST_CAP = 500;

export async function ensureCommentMeta(meta: CommentMeta): Promise<void> {
  const existing = await redis.get(K.commentMeta(meta.commentId));
  if (existing) return;
  await redis.set(K.commentMeta(meta.commentId), JSON.stringify(meta));
  await redis.zAdd(K.commentsForPost(meta.postId), {
    score: meta.createdAt,
    member: meta.commentId,
  });
  const count = await redis.zCard(K.commentsForPost(meta.postId));
  if (count > COMMENTS_PER_POST_CAP) {
    await redis.zRemRangeByRank(
      K.commentsForPost(meta.postId),
      0,
      count - COMMENTS_PER_POST_CAP - 1,
    );
  }
  // Per-user comment index for context drawer.
  if (meta.authorName && meta.authorName !== 'unknown') {
    await redis.zAdd(K.userComments(meta.authorName), {
      score: meta.createdAt,
      member: meta.commentId,
    });
  }
}

export async function getCommentMeta(commentId: string): Promise<CommentMeta | null> {
  const raw = await redis.get(K.commentMeta(commentId));
  return raw ? (JSON.parse(raw) as CommentMeta) : null;
}

/**
 * Return all known comments for a post, oldest first (so the thread reads
 * top-to-bottom in chronological order — easier to follow than reverse).
 */
export async function getCommentIdsForPost(postId: string): Promise<string[]> {
  const members = await redis.zRange(K.commentsForPost(postId), 0, -1, {
    reverse: false,
    by: 'rank',
  });
  return members.map((m) => m.member);
}

// ---------------------------------------------------------------------------
// Driver rollup — HASH per day, hIncrBy is atomic
// ---------------------------------------------------------------------------

const TOTAL_FIELD = '__total__';

export async function incrDriverRollup(driverId: string, date: string = today()): Promise<void> {
  const key = K.driverRollup(date);
  await redis.hIncrBy(key, driverId, 1);
  await redis.hIncrBy(key, TOTAL_FIELD, 1);
}

export async function getDriverRollup(date: string): Promise<DriverRollup | null> {
  const raw = await redis.hGetAll(K.driverRollup(date));
  if (!raw || Object.keys(raw).length === 0) return null;
  const total = Number(raw[TOTAL_FIELD] ?? '0');
  const counts: Record<string, number> = {};
  for (const [field, value] of Object.entries(raw)) {
    if (field === TOTAL_FIELD) continue;
    counts[field] = Number(value);
  }
  return { date, totalPosts: total, counts };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export async function setAgent(agent: AgentRecord): Promise<void> {
  await redis.set(K.agent(agent.username), JSON.stringify(agent));
  if (agent.role !== 'removed') {
    await redis.zAdd(K.agentList(), {
      score: agent.verifiedAt,
      member: agent.username.toLowerCase(),
    });
  } else {
    await redis.zRem(K.agentList(), [agent.username.toLowerCase()]);
  }
}

export async function getAgent(username: string): Promise<AgentRecord | null> {
  const raw = await redis.get(K.agent(username));
  return raw ? (JSON.parse(raw) as AgentRecord) : null;
}

/**
 * Multi-signal agent detection. Returns true when ANY of the following holds:
 *   1. The user has an explicit AgentRecord (mod-marked or app-install-seeded)
 *   2. The user is a moderator of the current subreddit (mods are presumed
 *      to be brand employees — they have the keys to the sub)
 *
 * Flair-based detection is checked separately in the trigger path (we read
 * the comment's authorFlair from the event payload there; this function only
 * knows the username).
 */
export async function isAgent(username: string): Promise<boolean> {
  if (!username) return false;
  const agent = await getAgent(username);
  if (agent !== null && agent.role !== 'removed') return true;
  // Defer-imported to avoid circular: storage → permissions → reddit.
  const { isUserMod } = await import('./permissions.js');
  return isUserMod(username);
}

export async function listAgents(): Promise<AgentRecord[]> {
  const members = await redis.zRange(K.agentList(), 0, -1, { reverse: true, by: 'rank' });
  const usernames = members.map((m) => m.member);
  const records = await Promise.all(usernames.map((u) => getAgent(u)));
  return records.filter((r): r is AgentRecord => r !== null);
}

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

export async function setSentimentScore(score: SentimentScore): Promise<void> {
  await redis.set(K.sentimentScore(score.contentId), JSON.stringify(score));
}

export async function getSentimentScore(contentId: string): Promise<SentimentScore | null> {
  const raw = await redis.get(K.sentimentScore(contentId));
  return raw ? (JSON.parse(raw) as SentimentScore) : null;
}

const SENT_FIELDS = {
  positive: 'p',
  neutral: 'n',
  negative: 'g',
  total: 't',
  scoreSum: 's',
} as const;

export async function incrSentimentRollup(
  label: SentimentLabel,
  score: number,
  date: string = today(),
): Promise<void> {
  const key = K.sentimentRollup(date);
  await redis.hIncrBy(
    key,
    label === 'positive'
      ? SENT_FIELDS.positive
      : label === 'negative'
        ? SENT_FIELDS.negative
        : SENT_FIELDS.neutral,
    1,
  );
  await redis.hIncrBy(key, SENT_FIELDS.total, 1);
  // Score stored as integer ‰ for hIncrBy compatibility (Devvit hIncrBy is int-only).
  await redis.hIncrBy(key, SENT_FIELDS.scoreSum, Math.round(score * 1000));
}

export async function getSentimentRollup(date: string): Promise<SentimentRollup | null> {
  const raw = await redis.hGetAll(K.sentimentRollup(date));
  if (!raw || Object.keys(raw).length === 0) return null;
  const total = Number(raw[SENT_FIELDS.total] ?? '0');
  const scoreSum = Number(raw[SENT_FIELDS.scoreSum] ?? '0') / 1000;
  return {
    date,
    positive: Number(raw[SENT_FIELDS.positive] ?? '0'),
    neutral: Number(raw[SENT_FIELDS.neutral] ?? '0'),
    negative: Number(raw[SENT_FIELDS.negative] ?? '0'),
    total,
    averageScore: total > 0 ? scoreSum / total : 0,
  };
}

// ---------------------------------------------------------------------------
// Crisis detection — incidents
// ---------------------------------------------------------------------------

const INCIDENT_ACTIVE_TTL_SEC = 30 * 60; // 30 min auto-expire if quiet
const INCIDENT_DETAIL_TTL_SEC = 30 * 24 * 60 * 60; // 30 days

export async function getIncident(id: string): Promise<Incident | null> {
  const raw = await redis.get(K.incident(id));
  return raw ? (JSON.parse(raw) as Incident) : null;
}

export async function saveIncident(incident: Incident): Promise<void> {
  await redis.set(K.incident(incident.id), JSON.stringify(incident), {
    expiration: new Date(Date.now() + INCIDENT_DETAIL_TTL_SEC * 1000),
  });
  await redis.zAdd(K.incidentList(), { score: incident.startedAt, member: incident.id });
}

/**
 * Atomically claim the "active incident" slot for this hour.
 * Returns true only on first claim (caller should open a new incident).
 * Uses hSetNX so concurrent triggers don't race.
 */
export async function claimActiveIncident(incidentId: string): Promise<boolean> {
  const claimed = await redis.hSetNX(K.incidentActive(), 'id', incidentId);
  if (claimed === 1) {
    await redis.expire(K.incidentActive(), INCIDENT_ACTIVE_TTL_SEC);
    return true;
  }
  return false;
}

export async function getActiveIncidentId(): Promise<string | null> {
  const id = await redis.hGet(K.incidentActive(), 'id');
  return id ?? null;
}

/** Touch the active-incident TTL so it doesn't auto-expire while comments keep flowing. */
export async function refreshActiveIncidentTTL(): Promise<void> {
  await redis.expire(K.incidentActive(), INCIDENT_ACTIVE_TTL_SEC);
}

export async function clearActiveIncident(): Promise<void> {
  await redis.del(K.incidentActive());
}

export async function listIncidentIds(limit = 50): Promise<string[]> {
  const members = await redis.zRange(K.incidentList(), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });
  return members.map((m) => m.member);
}

// ---------------------------------------------------------------------------
// Theme clustering
// ---------------------------------------------------------------------------

const THEMES_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export async function getThemeSnapshot(): Promise<ThemeSnapshot | null> {
  const raw = await redis.get(K.themesLatest());
  return raw ? (JSON.parse(raw) as ThemeSnapshot) : null;
}

export async function saveThemeSnapshot(snapshot: ThemeSnapshot): Promise<void> {
  await redis.set(K.themesLatest(), JSON.stringify(snapshot), {
    expiration: new Date(Date.now() + THEMES_TTL_SEC * 1000),
  });
}

// ---------------------------------------------------------------------------
// Weekly digest — last-sent de-dup
// ---------------------------------------------------------------------------

export async function getLastDigestSentAt(): Promise<number | null> {
  const raw = await redis.get(K.digestLast());
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function setLastDigestSentAt(ts: number): Promise<void> {
  await redis.set(K.digestLast(), String(ts));
}
