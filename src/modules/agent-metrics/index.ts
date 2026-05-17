/**
 * Module 06 — Agent Metrics
 * Tier: CORE · Phase 2 (operational)
 *
 * Tracks per-agent response performance: who answered what, how fast, and
 * did their reply actually help (sentiment delta in the thread after they
 * spoke). Powers the Agents-tab leaderboard.
 *
 * Triggers off `onCommentCreate`. If the comment is from a verified agent
 * AND it's the FIRST agent reply on this post, we record:
 *   - First-response latency (postCreatedAt → comment timestamp)
 *   - Pre-reply sentiment baseline (average of comments before this one)
 *   - Reply itself stored for later sentiment-delta computation
 *
 * Asynchronously we compute the "after" baseline (avg sentiment of the next
 * 5 comments) lazily on each comment that arrives in the same thread.
 *
 * Per-agent rollup HASH keys (per UTC day):
 *   rl:ag:m:{username}:{YYYY-MM-DD}
 *     fields: replies, first_responses, latency_ms_sum, latency_count,
 *             sent_before_sum (×1000), sent_after_sum (×1000),
 *             sent_delta_n (count of threads where after-baseline exists)
 *
 * Per-post first-responder claim (atomic):
 *   rl:ag:first:{postId} STRING = username (hSetNX-style claim)
 *
 * Per-post pending after-sentiment tracking:
 *   rl:ag:pending:{postId} HASH
 *     fields: username, replyAt, beforeSum, beforeCount, afterSum, afterCount
 *     (when afterCount hits 5, we fold the delta into the agent rollup +
 *     delete this key)
 */

import { redis } from '@devvit/web/server';
import { processedOnce } from '@shared/idempotency.js';
import { today } from '@shared/keys.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import { getPostMeta, getSentimentScore, isAgent } from '@shared/storage.js';
import type {
  OnCommentCreateRequest,
  OnPostCreateRequest,
  RedLatticeModule,
} from '@shared/types.js';
import { commentCreateMinimalSchema, postCreateMinimalSchema } from '@shared/validation.js';
import type { Hono } from 'hono';

const HANDLER = 'agent-metrics';
const AFTER_WINDOW = 5; // comments after agent reply that count toward delta
const FIELDS = {
  replies: 'replies',
  firstResponses: 'first',
  latencySum: 'lat_sum',
  latencyCount: 'lat_n',
  sentBeforeSum: 'sb_sum',
  sentAfterSum: 'sa_sum',
  sentDeltaN: 'sd_n',
} as const;

// Redis key helpers (inlined here to avoid touching shared/keys.ts while
// other concurrent work edits it; refactor into K later).
const K2 = {
  agentRollup: (username: string, date: string) => `rl:ag:m:${username.toLowerCase()}:${date}`,
  postFirst: (postId: string) => `rl:ag:first:${postId}`,
  postPending: (postId: string) => `rl:ag:pending:${postId}`,
  postCreatedAt: (postId: string) => `rl:ag:postts:${postId}`,
  knownAgents: () => 'rl:ag:m:known',
};

export const agentMetricsModule: RedLatticeModule = {
  name: 'agent-metrics',
  description: 'Per-agent response performance: latency, first-response rate, sentiment delta.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onPostCreate(event: OnPostCreateRequest): Promise<void> {
    // Record post createdAt so we can compute response latency later.
    // Trigger payloads don't always include post.createdAt; we use now.
    const parsed = postCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.post) return;
    const post = parsed.data.post;
    try {
      await redis.set(K2.postCreatedAt(post.id), String(Date.now()), {
        expiration: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    } catch (err) {
      log.warn('agent-metrics: postCreatedAt write failed', { err: String(err) });
    }
  },

  async onCommentCreate(event: OnCommentCreateRequest): Promise<void> {
    const parsed = commentCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.comment) return;
    const comment = parsed.data.comment;
    if (!comment.postId || !comment.authorName || comment.authorName === '[deleted]') return;

    if (!(await processedOnce(HANDLER, comment.id))) return;

    // Identify agent comments via the four-signal isAgent check.
    let agent = false;
    try {
      agent = await isAgent(comment.authorName);
    } catch (err) {
      log.warn('agent-metrics: isAgent failed', { err: String(err) });
      return;
    }

    if (agent) {
      await recordAgentReply({
        username: comment.authorName,
        postId: comment.postId,
        replyAt: Date.now(),
      });
    } else {
      // Non-agent comment — if there's a pending after-window for this post,
      // bump the after-sum.
      await maybeRecordAfterSample({
        postId: comment.postId,
        commentId: comment.id,
      });
    }
  },

  apiRoutes(app: Hono): void {
    /**
     * Agent leaderboard — aggregates per-agent metrics across the last N
     * days (default 30). Returns one row per agent with averages computed
     * client-friendly (latency in ms, deltas in sentiment scale −1..+1).
     */
    app.get('/api/agents/leaderboard', async (c) => {
      const days = Math.min(
        Math.max(Number.parseInt(c.req.query('days') ?? '30', 10) || 30, 1),
        90,
      );
      const dates = dateRangeRecent(days);
      const usernames = await listKnownAgentUsernames();
      const rows = await Promise.all(
        usernames.map(async (username) => {
          const agg = await aggregateAgent(username, dates);
          return { username, ...agg };
        }),
      );
      // Filter to agents who actually had at least one reply in window.
      const active = rows.filter((r) => r.replies > 0);
      active.sort((a, b) => b.replies - a.replies);
      return c.json({ days, rows: active, count: active.length });
    });

    /**
     * Single-agent detail view — daily breakdown for the last N days.
     */
    app.get('/api/agents/:username/metrics', async (c) => {
      const username = c.req.param('username');
      const days = Math.min(
        Math.max(Number.parseInt(c.req.query('days') ?? '30', 10) || 30, 1),
        90,
      );
      const dates = dateRangeRecent(days);
      const series = await Promise.all(
        dates.map(async (d) => {
          const row = await readAgentDay(username, d);
          return { date: d, ...row };
        }),
      );
      const totals = aggregateRows(series);
      return c.json({ username, days, series, totals });
    });

    /**
     * Admin: force-recompute a single post's after-window (for backfill /
     * debugging). Mod-only.
     */
    app.post('/api/agents/recompute/:postId', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const postId = c.req.param('postId');
      const result = await finalizePending(postId, /* force */ true);
      return c.json({ postId, finalized: result });
    });
  },
};

// ---------------------------------------------------------------------------
// Internal: recording the agent reply
// ---------------------------------------------------------------------------

async function recordAgentReply(args: {
  username: string;
  postId: string;
  replyAt: number;
}): Promise<void> {
  const date = today();
  const rollupKey = K2.agentRollup(args.username, date);

  // Always increment replies + register the agent as "known" so the
  // leaderboard endpoint can iterate them.
  await redis.hIncrBy(rollupKey, FIELDS.replies, 1);
  await redis.expire(rollupKey, 90 * 24 * 60 * 60);
  await redis.zAdd(K2.knownAgents(), { score: args.replyAt, member: args.username.toLowerCase() });

  // First-responder claim (atomic). Only the first agent comment on a post
  // counts toward "first-response latency".
  let claimed = 0;
  try {
    claimed = await redis.hSetNX(K2.postFirst(args.postId), 'u', args.username.toLowerCase());
    if (claimed === 1) {
      await redis.expire(K2.postFirst(args.postId), 60 * 24 * 60 * 60);
    }
  } catch (err) {
    log.warn('agent-metrics: first-responder claim failed', { err: String(err) });
  }

  if (claimed === 1) {
    // Compute first-response latency if we have the post's createdAt.
    let latencyMs: number | null = null;
    try {
      const tsRaw = await redis.get(K2.postCreatedAt(args.postId));
      if (tsRaw) {
        latencyMs = args.replyAt - Number(tsRaw);
      } else {
        // Fall back to PostMeta.createdAt (set by contact-drivers).
        const meta = await getPostMeta(args.postId);
        if (meta) latencyMs = args.replyAt - meta.createdAt;
      }
    } catch (err) {
      log.warn('agent-metrics: latency lookup failed', { err: String(err) });
    }
    if (latencyMs != null && latencyMs >= 0) {
      await redis.hIncrBy(rollupKey, FIELDS.latencySum, Math.floor(latencyMs));
      await redis.hIncrBy(rollupKey, FIELDS.latencyCount, 1);
    }
    await redis.hIncrBy(rollupKey, FIELDS.firstResponses, 1);

    // Sample the existing thread sentiment as "before baseline" — sum of
    // sentiment scores of the post and any prior comments we have scored.
    const beforeBaseline = await computeThreadSentiment(args.postId);
    if (beforeBaseline.count > 0) {
      const pendingKey = K2.postPending(args.postId);
      await redis.hSet(pendingKey, {
        username: args.username.toLowerCase(),
        replyAt: String(args.replyAt),
        beforeSum: String(Math.round(beforeBaseline.scoreSum * 1000)),
        beforeCount: String(beforeBaseline.count),
        afterSum: '0',
        afterCount: '0',
      });
      await redis.expire(pendingKey, 7 * 24 * 60 * 60);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal: tracking the "after" sentiment window
// ---------------------------------------------------------------------------

async function maybeRecordAfterSample(args: { postId: string; commentId: string }): Promise<void> {
  const pendingKey = K2.postPending(args.postId);
  const pending = await redis.hGetAll(pendingKey);
  if (!pending || Object.keys(pending).length === 0) return;
  const afterCount = Number(pending.afterCount ?? '0');
  if (afterCount >= AFTER_WINDOW) return; // already finalized or about to be

  const s = await getSentimentScore(args.commentId);
  if (!s) return;
  await redis.hIncrBy(pendingKey, 'afterSum', Math.round(s.score * 1000));
  const newAfterCount = await redis.hIncrBy(pendingKey, 'afterCount', 1);
  if (newAfterCount >= AFTER_WINDOW) {
    await finalizePending(args.postId, false);
  }
}

async function finalizePending(postId: string, force: boolean): Promise<boolean> {
  const pendingKey = K2.postPending(postId);
  const pending = await redis.hGetAll(pendingKey);
  if (!pending || !pending.username) return false;
  const username = String(pending.username);
  const beforeSum = Number(pending.beforeSum ?? '0') / 1000;
  const beforeCount = Number(pending.beforeCount ?? '0');
  const afterSum = Number(pending.afterSum ?? '0') / 1000;
  const afterCount = Number(pending.afterCount ?? '0');
  if (!force && afterCount < AFTER_WINDOW) return false;
  if (beforeCount === 0 || afterCount === 0) {
    await redis.del(pendingKey);
    return false;
  }
  const beforeAvg = beforeSum / beforeCount;
  const afterAvg = afterSum / afterCount;
  const delta = afterAvg - beforeAvg;
  const date = today();
  const rollupKey = K2.agentRollup(username, date);
  // Accumulate before/after sums and a count, so the average delta can be
  // recomputed by the leaderboard endpoint without losing precision.
  await Promise.all([
    redis.hIncrBy(rollupKey, FIELDS.sentBeforeSum, Math.round(beforeAvg * 1000)),
    redis.hIncrBy(rollupKey, FIELDS.sentAfterSum, Math.round(afterAvg * 1000)),
    redis.hIncrBy(rollupKey, FIELDS.sentDeltaN, 1),
  ]);
  await redis.del(pendingKey);
  log.info('agent-metrics: finalized after-window', {
    postId,
    username,
    beforeAvg: Number(beforeAvg.toFixed(3)),
    afterAvg: Number(afterAvg.toFixed(3)),
    delta: Number(delta.toFixed(3)),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Internal: thread sentiment helper
// ---------------------------------------------------------------------------

async function computeThreadSentiment(postId: string): Promise<{
  scoreSum: number;
  count: number;
}> {
  // We use the existing rl:cmt:post:{postId} ZSET via getCommentIdsForPost
  // — but to avoid an import cycle through `storage`, inline the read.
  const ids = await redis.zRange(`rl:cmt:post:${postId}`, 0, -1, {
    reverse: false,
    by: 'rank',
  });
  let scoreSum = 0;
  let count = 0;
  const post = await getSentimentScore(postId);
  if (post) {
    scoreSum += post.score;
    count += 1;
  }
  // Sample up to 20 prior comments to keep this O(1)-ish.
  for (const member of ids.slice(0, 20)) {
    const s = await getSentimentScore(member.member);
    if (s) {
      scoreSum += s.score;
      count += 1;
    }
  }
  return { scoreSum, count };
}

// ---------------------------------------------------------------------------
// Internal: leaderboard aggregation
// ---------------------------------------------------------------------------

async function listKnownAgentUsernames(): Promise<string[]> {
  const members = await redis.zRange(K2.knownAgents(), 0, 199, {
    reverse: true,
    by: 'rank',
  });
  return members.map((m) => m.member);
}

interface DayMetrics {
  replies: number;
  firstResponses: number;
  latencyMsSum: number;
  latencyCount: number;
  sentBeforeSum: number;
  sentAfterSum: number;
  sentDeltaN: number;
}

async function readAgentDay(username: string, date: string): Promise<DayMetrics> {
  const raw = await redis.hGetAll(K2.agentRollup(username, date));
  return {
    replies: Number(raw?.[FIELDS.replies] ?? '0'),
    firstResponses: Number(raw?.[FIELDS.firstResponses] ?? '0'),
    latencyMsSum: Number(raw?.[FIELDS.latencySum] ?? '0'),
    latencyCount: Number(raw?.[FIELDS.latencyCount] ?? '0'),
    sentBeforeSum: Number(raw?.[FIELDS.sentBeforeSum] ?? '0') / 1000,
    sentAfterSum: Number(raw?.[FIELDS.sentAfterSum] ?? '0') / 1000,
    sentDeltaN: Number(raw?.[FIELDS.sentDeltaN] ?? '0'),
  };
}

interface AggregatedMetrics extends DayMetrics {
  avgLatencyMs: number | null;
  avgSentimentDelta: number | null;
  firstResponseRate: number | null;
}

function aggregateRows(rows: DayMetrics[]): AggregatedMetrics {
  const sum: DayMetrics = {
    replies: 0,
    firstResponses: 0,
    latencyMsSum: 0,
    latencyCount: 0,
    sentBeforeSum: 0,
    sentAfterSum: 0,
    sentDeltaN: 0,
  };
  for (const r of rows) {
    sum.replies += r.replies;
    sum.firstResponses += r.firstResponses;
    sum.latencyMsSum += r.latencyMsSum;
    sum.latencyCount += r.latencyCount;
    sum.sentBeforeSum += r.sentBeforeSum;
    sum.sentAfterSum += r.sentAfterSum;
    sum.sentDeltaN += r.sentDeltaN;
  }
  const avgLatencyMs =
    sum.latencyCount > 0 ? Math.round(sum.latencyMsSum / sum.latencyCount) : null;
  const avgSentimentDelta =
    sum.sentDeltaN > 0
      ? Number(((sum.sentAfterSum - sum.sentBeforeSum) / sum.sentDeltaN).toFixed(3))
      : null;
  const firstResponseRate =
    sum.replies > 0 ? Number((sum.firstResponses / sum.replies).toFixed(3)) : null;
  return { ...sum, avgLatencyMs, avgSentimentDelta, firstResponseRate };
}

async function aggregateAgent(username: string, dates: string[]): Promise<AggregatedMetrics> {
  const rows = await Promise.all(dates.map((d) => readAgentDay(username, d)));
  return aggregateRows(rows);
}

function dateRangeRecent(days: number): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
