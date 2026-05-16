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

import { context, reddit, redis, settings } from '@devvit/web/server';
import { processedOnce } from '@shared/idempotency.js';
import { dateRange, K, today } from '@shared/keys.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  getSentimentRollup,
  getSentimentScore,
  incrSentimentRollup,
  setSentimentScore,
} from '@shared/storage.js';
import {
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

async function getThreshold(): Promise<number> {
  try {
    const v = await settings.get(SETTINGS.SENTIMENT_THRESHOLD);
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
