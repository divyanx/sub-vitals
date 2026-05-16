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
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  DEFAULT_TAXONOMY,
  getDriverRollup,
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

const HANDLER_NAME = 'contact-drivers';

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

    if (!(await processedOnce(`${HANDLER_NAME}:create`, post.id))) {
      log.debug('contact-drivers: post already processed', { postId: post.id });
      return;
    }

    const taxonomy = await getTaxonomy();
    const text = `${post.title ?? ''} ${post.selftext ?? post.body ?? ''}`.toLowerCase();
    const suggestion = suggestDriver(text, taxonomy);
    if (!suggestion) return;

    const tag: PostTag = {
      postId: post.id,
      driverId: suggestion.id,
      taggedBy: 'auto',
      confidence: suggestion.confidence,
      taggedAt: Date.now(),
    };
    await setPostTag(tag);
    await incrDriverRollup(suggestion.id);
    log.info('contact-drivers: auto-tagged', {
      postId: post.id,
      driverId: suggestion.id,
      confidence: suggestion.confidence,
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
      const postIds = await getPostsByDriver(driverId, Number.isFinite(limit) ? limit : 50);
      return c.json({ driverId, postIds, count: postIds.length });
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
