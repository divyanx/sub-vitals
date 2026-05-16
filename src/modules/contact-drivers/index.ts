/**
 * Module 02 — Contact Drivers
 * Tier: CORE · Phase 1
 *
 * Tags every post with an issue category (bug, billing, feature, complaint…)
 * so brand teams see *why* customers are contacting them.
 *
 * Phase 1:
 *   - PostCreate trigger → keyword auto-suggest → store tag + rollup if confident
 *   - Manual tag via menu action (form-based)
 *   - API routes for the dashboard
 *
 * Phase 2:
 *   - LLM-based tagging when keyword confidence is low
 */

import { context } from '@devvit/web/server';
import { processedOnce } from '@shared/idempotency.js';
import { dateRange, today } from '@shared/keys.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  DEFAULT_TAXONOMY,
  ensurePostMeta,
  getDriverRollup,
  getPostMetaMany,
  getPostsByDriver,
  getPostTag,
  getTaxonomy,
  incrDriverRollup,
  setPostTag,
} from '@shared/storage.js';
import type {
  OnPostCreateRequest,
  PostTag,
  RedLatticeModule,
  TaxonomyNode,
} from '@shared/types.js';
import {
  formRequestSchema,
  menuRequestSchema,
  postCreateMinimalSchema,
  tagPostBodySchema,
} from '@shared/validation.js';
import type { Context, Hono } from 'hono';
import { z } from 'zod';

const HANDLER_NAME = 'contact-drivers';
const LLM_CONFIDENCE_FLOOR = 0.6;

export const contactDriversModule: RedLatticeModule = {
  name: 'contact-drivers',
  description: 'Tags posts with issue categories so brands see why customers contact them.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onPostCreate(event: OnPostCreateRequest): Promise<void> {
    const parsed = postCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.post) return;
    const post = parsed.data.post;
    const subName = parsed.data.subreddit?.name ?? context.subredditName ?? '';

    log.info('contact-drivers: PostCreate received', {
      postId: post.id,
      titleLen: (post.title ?? '').length,
      bodyLen: (post.selftext ?? post.body ?? '').length,
    });

    // Cross-module: persist post metadata first (idempotent).
    await ensurePostMeta({
      postId: post.id,
      title: post.title ?? '',
      authorName: post.authorName ?? 'unknown',
      url: `https://www.reddit.com/r/${subName}/comments/${post.id.replace('t3_', '')}`,
      createdAt: Date.now(),
    });

    if (!(await processedOnce(`${HANDLER_NAME}:create`, post.id))) {
      log.debug('contact-drivers: post already processed', { postId: post.id });
      return;
    }

    const taxonomy = await getTaxonomy();
    const title = post.title ?? '';
    const body = post.selftext ?? post.body ?? '';

    // 1. Fast lexicon pass.
    const lexicon = suggestDriver(`${title} ${body}`.toLowerCase(), taxonomy);

    // 2. LLM judgment when lexicon is weak (no match OR low confidence).
    const needLlm = !lexicon || lexicon.confidence < LLM_CONFIDENCE_FLOOR;
    let llmResult: { id: string; confidence: number; reasoning: string } | null = null;
    if (needLlm) {
      llmResult = await classifyWithLlm({ title, body, taxonomy });
    }

    const final = llmResult ?? lexicon;
    if (!final) {
      log.info('contact-drivers: no tag (lexicon empty, LLM unavailable)', { postId: post.id });
      return;
    }

    const reasoning =
      llmResult && typeof llmResult.reasoning === 'string' ? llmResult.reasoning : undefined;
    const tag: PostTag = {
      postId: post.id,
      driverId: final.id,
      taggedBy: llmResult ? 'ai' : 'auto',
      confidence: final.confidence,
      ...(reasoning ? { reasoning } : {}),
      taggedAt: Date.now(),
    };
    await setPostTag(tag);
    await incrDriverRollup(final.id);
    log.info('contact-drivers: tagged', {
      postId: post.id,
      driverId: final.id,
      confidence: final.confidence,
      taggedBy: tag.taggedBy,
    });
  },

  apiRoutes(app: Hono): void {
    app.get('/api/drivers/taxonomy', async (c) => {
      const taxonomy = await getTaxonomy();
      return c.json({ taxonomy });
    });

    app.get('/api/drivers/volume', async (c) => {
      const from = c.req.query('from') ?? defaultFromDate();
      const to = c.req.query('to') ?? today();
      const dates = dateRange(from, to);
      const rollups = await Promise.all(
        dates.map(
          async (d) => (await getDriverRollup(d)) ?? { date: d, totalPosts: 0, counts: {} },
        ),
      );
      return c.json({ from, to, series: rollups });
    });

    app.get('/api/drivers/:driverId/posts', async (c) => {
      const driverId = c.req.param('driverId');
      const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
      const cap = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
      const postIds = await getPostsByDriver(driverId, cap);
      const posts = await getPostMetaMany(postIds);
      const tags = await Promise.all(postIds.map((id) => getPostTag(id)));
      const enriched = posts.map((p, i) => {
        const t = tags[i];
        return {
          ...p,
          driverId,
          taggedBy: t?.taggedBy,
          confidence: t?.confidence,
          reasoning: t?.reasoning,
        };
      });
      return c.json({ driverId, posts: enriched, count: enriched.length });
    });

    app.post('/api/drivers/tag', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const body = tagPostBodySchema.safeParse(await c.req.json());
      if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);

      const taxonomy = await getTaxonomy();
      if (!taxonomy.some((t) => t.id === body.data.driverId)) {
        return c.json({ error: 'unknown driver' }, 400);
      }

      const tag: PostTag = {
        postId: body.data.postId,
        driverId: body.data.driverId,
        taggedBy: 'manual',
        taggedByUser: context.username,
        taggedAt: Date.now(),
      };
      await setPostTag(tag);
      await incrDriverRollup(body.data.driverId);
      return c.json({ ok: true, tag });
    });
  },
};

// ---------------------------------------------------------------------------
// Menu and form handlers
// ---------------------------------------------------------------------------

export async function handleTagIssueMenu(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ showToast: 'Mod-only action.' });
  const body = menuRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ showToast: 'Invalid request.' }, 400);

  const taxonomy = await getTaxonomy();
  const existing = await getPostTag(body.data.targetId);

  return c.json({
    showForm: {
      name: 'tag-issue',
      form: {
        title: 'Tag this post',
        description: 'Categorize this post by contact driver.',
        fields: [
          {
            name: 'driverId',
            label: 'Issue category',
            type: 'select',
            required: true,
            options: taxonomy.map((t) => ({ label: t.label, value: t.id })),
            defaultValue: existing?.driverId ? [existing.driverId] : undefined,
          },
        ],
        acceptLabel: 'Tag',
        cancelLabel: 'Cancel',
      },
      data: { postId: body.data.targetId },
    },
  });
}

export async function handleTagIssueFormSubmit(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ showToast: 'Mod-only action.' });
  const body = formRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ showToast: 'Invalid submission.' }, 400);

  const postId = (body.data.data?.postId as string | undefined) ?? '';
  const driverField = body.data.values.driverId;
  const driverId =
    Array.isArray(driverField) && typeof driverField[0] === 'string' ? driverField[0] : '';

  if (!postId || !driverId) {
    return c.json({ showToast: 'Missing post or driver.' }, 400);
  }

  const tag: PostTag = {
    postId,
    driverId,
    taggedBy: 'manual',
    taggedByUser: context.username,
    taggedAt: Date.now(),
  };
  await setPostTag(tag);
  await incrDriverRollup(driverId);
  return c.json({ showToast: { text: `✓ Tagged as ${driverId}`, appearance: 'success' } });
}

// ---------------------------------------------------------------------------
// Keyword auto-suggester — cheap baseline before any LLM
// ---------------------------------------------------------------------------

const KEYWORDS: Record<string, string[]> = {
  bug: ['bug', 'broken', 'crash', 'error', "doesn't work", 'not working', 'glitch', 'crashes'],
  feature: [
    'feature request',
    'wishlist',
    'please add',
    'would be nice',
    'suggestion',
    'would love',
  ],
  question: ['how do i', 'how to', 'why does', 'is there a way', 'how can i', 'anyone know'],
  billing: ['refund', 'charge', 'billing', 'subscription', 'cancel', 'payment', 'invoice', 'price'],
  praise: ['love this', 'amazing', 'great job', 'thank you', 'fantastic', 'awesome', 'best ever'],
  complaint: ['terrible', 'awful', 'horrible', 'worst', 'angry', 'disappointed', 'unacceptable'],
};

export interface Suggestion {
  id: string;
  confidence: number;
}

export function suggestDriver(
  text: string,
  taxonomy: TaxonomyNode[] = DEFAULT_TAXONOMY,
): Suggestion | null {
  const validIds = new Set(taxonomy.map((t) => t.id));
  let best: Suggestion | null = null;
  for (const [driverId, phrases] of Object.entries(KEYWORDS)) {
    if (!validIds.has(driverId)) continue;
    const hits = phrases.filter((p) => text.includes(p)).length;
    if (hits === 0) continue;
    const confidence = Math.min(1, hits / 3); // 3 hits = full confidence
    if (!best || confidence > best.confidence) best = { id: driverId, confidence };
  }
  return best && best.confidence >= 0.34 ? best : null;
}

function defaultFromDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// LLM classifier — Phase 2 hybrid layer
// ---------------------------------------------------------------------------

async function classifyWithLlm(args: {
  title: string;
  body: string;
  taxonomy: TaxonomyNode[];
}): Promise<{ id: string; confidence: number; reasoning: string } | null> {
  const ids = args.taxonomy.map((t) => t.id);
  if (ids.length === 0) return null;
  const [firstId, ...restIds] = ids;
  if (!firstId) return null;
  const schema = z.object({
    category: z.enum([firstId, ...restIds]),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().max(200),
  });
  const categoryList = args.taxonomy
    .map((t) => `- ${t.id}: ${t.label}${t.description ? ` — ${t.description}` : ''}`)
    .join('\n');
  const result = await llmObject({
    name: 'contact-drivers-tag',
    schema,
    system:
      'You categorize Reddit posts in a brand support subreddit by their contact driver (why the customer is posting). Choose the single best matching category. Reply with the category id, your confidence (0-1), and a one-sentence reasoning.',
    prompt: `Categories:\n${categoryList}\n\nPost title: ${args.title}\nPost body: ${args.body || '(empty)'}\n\nReturn the best matching category id, a confidence score, and a brief reasoning.`,
  });
  if (!result.ok) return null;
  return {
    id: result.data.category,
    confidence: result.data.confidence,
    reasoning: result.data.reasoning,
  };
}
