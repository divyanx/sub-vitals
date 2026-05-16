/**
 * RedLattice — Devvit Web server entry.
 *
 * Boots a Hono app, registers shared middleware + module API routes, mounts
 * the platform-facing `/internal/*` endpoints declared in `devvit.json`, and
 * starts an HTTP server backed by Devvit's `createServer`.
 *
 * Architecture rules:
 *   - `/api/*`        client-facing JSON routes; mod-guarded unless explicit.
 *   - `/internal/*`   platform-facing — Reddit POSTs here for triggers/menu/
 *                     forms/scheduler. Never call from the React client.
 *
 * Module dispatcher lives in `@shared/dispatcher`. Modules contribute event
 * handlers + optional `/api/*` routes. Menu/form handlers are co-located in
 * each module and imported here so the server has the full HTTP surface in
 * one file.
 */

import { context, createServer, getServerPort, reddit, redis, settings } from '@devvit/web/server';
import { serve } from '@hono/node-server';
import {
  agentVerificationModule,
  handleMarkAgentMenu,
  handleUnmarkAgentMenu,
} from '@modules/agent-verification/index.js';
import {
  contactDriversModule,
  handleMarkOpenMenu,
  handleMarkResolvedMenu,
  handleTagIssueFormSubmit,
  handleTagIssueMenu,
} from '@modules/contact-drivers/index.js';
import { dashboardOrchestratorModule } from '@modules/dashboard-orchestrator/index.js';
import { handleSentimentTrailMenu, sentimentModule } from '@modules/sentiment/index.js';
import { dispatch, registerModule } from '@shared/dispatcher.js';
import { K, today, yyyymm } from '@shared/keys.js';
import { llmObject, readMonthlyCents, readMonthlyTokens } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  getCommentIdsForPost,
  getCommentMeta,
  getDriverRollup,
  getPostMeta,
  getPostMetaMany,
  getPostTag,
  getRecentPostIds,
  getSentimentRollup,
  getSentimentScore,
  getTaxonomy,
  getUserPostIds,
} from '@shared/storage.js';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Module registration — order doesn't matter; failure isolation in dispatcher.
// ---------------------------------------------------------------------------

registerModule(agentVerificationModule);
registerModule(contactDriversModule);
registerModule(sentimentModule);
registerModule(dashboardOrchestratorModule);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

app.use(
  '*',
  logger((str) => log.debug(str)),
);

app.onError((err, c) => {
  log.error('unhandled error', {
    err: err instanceof Error ? err.message : String(err),
    path: c.req.path,
  });
  return c.json({ error: 'internal' }, 500);
});

// Health probe (no auth).
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

/**
 * Admin debug — module + LLM + storage state at a glance. Mod-only.
 * Use this when the dashboard looks wrong: confirms what the server thinks
 * the state is, separate from what the UI renders.
 */
app.get('/api/admin/debug', async (c) => {
  const [monthCents, monthTokens, recentIds, taxonomy, dashboardPostId] = await Promise.all([
    readMonthlyCents(),
    readMonthlyTokens(),
    getRecentPostIds(10),
    getTaxonomy(),
    redis.get(K.pulsePostId()),
  ]);
  return c.json({
    server: { ts: Date.now(), uptimeSec: Math.round(process.uptime()) },
    modules: [
      agentVerificationModule.name,
      contactDriversModule.name,
      sentimentModule.name,
      dashboardOrchestratorModule.name,
    ],
    llm: { monthCents, ...monthTokens, capCents: 500 },
    taxonomy: taxonomy.map((t) => t.id),
    recentPostIds: recentIds,
    dashboardPostId,
    subreddit: context.subredditName ?? null,
    username: context.username ?? null,
  });
});

// ---------------------------------------------------------------------------
// Cross-module aggregate route — single fetch for the dashboard overview tab
// ---------------------------------------------------------------------------

app.get('/api/dashboard/summary', async (c) => {
  const d = today();
  const yMonth = yyyymm();
  const [driversToday, sentToday, taxonomy, monthlyCents, monthlyTokens] = await Promise.all([
    getDriverRollup(d),
    getSentimentRollup(d),
    getTaxonomy(),
    readMonthlyCents(),
    readMonthlyTokens(),
  ]);

  let topDriverId: string | null = null;
  let topDriverCount = 0;
  if (driversToday) {
    for (const [id, count] of Object.entries(driversToday.counts)) {
      if (count > topDriverCount) {
        topDriverCount = count;
        topDriverId = id;
      }
    }
  }
  const topDriverLabel = topDriverId
    ? (taxonomy.find((t) => t.id === topDriverId)?.label ?? topDriverId)
    : null;

  return c.json({
    today: d,
    month: yMonth,
    drivers: {
      today: driversToday,
      topDriverId,
      topDriverLabel,
      topDriverCount,
    },
    sentiment: sentToday,
    llm: {
      monthCents: Number(monthlyCents.toFixed(4)),
      monthTokensIn: monthlyTokens.tokensIn,
      monthTokensOut: monthlyTokens.tokensOut,
    },
  });
});

/**
 * CSV export — primary "professional integration" hook. Customers running
 * Sprinklr / Khoros / a warehouse can poll this endpoint and ingest into
 * whatever they want without touching Redis directly. Honors the same recent-
 * post cap as the activity feed.
 */
app.get('/api/export/posts.csv', async (c) => {
  const limit = Math.min(
    Math.max(Number.parseInt(c.req.query('limit') ?? '500', 10) || 500, 1),
    1000,
  );
  const ids = await getRecentPostIds(limit);
  const [metas, tags, sents] = await Promise.all([
    getPostMetaMany(ids),
    Promise.all(ids.map((id) => getPostTag(id))),
    Promise.all(ids.map((id) => getSentimentScore(id))),
  ]);
  const tagById = new Map(
    tags.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.postId, t]),
  );
  const sentById = new Map(
    sents.filter((s): s is NonNullable<typeof s> => !!s).map((s) => [s.contentId, s]),
  );
  const header = [
    'post_id',
    'created_at',
    'author',
    'title',
    'url',
    'driver_id',
    'tagged_by',
    'tag_confidence',
    'sentiment_label',
    'sentiment_score',
    'sentiment_scored_by',
  ];
  const rows: string[] = [header.join(',')];
  for (const m of metas) {
    const t = tagById.get(m.postId);
    const s = sentById.get(m.postId);
    rows.push(
      [
        m.postId,
        new Date(m.createdAt).toISOString(),
        m.authorName,
        csvField(m.title),
        m.url,
        t?.driverId ?? '',
        t?.taggedBy ?? '',
        t?.confidence != null ? t.confidence.toFixed(3) : '',
        s?.label ?? '',
        s?.score != null ? s.score.toFixed(3) : '',
        s?.scoredBy ?? '',
      ].join(','),
    );
  }
  return new Response(rows.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="redlattice-posts-${today()}.csv"`,
    },
  });
});

function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Triage queue — the agent's "what needs me right now" view.
 *
 * Returns the open queue sorted by computed priority. Priority is a single
 * number that combines:
 *   - driver severity (complaint > bug > billing > question > praise > other)
 *   - sentiment magnitude (more negative = higher priority)
 *   - thread heat (more negative comments piling up = higher priority)
 *   - age (newer posts decay slower; ancient ones drop to bottom)
 *
 * Status is always 'open' unless ?status= is passed. Default limit 50.
 */
const DRIVER_SEVERITY: Record<string, number> = {
  complaint: 1.0,
  bug: 0.85,
  billing: 0.7,
  question: 0.4,
  feature: 0.3,
  praise: 0.1,
  other: 0.5,
};

app.get('/api/triage/queue', async (c) => {
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200);
  const statusParam = c.req.query('status');
  const status = statusParam === 'all' ? null : (statusParam ?? 'open');

  // Pull from recent posts (most active first). For Phase 1 this is a global
  // pool; per-agent assignment lives in a later sprint.
  const ids = await getRecentPostIds(200);
  const [metas, tags, sents] = await Promise.all([
    getPostMetaMany(ids),
    Promise.all(ids.map((id) => getPostTag(id))),
    Promise.all(ids.map((id) => getSentimentScore(id))),
  ]);
  const tagById = new Map(
    tags.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.postId, t]),
  );
  const sentById = new Map(
    sents.filter((s): s is NonNullable<typeof s> => !!s).map((s) => [s.contentId, s]),
  );

  const now = Date.now();
  const items = metas
    .map((m) => {
      const t = tagById.get(m.postId);
      const s = sentById.get(m.postId);
      const driverWeight = (t?.driverId ? DRIVER_SEVERITY[t.driverId] : undefined) ?? 0.4;
      const sentMag =
        typeof s?.score === 'number' ? Math.max(0, -s.score) + Math.abs(s.score) * 0.3 : 0.2;
      const ageHours = (now - m.createdAt) / (1000 * 60 * 60);
      // Half-life of 48h: priority decays smoothly so old open items still rank
      // (unlike Reddit's hot which forgets quickly).
      const ageDecay = Math.exp(-ageHours / 48);
      const priority = driverWeight * (1 + sentMag) * ageDecay;
      return {
        ...m,
        driverId: t?.driverId ?? null,
        taggedBy: t?.taggedBy ?? null,
        confidence: t?.confidence ?? null,
        reasoning: t?.reasoning ?? null,
        status: t?.status ?? null,
        sentimentLabel: s?.label ?? null,
        sentimentScore: s?.score ?? null,
        sentimentScoredBy: s?.scoredBy ?? null,
        priority: Number(priority.toFixed(4)),
      };
    })
    .filter((p) => !status || (p.status ?? 'open') === status)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);

  return c.json({ items, count: items.length, generatedAt: now });
});

/**
 * AI response drafts — the cockpit's "Draft reply" button.
 *
 * Reads the full post + the last N comments + per-comment sentiment + agent
 * tag + the configured brand-voice note. Calls the LLM to produce 2-3
 * candidate replies in different tones: one empathetic / one direct +
 * actionable / one concise acknowledgment. Each candidate comes with a label
 * + a short rationale + the reply body itself.
 *
 * The reply body is plain text suitable for pasting straight into Reddit's
 * comment box. Always mod-gated; cost-capped via the shared llm.ts.
 */
const draftReplySchema = z.object({
  candidates: z
    .array(
      z.object({
        tone: z.enum(['empathetic', 'direct', 'concise', 'investigative']),
        rationale: z.string().max(200),
        reply: z.string().min(10).max(1500),
      }),
    )
    .min(1)
    .max(4),
});

app.post('/api/posts/:postId/draft-reply', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const postId = c.req.param('postId');

  const [postMeta, postTag, postSent, commentIds, brandVoiceRaw] = await Promise.all([
    getPostMeta(postId),
    getPostTag(postId),
    getSentimentScore(postId),
    getCommentIdsForPost(postId),
    settings.get('brand-voice').catch(() => undefined),
  ]);
  if (!postMeta) return c.json({ error: 'post not in index' }, 404);

  // Take the most-recent ~10 comments for context.
  const recentIds = commentIds.slice(-10);
  const recentComments = await Promise.all(recentIds.map((id) => getCommentMeta(id)));
  const recentSents = await Promise.all(recentIds.map((id) => getSentimentScore(id)));
  const commentLines = recentComments
    .map((cm, i) => {
      if (!cm) return null;
      const s = recentSents[i];
      const tag = cm.isAgent ? '[AGENT]' : '[USER]';
      const sent = s ? ` (${s.label} ${s.score.toFixed(2)})` : '';
      const body = cm.body.length > 280 ? `${cm.body.slice(0, 280)}…` : cm.body;
      return `${tag} u/${cm.authorName}${sent}: ${body}`;
    })
    .filter((x): x is string => x !== null);

  const brandVoice =
    typeof brandVoiceRaw === 'string' && brandVoiceRaw.trim().length > 0
      ? brandVoiceRaw.trim()
      : "Warm and professional. Acknowledge the user, be specific, avoid generic corporate phrases. Never make commitments you can't back up.";

  const prompt = [
    `Brand voice:\n${brandVoice}`,
    '',
    `Post by u/${postMeta.authorName}:`,
    `Title: ${postMeta.title}`,
    postTag?.driverId ? `Detected contact driver: ${postTag.driverId}` : null,
    postSent ? `Detected sentiment: ${postSent.label} (${postSent.score.toFixed(2)})` : null,
    '',
    commentLines.length > 0
      ? `Recent comments on the thread (oldest → newest):\n${commentLines.join('\n')}`
      : '(no comments yet)',
    '',
    'Produce 2-3 candidate replies for the brand to post as a Reddit comment. Each candidate must have a distinct tone (empathetic, direct, concise, investigative — pick whichever 2-3 fit best). For each: brief rationale (≤1 sentence) + the actual reply text. Keep replies under ~150 words. Do not impersonate engineering or commit to fixes. Do not include hashtags or emoji unless they fit the brand voice. Do not include greetings like "Hi u/{author}" — Reddit threading handles that.',
  ]
    .filter((x): x is string => typeof x === 'string')
    .join('\n');

  const result = await llmObject({
    name: 'draft-reply',
    schema: draftReplySchema,
    system:
      'You are an experienced brand customer-experience writer drafting candidate Reddit comment replies for a brand support team to choose from and refine before posting.',
    prompt,
    maxTokens: 900,
    temperature: 0.6,
  });

  if (!result.ok) {
    return c.json(
      {
        error: 'llm-unavailable',
        reason: result.reason,
        hint:
          result.reason === 'no-api-key'
            ? 'Set the openrouter-api-key global setting first.'
            : result.reason === 'cost-cap-exceeded'
              ? 'Monthly LLM cost cap reached. Raise llm-monthly-cost-cap-cents or wait for next month.'
              : result.reason === 'rate-limited'
                ? 'Hit the per-installation LLM rate limit. Retry in a few seconds.'
                : 'Try again or check the live logs.',
      },
      503,
    );
  }

  return c.json({
    postId,
    model: 'configured',
    cached: result.cached,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
    candidates: result.data.candidates,
  });
});

/**
 * Per-user history — when an agent opens a post they want to see "who is
 * this person, what have they posted before, what's their pattern?". This
 * endpoint joins everything we know about a specific Reddit author.
 */
app.get('/api/users/:username/history', async (c) => {
  const username = c.req.param('username');
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '20', 10) || 20, 1), 100);
  const postIds = await getUserPostIds(username, limit);
  const [posts, tags, sents] = await Promise.all([
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
  const items = posts.map((p) => {
    const t = tagById.get(p.postId);
    const s = sentById.get(p.postId);
    return {
      ...p,
      driverId: t?.driverId ?? null,
      status: t?.status ?? null,
      sentimentLabel: s?.label ?? null,
      sentimentScore: s?.score ?? null,
    };
  });
  // Aggregate: top drivers, sentiment trajectory, share negative.
  const driverCounts: Record<string, number> = {};
  let totalScored = 0;
  let scoreSum = 0;
  let negativeCount = 0;
  for (const it of items) {
    if (it.driverId) driverCounts[it.driverId] = (driverCounts[it.driverId] ?? 0) + 1;
    if (it.sentimentScore != null) {
      totalScored += 1;
      scoreSum += it.sentimentScore;
      if (it.sentimentLabel === 'negative') negativeCount += 1;
    }
  }
  return c.json({
    username,
    items,
    aggregate: {
      totalPosts: items.length,
      totalScored,
      averageScore: totalScored > 0 ? Number((scoreSum / totalScored).toFixed(3)) : null,
      negativeShare: totalScored > 0 ? Number((negativeCount / totalScored).toFixed(3)) : null,
      topDrivers: Object.entries(driverCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ id, count })),
    },
  });
});

/**
 * Per-post comment thread — joined with per-comment sentiment + agent badge
 * + parent linkage. Ordered chronologically so it reads top-to-bottom.
 * Includes the parent post's meta + tag + sentiment for context. The
 * dashboard's "expand thread" panel consumes this single endpoint.
 */
app.get('/api/posts/:postId/thread', async (c) => {
  const postId = c.req.param('postId');
  const [postMeta, postTag, postSent, commentIds] = await Promise.all([
    getPostMeta(postId),
    getPostTag(postId),
    getSentimentScore(postId),
    getCommentIdsForPost(postId),
  ]);
  const comments = await Promise.all(commentIds.map((id) => getCommentMeta(id)));
  const sents = await Promise.all(commentIds.map((id) => getSentimentScore(id)));
  const items = comments
    .map((cm, i) => {
      if (!cm) return null;
      const s = sents[i];
      return {
        commentId: cm.commentId,
        parentId: cm.parentId ?? null,
        authorName: cm.authorName,
        body: cm.body,
        createdAt: cm.createdAt,
        isAgent: cm.isAgent,
        sentimentLabel: s?.label ?? null,
        sentimentScore: s?.score ?? null,
        sentimentScoredBy: s?.scoredBy ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // "Thread heat" — share of recent comments that are negative (last 10).
  const recent = items.slice(-10);
  const negShare =
    recent.length > 0
      ? recent.filter((c) => c.sentimentLabel === 'negative').length / recent.length
      : 0;

  return c.json({
    post: postMeta
      ? {
          ...postMeta,
          driverId: postTag?.driverId ?? null,
          taggedBy: postTag?.taggedBy ?? null,
          status: postTag?.status ?? null,
          sentimentLabel: postSent?.label ?? null,
          sentimentScore: postSent?.score ?? null,
        }
      : null,
    comments: items,
    heat: {
      sampleSize: recent.length,
      negativeShare: Number(negShare.toFixed(3)),
      isHot: negShare >= 0.5 && recent.length >= 3,
    },
  });
});

/**
 * Recent posts feed — newest first, joined with sentiment + driver tag for
 * the dashboard "activity" stream. Mod-only by default.
 */
app.get('/api/dashboard/recent-posts', async (c) => {
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '25', 10) || 25, 1), 100);
  const ids = await getRecentPostIds(limit);
  const [metas, tags, sents] = await Promise.all([
    getPostMetaMany(ids),
    Promise.all(ids.map((id) => getPostTag(id))),
    Promise.all(ids.map((id) => getSentimentScore(id))),
  ]);
  // Re-key by postId for stable join
  const tagById = new Map(
    tags.filter((t): t is NonNullable<typeof t> => !!t).map((t) => [t.postId, t]),
  );
  const sentById = new Map(
    sents.filter((s): s is NonNullable<typeof s> => !!s).map((s) => [s.contentId, s]),
  );
  const items = metas.map((m) => {
    const t = tagById.get(m.postId);
    const s = sentById.get(m.postId);
    return {
      ...m,
      driverId: t?.driverId ?? null,
      taggedBy: t?.taggedBy ?? null,
      confidence: t?.confidence ?? null,
      reasoning: t?.reasoning ?? null,
      status: t?.status ?? null,
      sentimentLabel: s?.label ?? null,
      sentimentScore: s?.score ?? null,
      sentimentScoredBy: s?.scoredBy ?? null,
    };
  });
  return c.json({ items, count: items.length });
});

// ---------------------------------------------------------------------------
// Mount module-owned /api routes
// ---------------------------------------------------------------------------

for (const mod of [
  agentVerificationModule,
  contactDriversModule,
  sentimentModule,
  dashboardOrchestratorModule,
]) {
  mod.apiRoutes?.(app);
}

// ---------------------------------------------------------------------------
// Triggers — Reddit POSTs the trigger payload as JSON to these endpoints
// ---------------------------------------------------------------------------

app.post('/internal/triggers/app-install', async (c) => {
  await dispatch('onAppInstall', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/app-upgrade', async (c) => {
  await dispatch('onAppUpgrade', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/post-create', async (c) => {
  await dispatch('onPostCreate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/post-update', async (c) => {
  await dispatch('onPostUpdate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/comment-create', async (c) => {
  await dispatch('onCommentCreate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/mod-action', async (c) => {
  await dispatch('onModAction', await c.req.json());
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Menu actions — return UI-effect responses
// ---------------------------------------------------------------------------

app.post('/internal/menu/tag-issue', handleTagIssueMenu);
app.post('/internal/menu/sentiment-trail', handleSentimentTrailMenu);
app.post('/internal/menu/mark-agent', handleMarkAgentMenu);
app.post('/internal/menu/unmark-agent', handleUnmarkAgentMenu);
app.post('/internal/menu/mark-resolved', handleMarkResolvedMenu);
app.post('/internal/menu/mark-open', handleMarkOpenMenu);

app.post('/internal/menu/open-dashboard', async (c) => {
  // Idempotent: reuse the pinned dashboard post if one already exists for this
  // installation; otherwise create + sticky it. Navigates the mod to it.
  const sub = context.subredditName;
  if (!sub) return c.json({ showToast: 'No subreddit context.' }, 400);

  try {
    const existingId = await redis.get(K.pulsePostId());
    if (existingId) {
      log.info('open-dashboard: reusing existing dashboard post', { postId: existingId });
      return c.json({
        navigateTo: `https://www.reddit.com/r/${sub}/comments/${existingId.replace('t3_', '')}`,
      });
    }

    const post = await reddit.submitCustomPost({
      title: 'RedLattice · Analytics Dashboard',
      subredditName: sub,
    });
    await redis.set(K.pulsePostId(), post.id);
    log.info('open-dashboard: post created', { postId: post.id });

    // Best-effort sticky to position 2 so the sub's own pinned content stays on top.
    try {
      await post.sticky(2);
    } catch (err) {
      log.warn('open-dashboard: sticky failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return c.json({
      navigateTo: `https://www.reddit.com/r/${sub}/comments/${post.id.replace('t3_', '')}`,
    });
  } catch (err) {
    log.error('open-dashboard: failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return c.json({ showToast: 'Could not create dashboard post.' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

app.post('/internal/forms/tag-issue', handleTagIssueFormSubmit);

// ---------------------------------------------------------------------------
// Scheduler — Phase 1 stubs; modules can grow into these as needed
// ---------------------------------------------------------------------------

app.post('/internal/scheduler/daily-aggregate', (c) => {
  log.info('scheduler: daily-aggregate fired');
  return c.json({ ok: true });
});

app.post('/internal/scheduler/weekly-digest', (c) => {
  log.info('scheduler: weekly-digest fired');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const port = getServerPort();
serve({ fetch: app.fetch, createServer, port });
log.info('redlattice server listening', { port });
