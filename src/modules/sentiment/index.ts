/**
 * Module 03 — Sentiment Dashboard (CSAT)
 * Tier: CORE · Phase 1
 *
 * Scores every post and comment for sentiment. Flags escalating negative
 * threads with a modmail alert so the brand team can intervene early.
 *
 * Phase 1: AFINN-165 lexicon scoring via the `sentiment` npm package.
 * Phase 2: LLM judge for ambiguous cases behind a feature flag.
 */

import { context, reddit, redis } from '@devvit/web/server';
import { processedOnce } from '@shared/idempotency.js';
import { dateRange, K, today } from '@shared/keys.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { isUserMod, requireMod } from '@shared/permissions.js';
import { readEffectiveSetting } from '@shared/settings-overrides.js';
import {
  addToSentimentLabelIndex,
  ensureCommentMeta,
  getPostIdsByLabel,
  getPostMetaMany,
  getPostTag,
  getSentimentRollup,
  getSentimentScore,
  incrSentimentRollup,
  isAgent,
  setSentimentScore,
} from '@shared/storage.js';
import { forwardToStudio } from '@shared/studio-bridge.js';
import { recordTag } from '@shared/tags.js';
import {
  type CommentMeta,
  type OnCommentCreateRequest,
  type OnPostCreateRequest,
  type RedLatticeModule,
  SETTINGS,
  type SentimentLabel,
  type SentimentScore,
} from '@shared/types.js';
import {
  commentCreateMinimalSchema,
  menuRequestSchema,
  postCreateMinimalSchema,
} from '@shared/validation.js';
import type { Context, Hono } from 'hono';
import Sentiment from 'sentiment';
import { z } from 'zod';

const HANDLER_POST = 'sentiment:post';
const HANDLER_COMMENT = 'sentiment:comment';
const ESCALATION_COOLDOWN_SEC = 4 * 60 * 60; // 4h
const ESCALATION_SAMPLE_SIZE = 10;
const DEFAULT_THRESHOLD = 5;
const LLM_AMBIGUITY_BAND = 0.15; // |lexicon| < this → ask LLM
const LLM_MIN_TEXT_LEN = 12; // skip LLM on very short content (titles like "ok")

const analyzer = new Sentiment();

export const sentimentModule: RedLatticeModule = {
  name: 'sentiment',
  description: 'Scores post & comment sentiment; alerts on escalating negative threads.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onPostCreate(event: OnPostCreateRequest): Promise<void> {
    const parsed = postCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.post) {
      log.warn('sentiment: post parse failed', {
        issues: parsed.success ? null : parsed.error.issues,
      });
      return;
    }
    const post = parsed.data.post;

    if (!(await processedOnce(HANDLER_POST, post.id))) return;

    const text = `${post.title ?? ''} ${post.selftext ?? post.body ?? ''}`;
    const judged = await judge(text);
    await persistScore({
      contentId: post.id,
      contentType: 'post',
      score: judged.score,
      label: judged.label,
      scoredBy: judged.scoredBy,
    });
    log.info('sentiment: post scored', {
      postId: post.id,
      score: Number(judged.score.toFixed(3)),
      label: judged.label,
      scoredBy: judged.scoredBy,
    });
  },

  async onCommentCreate(event: OnCommentCreateRequest): Promise<void> {
    const parsed = commentCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.comment) return;
    const comment = parsed.data.comment;

    if (!(await processedOnce(HANDLER_COMMENT, comment.id))) return;

    // Persist comment metadata up-front so the dashboard's thread view has
    // everything it needs without re-fetching from Reddit.
    if (comment.postId) {
      const detected = await detectAgent({
        username: comment.authorName,
        flairText: comment.authorFlair?.text,
        distinguishedBy: comment.distinguishedBy,
      });
      await ensureCommentMeta({
        commentId: comment.id,
        postId: comment.postId,
        ...(comment.parentId ? { parentId: comment.parentId } : {}),
        authorName: comment.authorName ?? 'unknown',
        body: comment.body,
        createdAt: Date.now(),
        isAgent: detected.isAgent,
        ...(detected.source ? { agentSource: detected.source } : {}),
      });
    }

    const judged = await judge(comment.body);
    const { score, label } = judged;
    await persistScore({
      contentId: comment.id,
      contentType: 'comment',
      score,
      label,
      scoredBy: judged.scoredBy,
    });

    if (label === 'negative' && score < -0.5 && comment.postId) {
      await checkForEscalation(comment.postId);
    }
  },

  apiRoutes(app: Hono): void {
    app.get('/api/sentiment/rollup', async (c) => {
      const from = c.req.query('from') ?? defaultFromDate();
      const to = c.req.query('to') ?? today();
      const dates = dateRange(from, to);
      const series = await Promise.all(
        dates.map(
          async (d) =>
            (await getSentimentRollup(d)) ?? {
              date: d,
              positive: 0,
              neutral: 0,
              negative: 0,
              total: 0,
              averageScore: 0,
            },
        ),
      );
      return c.json({ from, to, series });
    });

    app.get('/api/sentiment/:contentId', async (c) => {
      const score = await getSentimentScore(c.req.param('contentId'));
      return c.json({ score });
    });

    /**
     * GET /api/sentiment/posts?label=positive|neutral|negative&days=30&limit=50
     *
     * Returns posts whose stored sentiment label matches. Most recent first.
     * Mod-only. Filters by `days` param to exclude posts older than N days.
     */
    app.get('/api/sentiment/posts', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

      const labelParam = c.req.query('label');
      const labelSchema = z.enum(['positive', 'neutral', 'negative']);
      const labelParsed = labelSchema.safeParse(labelParam);
      if (!labelParsed.success) {
        return c.json({ error: 'label must be positive, neutral, or negative' }, 400);
      }
      const label = labelParsed.data;

      const days = Math.min(
        Math.max(Number.parseInt(c.req.query('days') ?? '30', 10) || 30, 1),
        90,
      );
      const limit = Math.min(
        Math.max(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 1),
        100,
      );

      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

      const postIds = await getPostIdsByLabel(label, limit + 20); // over-fetch to account for age filter
      const [metas, tags, sents] = await Promise.all([
        getPostMetaMany(postIds),
        Promise.all(postIds.map((id) => getPostTag(id))),
        Promise.all(postIds.map((id) => getSentimentScore(id))),
      ]);

      const tagById = new Map(
        tags.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.postId, t]),
      );
      const sentById = new Map(
        sents.filter((s): s is NonNullable<typeof s> => !!s).map((s) => [s.contentId, s]),
      );

      const posts = metas
        .filter((m) => m.createdAt >= cutoffMs)
        .slice(0, limit)
        .map((m) => {
          const t = tagById.get(m.postId);
          const s = sentById.get(m.postId);
          return {
            postId: m.postId,
            title: m.title,
            authorName: m.authorName,
            url: m.url,
            createdAt: m.createdAt,
            driverId: t?.driverId ?? null,
            taggedBy: t?.taggedBy ?? null,
            confidence: t?.confidence ?? null,
            reasoning: t?.reasoning ?? null,
            status: t?.status ?? null,
            sentimentLabel: s?.label ?? label,
            sentimentScore: s?.score ?? null,
            sentimentScoredBy: s?.scoredBy ?? null,
          };
        });

      return c.json({ label, count: posts.length, posts });
    });
  },
};

// ---------------------------------------------------------------------------
// Menu handler
// ---------------------------------------------------------------------------

export async function handleSentimentTrailMenu(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ showToast: 'Mod-only action.' });
  const body = menuRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ showToast: 'Invalid request.' }, 400);

  const score = await getSentimentScore(body.data.targetId);
  if (!score) {
    return c.json({ showToast: 'No sentiment data for this post yet.' });
  }
  return c.json({
    showToast: {
      text: `Sentiment: ${score.label} (${score.score.toFixed(2)})`,
      appearance: score.label === 'negative' ? 'neutral' : 'success',
    },
  });
}

// ---------------------------------------------------------------------------
// Lexicon scoring (using the `sentiment` npm package — AFINN-165 based)
// ---------------------------------------------------------------------------

/**
 * Normalized sentiment score in [-1, 1] plus a label.
 *
 * Wraps the `sentiment` package's raw AFINN sum (which can range much wider
 * than [-1, 1]) by dividing by `tokens × 5` to fit our reporting range.
 * AFINN words are scored -5..+5; tokens × 5 is the theoretical maximum.
 */
export function scoreText(text: string): { score: number; label: SentimentLabel } {
  if (!text || text.trim().length === 0) return { score: 0, label: 'neutral' };
  const result = analyzer.analyze(text);
  const tokens = Math.max(1, result.tokens.length);
  const normalized = Math.max(-1, Math.min(1, result.score / (tokens * 5)));
  let label: SentimentLabel = 'neutral';
  if (normalized > 0.05) label = 'positive';
  else if (normalized < -0.05) label = 'negative';
  return { score: normalized, label };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function persistScore(args: {
  contentId: string;
  contentType: 'post' | 'comment';
  score: number;
  label: SentimentLabel;
  scoredBy: 'lexicon' | 'ai';
}): Promise<void> {
  const record: SentimentScore = {
    ...args,
    scoredAt: Date.now(),
  };
  await setSentimentScore(record);
  await incrSentimentRollup(args.label, args.score);

  // Update per-label post index (posts only — comments don't belong in the drill-through list)
  if (args.contentType === 'post') {
    await addToSentimentLabelIndex(args.contentId, args.label, Date.now());
  }

  // Mirror into unified tag storage so Insights tab can render dynamically.
  void recordTag({
    pipelineId: 'sentiment',
    targetType: args.contentType,
    targetId: args.contentId,
    value: args.label,
    confidence: undefined,
    by: args.scoredBy,
    createdAt: record.scoredAt,
  });

  // Forward to Studio (best-effort — never blocks the handler).
  void forwardToStudio('sentiment-score', {
    id: args.contentId,
    kind: args.contentType,
    label: args.label,
    score: args.score,
    scoredBy: args.scoredBy,
  });
}

// ---------------------------------------------------------------------------
// Hybrid judge — lexicon fast path with LLM fallback for ambiguous content
// ---------------------------------------------------------------------------

const llmSchema = z.object({
  label: z.enum(['positive', 'neutral', 'negative']),
  score: z.number().min(-1).max(1),
  reasoning: z.string().max(160),
});

async function judge(
  text: string,
): Promise<{ score: number; label: SentimentLabel; scoredBy: 'lexicon' | 'ai' }> {
  const lexicon = scoreText(text);
  const trimmed = text.trim();
  if (trimmed.length < LLM_MIN_TEXT_LEN) return { ...lexicon, scoredBy: 'lexicon' };
  if (Math.abs(lexicon.score) >= LLM_AMBIGUITY_BAND) return { ...lexicon, scoredBy: 'lexicon' };

  const result = await llmObject({
    name: 'sentiment-judge',
    schema: llmSchema,
    system:
      'You judge the sentiment of short Reddit posts about a brand product. Reply with a label (positive/neutral/negative), a score from -1 (very negative) to +1 (very positive), and a one-sentence reasoning.',
    prompt: `Text:\n"""${trimmed.slice(0, 1500)}"""`,
    maxTokens: 120,
  });

  if (!result.ok) return { ...lexicon, scoredBy: 'lexicon' };
  return { score: result.data.score, label: result.data.label, scoredBy: 'ai' };
}

async function checkForEscalation(postId: string): Promise<void> {
  const cooldownKey = K.sentimentAlertCooldown(postId);
  const recent = await redis.get(cooldownKey);
  if (recent) return;

  const subredditName = context.subredditName;
  if (!subredditName) {
    log.warn('escalation: no subreddit name in context');
    return;
  }

  const threshold = await getThreshold();

  let negativeCount = 0;
  try {
    const comments = await reddit
      .getComments({ postId: postId as `t3_${string}`, limit: ESCALATION_SAMPLE_SIZE })
      .all();
    const scores = await Promise.all(comments.map((c) => getSentimentScore(c.id)));
    negativeCount = scores.filter((s) => s?.label === 'negative').length;
  } catch (err) {
    log.warn('escalation: getComments failed', { err: String(err), postId });
    return;
  }

  if (negativeCount < threshold) return;

  try {
    await reddit.modMail.createConversation({
      subredditName,
      to: null,
      subject: '[RedLattice] Negative thread escalation detected',
      body: [
        `Thread https://reddit.com/comments/${postId.replace('t3_', '')}`,
        '',
        `${negativeCount} of the last ${ESCALATION_SAMPLE_SIZE} comments are negative.`,
        '',
        'This may warrant a verified-agent response.',
      ].join('\n'),
    });
  } catch (err) {
    log.error('escalation: modMail create failed', { err: String(err), postId });
    return;
  }

  await redis.set(cooldownKey, '1', {
    expiration: new Date(Date.now() + ESCALATION_COOLDOWN_SEC * 1000),
  });
  log.info('escalation: modmail sent', { postId, negativeCount, threshold });
}

/**
 * Multi-signal agent detection at comment time. Combines four signals,
 * checked in order of strength (the strongest wins):
 *
 *   1. distinguishedBy — Reddit's native "this mod or admin is speaking
 *      officially" signal. Strongest because it's an intentional, visible-
 *      to-everyone act by the comment author themselves.
 *   2. Cached subreddit moderator list — mods are presumed brand employees.
 *   3. Mod-controlled author flair matching the configured pattern.
 *   4. Explicit AgentRecord (mod-marked or whitelist-seeded).
 *
 * Returns `{ isAgent, source }` so the dashboard can show *why* we trust the
 * comment as official.
 *
 * Best-effort — any error returns false (fail-closed: better to under-tag
 * an agent than to mistakenly mark a random user as one).
 */
async function detectAgent(args: {
  username?: string | undefined;
  flairText?: string | undefined;
  distinguishedBy?: string | undefined;
}): Promise<{ isAgent: boolean; source?: CommentMeta['agentSource'] }> {
  // 1. Reddit-native distinguish — strongest.
  if (args.distinguishedBy === 'moderator' || args.distinguishedBy === 'admin') {
    return { isAgent: true, source: 'distinguished' };
  }
  if (!args.username) return { isAgent: false };

  // 2. Cached mod list.
  try {
    if (await isUserMod(args.username)) {
      return { isAgent: true, source: 'mod-list' };
    }
  } catch (err) {
    log.warn('agent-detect: mod-list check failed (non-fatal)', { err: String(err) });
  }

  // 3. Flair pattern.
  if (args.flairText) {
    try {
      const pattern = await readEffectiveSetting<string>('agent-flair-pattern');
      if (typeof pattern === 'string' && pattern.trim().length > 0) {
        if (new RegExp(pattern, 'i').test(args.flairText)) {
          return { isAgent: true, source: 'flair' };
        }
      }
    } catch (err) {
      log.warn('agent-detect: flair pattern check failed (non-fatal)', {
        err: String(err),
      });
    }
  }

  // 4. Explicit record (whitelist or mod-marked).
  try {
    if (await isAgent(args.username)) {
      return { isAgent: true, source: 'record' };
    }
  } catch (err) {
    log.warn('agent-detect: isAgent failed (non-fatal)', { err: String(err) });
  }

  return { isAgent: false };
}

async function getThreshold(): Promise<number> {
  try {
    const v = await readEffectiveSetting<number>(SETTINGS.SENTIMENT_THRESHOLD);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

function defaultFromDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}
