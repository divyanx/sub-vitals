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
  DriverRollup,
  PostMeta,
  PostTag,
  SentimentLabel,
  SentimentRollup,
  SentimentScore,
  TaxonomyNode,
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

export async function getRecentPostIds(limit = 25): Promise<string[]> {
  const members = await redis.zRange(K.recentPosts(), 0, limit - 1, {
    reverse: true,
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

export async function isAgent(username: string): Promise<boolean> {
  const agent = await getAgent(username);
  return agent !== null && agent.role !== 'removed';
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
