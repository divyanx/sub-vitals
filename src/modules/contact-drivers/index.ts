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

import { context, reddit, redis, settings } from '@devvit/web/server';
import { processedOnce } from '@shared/idempotency.js';
import { dateRange, K, today } from '@shared/keys.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  DEFAULT_TAXONOMY,
  ensurePostMeta,
  getDriverRollup,
  getPostMetaMap,
  getPostsByDriver,
  getPostTag,
  getTaxonomy,
  incrDriverRollup,
  setPostStatus,
  setPostTag,
} from '@shared/storage.js';
import type {
  OnPostCreateRequest,
  PostStatus,
  PostTag,
  RedLatticeModule,
  TaxonomyNode,
} from '@shared/types.js';
import {
  formRequestSchema,
  menuRequestSchema,
  postCreateMinimalSchema,
  routingRulesSchema,
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
      status: 'open',
    };
    await setPostTag(tag);
    await incrDriverRollup(final.id);

    // Apply Reddit post flair so teams can filter the sub by driver natively.
    const node = taxonomy.find((t) => t.id === final.id);
    if (node && subName && post.id.startsWith('t3_')) {
      try {
        await reddit.setPostFlair({
          subredditName: subName,
          postId: post.id as `t3_${string}`,
          text: node.label,
          ...(node.color ? { backgroundColor: node.color, textColor: 'light' as const } : {}),
        });
      } catch (err) {
        log.warn('contact-drivers: setPostFlair failed (non-fatal)', {
          err: err instanceof Error ? err.message : String(err),
          postId: post.id,
        });
      }
    }

    log.info('contact-drivers: tagged', {
      postId: post.id,
      driverId: final.id,
      confidence: final.confidence,
      taggedBy: tag.taggedBy,
    });

    // Route to the right team via modmail if a rule matches.
    await maybeRouteToTeam({
      driverId: final.id,
      driverLabel: node?.label ?? final.id,
      postId: post.id,
      postTitle: post.title ?? '(no title)',
      postUrl: `https://www.reddit.com/r/${subName}/comments/${post.id.replace('t3_', '')}`,
      reasoning: reasoning ?? null,
      subName: subName || '',
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
      const statusFilter = c.req.query('status') as PostStatus | undefined;
      const postIds = await getPostsByDriver(driverId, cap);
      const metaMap = await getPostMetaMap(postIds);
      const tags = await Promise.all(postIds.map((id) => getPostTag(id)));
      const tagById = new Map(
        tags.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.postId, t]),
      );

      // Backfill missing meta from Reddit (best-effort) so old posts from
      // before ensurePostMeta existed self-heal on first view. Capped per
      // request — never block the response on more than a handful.
      const sub = context.subredditName ?? '';
      const missingIds = postIds.filter((id) => !metaMap.get(id)).slice(0, 10);
      await Promise.all(
        missingIds.map(async (postId) => {
          try {
            const post = await reddit.getPostById(postId as `t3_${string}`);
            const backfilled = {
              postId,
              title: post.title ?? '',
              authorName: post.authorName ?? 'unknown',
              url: `https://www.reddit.com/r/${sub}/comments/${postId.replace('t3_', '')}`,
              createdAt: post.createdAt?.getTime?.() ?? Date.now(),
            };
            await ensurePostMeta(backfilled);
            metaMap.set(postId, backfilled);
          } catch (err) {
            log.warn('contact-drivers: meta backfill failed', {
              err: err instanceof Error ? err.message : String(err),
              postId,
            });
          }
        }),
      );

      const enriched = postIds
        .map((postId) => {
          const meta = metaMap.get(postId);
          const t = tagById.get(postId);
          return {
            postId,
            title: meta?.title ?? '(unknown post)',
            authorName: meta?.authorName ?? 'unknown',
            url:
              meta?.url ?? `https://www.reddit.com/r/${sub}/comments/${postId.replace('t3_', '')}`,
            createdAt: meta?.createdAt ?? 0,
            driverId,
            taggedBy: t?.taggedBy ?? null,
            confidence: t?.confidence ?? null,
            reasoning: t?.reasoning ?? null,
            status: (t?.status ?? 'open') as PostStatus,
          };
        })
        .filter((p) => !statusFilter || p.status === statusFilter);
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
        status: 'open',
      };
      await setPostTag(tag);
      await incrDriverRollup(body.data.driverId);
      return c.json({ ok: true, tag });
    });

    /**
     * Update a post's workflow status from the dashboard.
     * Body: { postId, status }
     */
    app.post('/api/posts/:postId/status', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const postId = c.req.param('postId');
      let body: { status?: unknown };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid body' }, 400);
      }
      const status = body.status;
      if (
        status !== 'open' &&
        status !== 'in-progress' &&
        status !== 'responded' &&
        status !== 'resolved'
      ) {
        return c.json({ error: 'invalid status' }, 400);
      }
      const updated = await setPostStatus(postId, status, context.username ?? 'api');
      if (!updated) return c.json({ error: 'post not tagged' }, 404);
      return c.json({ ok: true, tag: updated });
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

async function handleStatusMenu(
  c: Context,
  status: PostStatus,
  toastText: string,
): Promise<Response> {
  if (!(await requireMod())) return c.json({ showToast: 'Mod-only action.' });
  const body = menuRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ showToast: 'Invalid request.' }, 400);
  const updated = await setPostStatus(body.data.targetId, status, context.username ?? 'menu');
  if (!updated) {
    return c.json({ showToast: 'Post is not tagged with a driver yet.' });
  }
  return c.json({ showToast: { text: toastText, appearance: 'success' } });
}

export function handleMarkResolvedMenu(c: Context): Promise<Response> {
  return handleStatusMenu(c, 'resolved', '✓ Marked resolved');
}

export function handleMarkOpenMenu(c: Context): Promise<Response> {
  return handleStatusMenu(c, 'open', 'Re-opened');
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
// Per-driver routing — when a post matches a configured driver, ping the right
// team via modmail with a deep link + context. Idempotent per post.
// ---------------------------------------------------------------------------

async function maybeRouteToTeam(args: {
  driverId: string;
  driverLabel: string;
  postId: string;
  postTitle: string;
  postUrl: string;
  reasoning: string | null;
  subName: string;
}): Promise<void> {
  const rawJson =
    ((await settings.get('routing-json').catch(() => undefined)) as string | undefined) ?? '';
  if (!rawJson.trim()) return;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch (err) {
    log.warn('routing: invalid JSON in routing-json setting', { err: String(err) });
    return;
  }
  const rulesParse = routingRulesSchema.safeParse(parsedJson);
  if (!rulesParse.success) {
    log.warn('routing: routing-json failed validation', { issues: rulesParse.error.issues });
    return;
  }

  const rule = rulesParse.data[args.driverId];
  if (!rule) return;
  if (!args.subName) return;

  // Idempotency — never modmail twice for the same post.
  const sent = await redis.hSetNX(K.routingSent(args.postId), 'r', '1');
  if (sent !== 1) {
    log.debug('routing: already routed for post', { postId: args.postId });
    return;
  }
  await redis.expire(K.routingSent(args.postId), 7 * 24 * 60 * 60);

  const subject = rule.subject ?? `[RedLattice] new ${args.driverLabel} post`;
  const mentionLine =
    rule.mentions && rule.mentions.length > 0
      ? `\n\nNotifying: ${rule.mentions.map((u) => `u/${u}`).join(' ')}\n\n`
      : '\n\n';
  const body = [
    `**${escapeMd(args.postTitle)}**`,
    `Driver: \`${args.driverLabel}\``,
    `Link: ${args.postUrl}`,
    args.reasoning ? `> ${escapeMd(args.reasoning)}` : null,
    `${mentionLine}Tagged automatically by RedLattice. Reply to this modmail to coordinate.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    await reddit.modMail.createConversation({
      subredditName: args.subName,
      to: null,
      subject,
      body,
    });
    log.info('routing: modmail sent', {
      driverId: args.driverId,
      postId: args.postId,
      mentions: rule.mentions?.length ?? 0,
    });
  } catch (err) {
    log.warn('routing: modmail create failed', {
      err: err instanceof Error ? err.message : String(err),
      postId: args.postId,
    });
  }
}

function escapeMd(s: string): string {
  // Minimal modmail markdown escape — reddit treats body as markdown.
  return s.replace(/([\\`*_{}[\]()#+!\-|<>])/g, '\\$1');
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
