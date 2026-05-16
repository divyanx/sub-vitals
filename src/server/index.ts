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

import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { serve } from '@hono/node-server';
import {
  agentVerificationModule,
  handleMarkAgentMenu,
  handleUnmarkAgentMenu,
} from '@modules/agent-verification/index.js';
import {
  contactDriversModule,
  handleTagIssueFormSubmit,
  handleTagIssueMenu,
} from '@modules/contact-drivers/index.js';
import { dashboardOrchestratorModule } from '@modules/dashboard-orchestrator/index.js';
import { handleSentimentTrailMenu, sentimentModule } from '@modules/sentiment/index.js';
import { dispatch, registerModule } from '@shared/dispatcher.js';
import { K, today, yyyymm } from '@shared/keys.js';
import { readMonthlyCents, readMonthlyTokens } from '@shared/llm.js';
import { log } from '@shared/log.js';
import {
  getDriverRollup,
  getPostMetaMany,
  getPostTag,
  getRecentPostIds,
  getSentimentRollup,
  getSentimentScore,
  getTaxonomy,
} from '@shared/storage.js';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

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
