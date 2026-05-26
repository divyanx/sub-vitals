/**
 * SubVitals — Devvit Web server entry.
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
import { agentMetricsModule } from '@modules/agent-metrics/index.js';
import {
  agentVerificationModule,
  handleMarkAgentMenu,
  handleUnmarkAgentMenu,
} from '@modules/agent-verification/index.js';
import { auditLogModule, recordAudit } from '@modules/audit-log/index.js';
import {
  contactDriversModule,
  handleMarkOpenMenu,
  handleMarkResolvedMenu,
  handleTagIssueFormSubmit,
  handleTagIssueMenu,
} from '@modules/contact-drivers/index.js';
import { copilotModule } from '@modules/copilot/index.js';
import {
  autoResolveQuietIncidents,
  crisisDetectionModule,
} from '@modules/crisis-detection/index.js';
import { dashboardOrchestratorModule } from '@modules/dashboard-orchestrator/index.js';
import { dataLabModule } from '@modules/data-lab/index.js';
import { genericPipelineRunnerModule } from '@modules/generic-pipeline-runner/index.js';
import { impostorDetectionModule } from '@modules/impostor-detection/index.js';
import { rulesModule } from '@modules/rules/index.js';
import { handleSentimentTrailMenu, sentimentModule } from '@modules/sentiment/index.js';
import { studioBridgeModule } from '@modules/studio-bridge/index.js';
import { regenerateThemes, themeClusteringModule } from '@modules/theme-clustering/index.js';
import * as Sentry from '@sentry/core';
import {
  CURATED_MODELS,
  DEFAULT_MODEL,
  findModel,
  isStructuredOutputCapable,
} from '@shared/ai-models.js';
import { buildWeeklyDigest, gatherDigestStats } from '@shared/digest.js';
import { dispatch, registerModule } from '@shared/dispatcher.js';
import { K, today, yyyymm } from '@shared/keys.js';
import {
  clearFallback,
  getEffectiveModel,
  getFallbackOriginalSlug,
  llmObject,
  readMonthlyCents,
  readMonthlyTokens,
} from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  createScratchInstance,
  deleteInstance,
  duplicateInstance,
  getInstance,
  installFromTemplate,
  listInstances,
  patchInstance,
  reorderInstances,
  seedInstancesIfNeeded,
} from '@shared/pipeline-instances.js';
import {
  type CustomPipeline,
  deleteCustomPipeline,
  getCustomPipeline,
  getEffectiveOverrides,
  listAllPipelines,
  listCustomPipelines,
  listEnabledPipelines,
  type PipelineOverrides,
  saveCustomPipeline,
  saveOverrides,
  setPipelineOrder,
} from '@shared/pipeline-overrides.js';
import { PIPELINE_TEMPLATES } from '@shared/pipeline-templates.js';
import {
  readAllEffectiveSettings,
  readEffectiveSetting,
  writeOverrideSetting,
} from '@shared/settings-overrides.js';
import {
  getActiveIncidentId,
  getCommentIdsForPost,
  getCommentMeta,
  getDriverRollup,
  getIncident,
  getLastDigestSentAt,
  getPostMeta,
  getPostMetaMany,
  getPostTag,
  getRecentPostIds,
  getSentimentRollup,
  getSentimentScore,
  getTaxonomy,
  getUserPostIds,
  listIncidentIds,
  setLastDigestSentAt,
  setPostStatus,
  setPostTag,
  setTaxonomy,
} from '@shared/storage.js';
import { forwardToStudio } from '@shared/studio-bridge.js';
import { getTagDistribution, getTargetsByTagValue } from '@shared/tags.js';
import ecommerceTemplate from '@shared/taxonomy-templates/ecommerce.json';
import financeTemplate from '@shared/taxonomy-templates/finance.json';
import gamingTemplate from '@shared/taxonomy-templates/gaming.json';
import hardwareTemplate from '@shared/taxonomy-templates/hardware.json';
import mediaTemplate from '@shared/taxonomy-templates/media.json';
import saasTemplate from '@shared/taxonomy-templates/saas.json';
import {
  routingRulesSchema,
  settingsUpdateSchema,
  taxonomyArraySchema,
} from '@shared/validation.js';
import {
  deleteWebhook,
  deliverWebhook,
  detectFormat,
  getDeliveries,
  getWebhook,
  listWebhooks,
  saveWebhook,
  type Webhook,
  type WebhookFormat,
} from '@shared/webhook-delivery.js';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Module registration — order doesn't matter; failure isolation in dispatcher.
// ---------------------------------------------------------------------------

registerModule(agentVerificationModule);
// Executes ANY catalogue-installed / scratch pipeline instance on its
// configured trigger. Skips templates owned by a hardcoded module to avoid
// double-tagging.
registerModule(genericPipelineRunnerModule);
registerModule(contactDriversModule);
registerModule(sentimentModule);
registerModule(dashboardOrchestratorModule);
registerModule(dataLabModule);
registerModule(impostorDetectionModule);
registerModule(crisisDetectionModule);
registerModule(themeClusteringModule);
registerModule(agentMetricsModule);
registerModule(auditLogModule);
registerModule(rulesModule);
registerModule(copilotModule);
registerModule(studioBridgeModule);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

// NB: do NOT add hono/compress here — Devvit's webview gateway handles
// transport encoding itself, and adding Content-Encoding: gzip inside Hono
// causes net::ERR_CONTENT_DECODING_FAILED in the iframe runtime.

app.use(
  '*',
  logger((str) => log.debug(str)),
);

app.onError((err, c) => {
  // Capture to Sentry when SENTRY_DSN is configured; no-ops otherwise.
  Sentry.captureException(err);
  log.error('unhandled error', {
    err: err instanceof Error ? err.message : String(err),
    path: c.req.path,
  });
  return c.json({ error: 'internal' }, 500);
});

// Health probe (no auth).
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

/**
 * GET /api/me — caller identity + mod status. NOT mod-gated, so the
 * React shell can render a friendly "mods only" landing for non-mods
 * instead of letting them see broken loading states from 403'd calls.
 *
 * Anonymous viewers (rare in Devvit webviews) get isMod:false. Failure
 * paths fail closed (isMod:false) so we never accidentally grant
 * access when something hiccups.
 */
app.get('/api/me', async (c) => {
  try {
    const { isCurrentUserMod } = await import('@shared/permissions.js');
    const isMod = await isCurrentUserMod();
    let username: string | null = null;
    try {
      const u = await reddit.getCurrentUser();
      username = u?.username ?? null;
    } catch {
      /* anonymous / context hiccup — leave null */
    }
    return c.json({
      isMod,
      username,
      subredditName: context.subredditName ?? null,
    });
  } catch {
    return c.json({ isMod: false, username: null, subredditName: null });
  }
});

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
 * Pulse stats — 7-day sentiment rollup + active incident count, purpose-built
 * for the native Blocks Daily Pulse view.
 *
 * Aggregates the last 7 days of sentiment data (positive/neutral/negative) plus
 * today's top driver and the active incident count so the Pulse view can render
 * a mini trend chart without a round-trip to /api/dashboard/summary.
 *
 * No auth required — the Pulse post is publicly visible in the subreddit.
 */
app.get('/api/dashboard/pulse-stats', async (c) => {
  const d = today();
  const DAYS = 7;

  // Build the date range for the last 7 days ending today
  const dates: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - i);
    dates.push(dt.toISOString().slice(0, 10));
  }

  const [rollups, driversToday, taxonomy, activeIncidentId] = await Promise.all([
    Promise.all(dates.map((date) => getSentimentRollup(date))),
    getDriverRollup(d),
    getTaxonomy(),
    getActiveIncidentId(),
  ]);

  // Sentiment trend: one entry per day, null-safe defaults
  const sentimentTrend = dates.map((date, i) => {
    const r = rollups[i];
    return {
      date,
      positive: r?.positive ?? 0,
      neutral: r?.neutral ?? 0,
      negative: r?.negative ?? 0,
      total: r?.total ?? 0,
      averageScore: r?.averageScore ?? 0,
    };
  });

  // Today's totals (last entry in trend)
  const todayRollup = rollups[DAYS - 1];
  const todayTotal = todayRollup?.total ?? 0;
  const todayNegative = todayRollup?.negative ?? 0;
  const todayNegativeShare =
    todayTotal > 0 ? Number((todayNegative / todayTotal).toFixed(3)) : null;

  // Yesterday's share for trend arrow
  const yesterdayRollup = rollups[DAYS - 2];
  const yesterdayTotal = yesterdayRollup?.total ?? 0;
  const yesterdayNegative = yesterdayRollup?.negative ?? 0;
  const yesterdayNegativeShare =
    yesterdayTotal > 0 ? Number((yesterdayNegative / yesterdayTotal).toFixed(3)) : null;

  // Negative share trend: 'up' (getting worse), 'down' (improving), 'flat'
  let negativeShareTrend: 'up' | 'down' | 'flat' = 'flat';
  if (todayNegativeShare !== null && yesterdayNegativeShare !== null) {
    const delta = todayNegativeShare - yesterdayNegativeShare;
    if (delta > 0.02) negativeShareTrend = 'up';
    else if (delta < -0.02) negativeShareTrend = 'down';
  }

  // Top driver today
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

  // Active incidents — count open ones from the archive list
  let activeIncidentCount = 0;
  if (activeIncidentId) {
    // Check if the active incident is still open
    const incident = await getIncident(activeIncidentId);
    if (incident && incident.status === 'open') {
      activeIncidentCount = 1;
    }
  }
  // Also scan recent incidents for any open ones (covers edge cases where
  // incidentActive key expired but incident itself wasn't resolved)
  try {
    const recentIds = await listIncidentIds(10);
    const recentIncidents = await Promise.all(recentIds.map((id) => getIncident(id)));
    const openCount = recentIncidents.filter((i) => i && i.status === 'open').length;
    // Use the higher of the two counts (avoid double-counting the activeIncidentId)
    activeIncidentCount = Math.max(activeIncidentCount, openCount);
  } catch {
    // Non-fatal; activeIncidentCount stays as computed above
  }

  return c.json({
    today: d,
    postsToday: driversToday?.totalPosts ?? 0,
    topDriver: {
      id: topDriverId,
      label: topDriverLabel,
      count: topDriverCount,
    },
    negativeShare: todayNegativeShare,
    negativeShareTrend,
    activeIncidents: activeIncidentCount,
    sentimentTrend,
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
      'content-disposition': `attachment; filename="sub-vitals-posts-${today()}.csv"`,
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
  const [rawIds, dashboardPostId] = await Promise.all([
    getRecentPostIds(200),
    redis.get(K.pulsePostId()),
  ]);
  // Exclude SubVitals's own dashboard post — it's a system post, not
  // customer content, and clicking actions on it 404s.
  const ids = rawIds.filter((id) => id !== dashboardPostId);
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
    readEffectiveSetting<string>('brand-voice'),
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
              ? 'Monthly AI cost cap reached. Raise llm-monthly-cost-cap-cents or wait for next month.'
              : result.reason === 'rate-limited'
                ? 'Hit the per-installation AI rate limit. Retry in a few seconds.'
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
        agentSource: cm.agentSource ?? null,
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
  // Same exclusion as the triage queue — system posts pollute the feed.
  const [rawIds, dashboardPostId] = await Promise.all([
    getRecentPostIds(limit + 5),
    redis.get(K.pulsePostId()),
  ]);
  const ids = rawIds.filter((id) => id !== dashboardPostId).slice(0, limit);
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
// Pipeline routes — built-in tuning + custom pipeline CRUD
// ---------------------------------------------------------------------------

const pipelineOverridesPutSchema = z.object({
  systemPrompt: z.string().max(4000).optional(),
  userPrompt: z.string().max(4000).optional(),
  thresholds: z.record(z.string(), z.number()).optional(),
  enabled: z.boolean().optional(),
});

// Hardcoded-module pipeline IDs. These store their overrides in the legacy
// pipeline-overrides keyspace. Catalogue-installed instances (pi_*) store
// their config inside the PipelineInstance record itself.
const HARDCODED_PIPELINE_IDS = new Set([
  'contact-drivers',
  'sentiment',
  'impostor',
  'crisis',
  'themes',
  'agent-metrics',
]);

/**
 * Resolve a pipeline id to its effective config, whether it's a hardcoded
 * module (legacy overrides table) or a catalogue/scratch instance (pi_*).
 * Returns null if the id matches nothing.
 */
async function resolvePipelineConfig(id: string): Promise<{
  systemPrompt: string;
  userPrompt: string;
  outputSchema?: string;
  labels?: string[] | undefined;
  trigger?: string;
  enabled?: boolean;
  source: 'hardcoded' | 'instance';
} | null> {
  if (HARDCODED_PIPELINE_IDS.has(id)) {
    const overrides = await getEffectiveOverrides(id);
    return {
      systemPrompt: overrides.systemPrompt ?? '',
      userPrompt: overrides.userPrompt ?? '{{post.body}}',
      source: 'hardcoded',
    };
  }
  const inst = await getInstance(id);
  if (!inst) return null;
  return {
    systemPrompt: inst.config.systemPrompt,
    userPrompt: inst.config.userPrompt,
    outputSchema: inst.config.outputSchema,
    labels: inst.config.labels,
    trigger: inst.config.trigger,
    enabled: inst.enabled,
    source: 'instance',
  };
}

/**
 * GET /api/pipelines/builtin/:id — returns merged config for either a
 * hardcoded module or a catalogue-installed / scratch instance.
 */
app.get('/api/pipelines/builtin/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const cfg = await resolvePipelineConfig(id);
  if (!cfg) return c.json({ error: 'unknown pipeline id' }, 404);
  // Keep the legacy `overrides` envelope so the existing client code
  // continues to read `data.overrides.systemPrompt` / `userPrompt` etc.
  return c.json({
    id,
    overrides: {
      systemPrompt: cfg.systemPrompt,
      userPrompt: cfg.userPrompt,
      ...(cfg.outputSchema ? { outputSchema: cfg.outputSchema } : {}),
      ...(cfg.labels ? { labels: cfg.labels } : {}),
      ...(cfg.trigger ? { trigger: cfg.trigger } : {}),
      ...(cfg.enabled !== undefined ? { enabled: cfg.enabled } : {}),
    },
  });
});

/**
 * PUT /api/pipelines/builtin/:id — save overrides for either a hardcoded
 * module or a catalogue-installed instance.
 */
app.put('/api/pipelines/builtin/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const parsed = pipelineOverridesPutSchema.safeParse(rawBody);
  if (!parsed.success)
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  if (HARDCODED_PIPELINE_IDS.has(id)) {
    const merged = await saveOverrides(id, parsed.data as Partial<PipelineOverrides>);
    return c.json({ id, overrides: merged });
  }

  // Instance path: patch the instance's config in place.
  const inst = await getInstance(id);
  if (!inst) return c.json({ error: 'unknown pipeline id' }, 404);
  const next: typeof inst.config = { ...inst.config };
  if (parsed.data.systemPrompt !== undefined) next.systemPrompt = parsed.data.systemPrompt;
  if (parsed.data.userPrompt !== undefined) next.userPrompt = parsed.data.userPrompt;
  const enabled = parsed.data.enabled ?? inst.enabled;
  const patched = await patchInstance(id, { config: next, enabled });
  if (!patched) return c.json({ error: 'patch failed' }, 500);
  return c.json({
    id,
    overrides: {
      systemPrompt: patched.config.systemPrompt,
      userPrompt: patched.config.userPrompt,
      outputSchema: patched.config.outputSchema,
      labels: patched.config.labels,
      trigger: patched.config.trigger,
      enabled: patched.enabled,
    },
  });
});

/**
 * POST /api/pipelines/builtin/:id/test — run any pipeline once without
 * persisting. Works for hardcoded modules and installed instances.
 */
app.post('/api/pipelines/builtin/:id/test', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const cfg = await resolvePipelineConfig(id);
  if (!cfg) return c.json({ error: 'unknown pipeline id' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const bodySchema = z.object({ sampleInput: z.string().min(1).max(3000) });
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'sampleInput required' }, 400);

  const systemPrompt =
    cfg.systemPrompt ||
    `You are a SubVitals pipeline running ${id}. Analyze the input and respond concisely.`;
  const userPromptTemplate = cfg.userPrompt || '{{post.body}}';
  const prompt = userPromptTemplate
    .replace(/\{\{\s*post\.title\s*\}\}/g, '')
    .replace(/\{\{\s*post\.body\s*\}\}/g, parsed.data.sampleInput)
    .replace(/\{\{\s*comment\.body\s*\}\}/g, parsed.data.sampleInput);

  // .nullable() not .optional() — OpenAI's strict structured-output mode
  // rejects properties missing from `required`, which is what .optional()
  // produces. The model returns null when it has nothing to say.
  const testSchema = z.object({ output: z.string(), label: z.string().nullable() });
  const result = await llmObject({
    name: `pipeline-test-${id}`,
    schema: testSchema,
    system: systemPrompt,
    prompt,
    maxTokens: 300,
  });

  if (!result.ok) {
    return c.json({ error: result.reason ?? 'llm-unavailable', reason: result.reason }, 503);
  }

  return c.json({
    id,
    output: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
  });
});

// Custom pipeline schemas
const customPipelineActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tag-driver'), driverId: z.string().min(1) }),
  z.object({ type: z.literal('send-modmail'), bodyTemplate: z.string().min(1).max(2000) }),
  z.object({
    type: z.literal('set-status'),
    status: z.enum(['open', 'in-progress', 'resolved']),
  }),
]);

const customPipelineBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  kind: z.enum(['categorical', 'ordinal', 'cluster', 'scalar', 'boolean']).default('categorical'),
  trigger: z.enum(['post-create', 'comment-create']),
  systemPrompt: z.string().min(1).max(4000),
  userPrompt: z.string().min(1).max(4000),
  outputSchema: z.enum(['single-label', 'label-confidence', 'boolean', 'scalar', 'cluster']),
  labels: z.array(z.string().min(1).max(100)).max(50).optional(),
  action: customPipelineActionSchema,
});

/**
 * GET /api/pipelines/custom — list custom pipelines
 */
app.get('/api/pipelines/custom', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const pipelines = await listCustomPipelines();
  return c.json({ count: pipelines.length, pipelines });
});

/**
 * POST /api/pipelines/custom — create a custom pipeline
 */
app.post('/api/pipelines/custom', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const parsed = customPipelineBodySchema.safeParse(rawBody);
  if (!parsed.success)
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  // Generate a short ID (8 chars, alphanumeric)
  const id = `cp_${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const { labels, ...rest } = parsed.data;
  const pipeline: CustomPipeline = {
    id,
    ...rest,
    createdAt: now,
    updatedAt: now,
    ...(labels !== undefined ? { labels } : {}),
  };
  await saveCustomPipeline(pipeline);
  return c.json({ pipeline }, 201);
});

/**
 * PUT /api/pipelines/custom/:id — update a custom pipeline
 */
app.put('/api/pipelines/custom/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const existing = await getCustomPipeline(id);
  if (!existing) return c.json({ error: 'not found' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  const parsed = customPipelineBodySchema.partial().safeParse(rawBody);
  if (!parsed.success)
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  // Merge partial update onto existing — all required fields come from existing
  const updated: CustomPipeline = {
    ...existing,
    ...(parsed.data as Partial<CustomPipeline>),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await saveCustomPipeline(updated);
  return c.json({ pipeline: updated });
});

/**
 * DELETE /api/pipelines/custom/:id — delete a custom pipeline
 */
app.delete('/api/pipelines/custom/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const existing = await getCustomPipeline(id);
  if (!existing) return c.json({ error: 'not found' }, 404);
  await deleteCustomPipeline(id);
  return c.json({ ok: true });
});

/**
 * POST /api/pipelines/custom/:id/test — run a custom pipeline once
 */
app.post('/api/pipelines/custom/:id/test', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const pipeline = await getCustomPipeline(id);
  if (!pipeline) return c.json({ error: 'not found' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const bodySchema = z.object({ sampleInput: z.string().min(1).max(3000) });
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'sampleInput required' }, 400);

  const prompt = pipeline.userPrompt.replace('{{post.body}}', parsed.data.sampleInput);
  // .nullable() not .optional() — see comment in the /builtin/:id/test
  // endpoint above. OpenAI strict mode rejects optional properties.
  const testSchema = z.object({ output: z.string(), label: z.string().nullable() });
  const result = await llmObject({
    name: `custom-pipeline-test-${id}`,
    schema: testSchema,
    system: pipeline.systemPrompt,
    prompt,
    maxTokens: 300,
  });

  if (!result.ok) {
    return c.json({ error: result.reason ?? 'llm-unavailable', reason: result.reason }, 503);
  }

  return c.json({
    id,
    output: result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
  });
});

// ---------------------------------------------------------------------------
// Dynamic pipeline catalog endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/pipelines/all — returns builtin + custom, merged, sorted by order.
 */
app.get('/api/pipelines/all', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const pipelines = await listAllPipelines();
  return c.json({ count: pipelines.length, pipelines });
});

/**
 * GET /api/pipelines/enabled — filtered to enabled only.
 */
app.get('/api/pipelines/enabled', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const pipelines = await listEnabledPipelines();
  return c.json({ count: pipelines.length, pipelines });
});

/**
 * PATCH /api/pipelines/:id/order — set display order for a pipeline.
 */
app.patch('/api/pipelines/:id/order', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const parsed = z.object({ order: z.number().int().min(0) }).safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'order (integer) required' }, 400);
  await setPipelineOrder(id, parsed.data.order);
  return c.json({ ok: true, id, order: parsed.data.order });
});

/**
 * GET /api/tags/distribution?pipelineId=&days= — returns [{value, count}] for chart rendering.
 * For builtin pipelines with known labels, uses those. For custom, uses provided labels query param.
 */
app.get('/api/tags/distribution', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const pipelineId = c.req.query('pipelineId');
  if (!pipelineId) return c.json({ error: 'pipelineId required' }, 400);
  const labelsParam = c.req.query('labels');
  const knownLabels = labelsParam ? labelsParam.split(',').filter(Boolean) : [];
  const distribution = await getTagDistribution(pipelineId, knownLabels);
  return c.json({ pipelineId, distribution });
});

/**
 * GET /api/tags/posts?pipelineId=&value=&limit= — returns posts with that tag value.
 */
app.get('/api/tags/posts', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const pipelineId = c.req.query('pipelineId');
  const value = c.req.query('value');
  if (!pipelineId || !value) return c.json({ error: 'pipelineId and value required' }, 400);
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const postIds = await getTargetsByTagValue(pipelineId, value, limit);
  const posts = await getPostMetaMany(postIds);
  return c.json({ pipelineId, value, count: posts.length, posts });
});

// ---------------------------------------------------------------------------
// Pipeline Templates + Instances API  (new unified model)
// ---------------------------------------------------------------------------

/**
 * GET /api/templates — list all pipeline templates from catalogue.
 */
app.get('/api/templates', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  return c.json({ count: PIPELINE_TEMPLATES.length, templates: PIPELINE_TEMPLATES });
});

/**
 * GET /api/pipelines/instances — list all installed instances (seeds if needed).
 */
app.get('/api/pipelines/instances', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const instances = await listInstances();
  return c.json({ count: instances.length, instances });
});

const instanceFromTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  configOverrides: z
    .object({
      trigger: z.enum(['post-create', 'comment-create', 'status-change', 'scheduled']).optional(),
      systemPrompt: z.string().max(4000).optional(),
      userPrompt: z.string().max(4000).optional(),
      outputSchema: z
        .enum(['single-label', 'label-confidence', 'boolean', 'scalar', 'cluster'])
        .optional(),
      labels: z.array(z.string().min(1).max(100)).max(50).optional(),
      threshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
  showIn: z.array(z.enum(['insights', 'incidents', 'team', 'audit'])).optional(),
});

const instanceFromScratchSchema = z.object({
  name: z.string().min(1).max(100),
  kind: z.enum(['categorical', 'ordinal', 'cluster', 'scalar', 'boolean']),
  config: z.object({
    trigger: z.enum(['post-create', 'comment-create', 'status-change', 'scheduled']),
    systemPrompt: z.string().min(1).max(4000),
    userPrompt: z.string().min(1).max(4000),
    outputSchema: z.enum(['single-label', 'label-confidence', 'boolean', 'scalar', 'cluster']),
    labels: z.array(z.string().min(1).max(100)).max(50).optional(),
    threshold: z.number().min(0).max(1).optional(),
  }),
  showIn: z.array(z.enum(['insights', 'incidents', 'team', 'audit'])).optional(),
});

/**
 * POST /api/pipelines/instances — install from template or create from scratch.
 */
app.post('/api/pipelines/instances', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }

  if (typeof rawBody === 'object' && rawBody !== null && 'templateId' in rawBody) {
    const parsed = instanceFromTemplateSchema.safeParse(rawBody);
    if (!parsed.success)
      return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
    try {
      const tfOpts = { templateId: parsed.data.templateId } as Parameters<
        typeof installFromTemplate
      >[0];
      if (parsed.data.name !== undefined) tfOpts.name = parsed.data.name;
      if (parsed.data.showIn !== undefined) tfOpts.showIn = parsed.data.showIn;
      // configOverrides Zod-parsed shape includes optional `T | undefined`; strip undefined entries
      const co = parsed.data.configOverrides;
      if (co !== undefined) {
        const stripped: Partial<typeof co> = {};
        for (const [k, v] of Object.entries(co)) {
          if (v !== undefined) (stripped as Record<string, unknown>)[k] = v;
        }
        tfOpts.configOverrides = stripped as NonNullable<typeof tfOpts.configOverrides>;
      }
      const instance = await installFromTemplate(tfOpts);
      return c.json({ instance }, 201);
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  }

  const parsed = instanceFromScratchSchema.safeParse(rawBody);
  if (!parsed.success)
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  const scratchOpts = {
    name: parsed.data.name,
    kind: parsed.data.kind,
    config: parsed.data.config as import('@shared/types.js').PipelineInstanceConfig,
  } as Parameters<typeof createScratchInstance>[0];
  if (parsed.data.showIn !== undefined) scratchOpts.showIn = parsed.data.showIn;
  const instance = await createScratchInstance(scratchOpts);
  return c.json({ instance }, 201);
});

const instancePatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  enabled: z.boolean().optional(),
  config: z
    .object({
      trigger: z.enum(['post-create', 'comment-create', 'status-change', 'scheduled']).optional(),
      systemPrompt: z.string().max(4000).optional(),
      userPrompt: z.string().max(4000).optional(),
      outputSchema: z
        .enum(['single-label', 'label-confidence', 'boolean', 'scalar', 'cluster'])
        .optional(),
      labels: z.array(z.string().min(1).max(100)).max(50).optional(),
      threshold: z.number().min(0).max(1).optional(),
    })
    .optional(),
  showIn: z.array(z.enum(['insights', 'incidents', 'team', 'audit'])).optional(),
  order: z.number().int().min(0).optional(),
});

/** PATCH /api/pipelines/instances/order — reorder bulk. Must be before :id route. */
app.patch('/api/pipelines/instances/order', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const parsed = z.object({ orderedIds: z.array(z.string()).min(1) }).safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'orderedIds (string[]) required' }, 400);
  await reorderInstances(parsed.data.orderedIds);
  return c.json({ ok: true });
});

/** PATCH /api/pipelines/instances/:id */
app.patch('/api/pipelines/instances/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const parsed = instancePatchSchema.safeParse(rawBody);
  if (!parsed.success)
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);

  const existing = await getInstance(id);
  if (!existing) return c.json({ error: 'not found' }, 404);

  const patch: Parameters<typeof patchInstance>[1] = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.showIn !== undefined) patch.showIn = parsed.data.showIn;
  if (parsed.data.order !== undefined) patch.order = parsed.data.order;
  if (parsed.data.config !== undefined) {
    const merged = { ...existing.config, ...parsed.data.config };
    // After spread, trigger must be defined (existing.config always has it)
    patch.config = merged as import('@shared/types.js').PipelineInstanceConfig;
  }

  const updated = await patchInstance(id, patch);
  return c.json({ instance: updated });
});

/** DELETE /api/pipelines/instances/:id */
app.delete('/api/pipelines/instances/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const result = await deleteInstance(id);
  if (!result.deleted && !result.disabled) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true, ...result });
});

/** POST /api/pipelines/instances/:id/duplicate */
app.post('/api/pipelines/instances/:id/duplicate', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const copy = await duplicateInstance(id);
  if (!copy) return c.json({ error: 'not found' }, 404);
  return c.json({ instance: copy }, 201);
});

/**
 * POST /api/pipelines/instances/:id/test — run an instance's prompts against a
 * sample post (title + optional body) without persisting any tag. Returns the
 * AI output plus token cost so mods can sanity-check their pipeline config.
 */
app.post('/api/pipelines/instances/:id/test', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const instance = await getInstance(id);
  if (!instance) return c.json({ error: 'instance not found' }, 404);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const bodySchema = z.object({
    title: z.string().min(1).max(300),
    body: z.string().max(8000).optional(),
    author: z.string().max(64).optional(),
  });
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return c.json({ error: 'title required' }, 400);

  const { config } = instance;
  const sub = {
    '{{post.title}}': parsed.data.title,
    '{{post.body}}': parsed.data.body ?? '',
    '{{post.author}}': parsed.data.author ?? 'sample_user',
  };
  let userPrompt = config.userPrompt ?? '{{post.title}}\n\n{{post.body}}';
  for (const [k, v] of Object.entries(sub)) {
    userPrompt = userPrompt.split(k).join(v);
  }

  // Generic free-form output schema — the test playground doesn't enforce the
  // pipeline's structured schema; we want to surface whatever the AI returned.
  // .nullable() not .optional() — OpenAI's strict structured-output mode
  // rejects properties missing from `required`. Model returns null when
  // it has nothing to say.
  const testSchema = z.object({
    output: z.string().describe('Primary structured result for this pipeline.'),
    confidence: z.number().min(0).max(1).nullable(),
    reasoning: z.string().nullable(),
  });

  const result = await llmObject({
    name: `instance-test-${id}`,
    schema: testSchema,
    system:
      config.systemPrompt ?? `You are running the ${instance.name} pipeline. Respond concisely.`,
    prompt: userPrompt,
    maxTokens: 400,
  });

  if (!result.ok) {
    return c.json({ error: result.reason ?? 'ai-unavailable', reason: result.reason }, 503);
  }
  return c.json({
    instanceId: id,
    instanceName: instance.name,
    output: result.data,
    cached: result.cached,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
  });
});

// ---------------------------------------------------------------------------
// Mount module-owned /api routes
// ---------------------------------------------------------------------------
// Mount module-owned /api routes
// ---------------------------------------------------------------------------

for (const mod of [
  agentVerificationModule,
  contactDriversModule,
  sentimentModule,
  dashboardOrchestratorModule,
  impostorDetectionModule,
  crisisDetectionModule,
  themeClusteringModule,
  agentMetricsModule,
  auditLogModule,
  rulesModule,
  copilotModule,
  studioBridgeModule,
  dataLabModule,
]) {
  mod.apiRoutes?.(app);
}

// ---------------------------------------------------------------------------
// Bulk post-status mutation
// ---------------------------------------------------------------------------

const bulkStatusBodySchema = z.object({
  postIds: z.array(z.string().min(1)).min(1).max(50),
  status: z.enum(['open', 'in-progress', 'responded', 'resolved']),
});

/**
 * POST /api/posts/bulk-status
 *
 * Updates the workflow status of multiple posts in a single call. Mod-only.
 * Uses the same underlying setPostStatus used by the single-post route.
 * Returns a per-postId result so the client can display partial-success info.
 *
 * Body:  { postIds: string[], status: PostStatus }
 * Limit: max 50 postIds per call.
 */
app.post('/api/posts/bulk-status', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = bulkStatusBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'postIds' && i.code === 'too_big')) {
      return c.json({ error: 'postIds exceeds maximum of 50' }, 400);
    }
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  }

  const { postIds, status } = parsed.data;
  const actor = context.username ?? 'api';

  const settledResults = await Promise.allSettled(
    postIds.map(async (postId) => {
      const updated = await setPostStatus(postId, status, actor);
      if (!updated) throw new Error('post not tagged');
      return updated;
    }),
  );

  const results = postIds.map((postId, i) => {
    const r = settledResults[i];
    if (!r) return { postId, ok: false as const, error: 'unknown' };
    if (r.status === 'fulfilled') return { postId, ok: true as const };
    return {
      postId,
      ok: false as const,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;

  void recordAudit('bulk-status', null, { count: postIds.length, status, postIds });

  return c.json({ ok: failed === 0, results, succeeded, failed });
});

// ---------------------------------------------------------------------------
// Content Browser — unified post + comment search surface
// ---------------------------------------------------------------------------

const contentSearchQuerySchema = z
  .object({
    q: z.string().optional(),
    driver: z.string().optional(),
    sentiment: z.string().optional(),
    status: z.string().optional(),
    author: z.string().optional(),
    hasAgent: z.enum(['yes', 'no', 'any']).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    type: z.enum(['post', 'comment', 'both']).optional().default('both'),
    sort: z
      .enum([
        'priority_desc',
        'createdAt_desc',
        'createdAt_asc',
        'sentimentScore_asc',
        'sentimentScore_desc',
        'responseTime_asc',
      ])
      .optional()
      .default('priority_desc'),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
  })
  .passthrough(); // allow tag_* keys — parsed separately below

app.get('/api/content/search', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  const parsed = contentSearchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: 'invalid query params', issues: parsed.error.issues }, 400);
  }

  const {
    q,
    driver,
    sentiment,
    status: statusFilter,
    author,
    from,
    to,
    type,
    sort,
    limit,
    offset,
  } = parsed.data;

  // Extract tag_* params that Zod passed through
  const rawQuery = c.req.query();
  const pipelineTags: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawQuery)) {
    if (key.startsWith('tag_') && typeof value === 'string') {
      const pipelineId = key.slice(4);
      const values = value.split(',').filter(Boolean);
      if (values.length > 0) pipelineTags[pipelineId] = values;
    }
  }
  const hasPipelineTagFilter = Object.keys(pipelineTags).length > 0;

  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) + 86_400_000 : null; // inclusive end-of-day

  const [rawIds, dashboardPostId] = await Promise.all([
    getRecentPostIds(500),
    redis.get(K.pulsePostId()),
  ]);
  const allPostIds = rawIds.filter((id) => id !== dashboardPostId);

  // Resolve pipeline tag intersection:
  //   - For each dimension (pipelineId), union targetIds matching any of the values (OR within)
  //   - Then intersect across all dimensions (AND across)
  let tagCandidateSet: Set<string> | null = null;
  if (hasPipelineTagFilter) {
    for (const [pipelineId, values] of Object.entries(pipelineTags)) {
      // Union all values within this dimension
      const dimensionIds = new Set<string>();
      const perValueResults = await Promise.all(
        values.map((v) => getTargetsByTagValue(pipelineId, v, 1000)),
      );
      for (const idList of perValueResults) {
        for (const id of idList) {
          dimensionIds.add(id);
        }
      }
      // AND with the running intersection
      if (tagCandidateSet === null) {
        tagCandidateSet = dimensionIds;
      } else {
        for (const id of tagCandidateSet) {
          if (!dimensionIds.has(id)) tagCandidateSet.delete(id);
        }
      }
    }
  }

  // If pipeline tag filters applied, restrict to their intersection; otherwise use all post ids
  const ids = hasPipelineTagFilter
    ? allPostIds.filter((id) => (tagCandidateSet as Set<string>).has(id))
    : allPostIds;

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

  const lcQ = q?.toLowerCase() ?? null;

  type ContentItem = {
    id: string;
    type: 'post' | 'comment';
    title: string;
    body: string | null;
    authorName: string;
    url: string;
    createdAt: number;
    driverId: string | null;
    taggedBy: 'manual' | 'auto' | 'ai' | null;
    sentimentLabel: 'positive' | 'neutral' | 'negative' | null;
    sentimentScore: number | null;
    status: string | null;
    postId: string;
    hasAgentReply: boolean | null;
    replyCount: number | null;
    responseLatencyMs: number | null;
    agentUsername: string | null;
  };

  const allItems: ContentItem[] = [];

  if (type === 'post' || type === 'both') {
    for (const m of metas) {
      const t = tagById.get(m.postId);
      const s = sentById.get(m.postId);
      const itemStatus = t?.status ?? null;
      const itemDriver = t?.driverId ?? null;
      const itemSentLabel = s?.label ?? null;

      // Text search against title
      if (lcQ && !m.title.toLowerCase().includes(lcQ)) continue;
      // Driver filter
      if (driver && driver !== 'untagged' && itemDriver !== driver) continue;
      if (driver === 'untagged' && itemDriver !== null) continue;
      // Sentiment filter
      if (sentiment) {
        const labels = sentiment.split(',');
        if (itemSentLabel === null && !labels.includes('unscored')) continue;
        if (itemSentLabel !== null && !labels.includes(itemSentLabel)) continue;
      }
      // Status filter
      if (statusFilter) {
        const statuses = statusFilter.split(',');
        const effective = itemStatus ?? 'open';
        if (!statuses.includes(effective)) continue;
      }
      // Author filter
      if (author && !m.authorName.toLowerCase().includes(author.toLowerCase())) continue;
      // Date range
      if (fromMs !== null && m.createdAt < fromMs) continue;
      if (toMs !== null && m.createdAt > toMs) continue;

      allItems.push({
        id: m.postId,
        type: 'post',
        title: m.title,
        body: null,
        authorName: m.authorName,
        url: m.url,
        createdAt: m.createdAt,
        driverId: itemDriver,
        taggedBy: t?.taggedBy ?? null,
        sentimentLabel: itemSentLabel,
        sentimentScore: s?.score ?? null,
        status: itemStatus,
        postId: m.postId,
        hasAgentReply: null,
        replyCount: null,
        responseLatencyMs: null,
        agentUsername: null,
      });
    }
  }

  // Sort
  const now = Date.now();
  allItems.sort((a, b) => {
    switch (sort) {
      case 'createdAt_desc':
        return b.createdAt - a.createdAt;
      case 'createdAt_asc':
        return a.createdAt - b.createdAt;
      case 'sentimentScore_asc':
        return (a.sentimentScore ?? 0) - (b.sentimentScore ?? 0);
      case 'sentimentScore_desc':
        return (b.sentimentScore ?? 0) - (a.sentimentScore ?? 0);
      default: {
        // priority_desc — mirror triage queue scoring
        const getPriority = (item: ContentItem) => {
          const driverWeight = item.driverId ? 0.8 : 0.4;
          const sentMag =
            typeof item.sentimentScore === 'number'
              ? Math.max(0, -item.sentimentScore) + Math.abs(item.sentimentScore) * 0.3
              : 0.2;
          const ageHours = (now - item.createdAt) / (1000 * 60 * 60);
          return driverWeight * (1 + sentMag) * Math.exp(-ageHours / 48);
        };
        return getPriority(b) - getPriority(a);
      }
    }
  });

  const total = allItems.length;
  const page = allItems.slice(offset, offset + limit);

  return c.json({ items: page, total, offset, limit });
});

const postReplyBodySchema = z.object({
  body: z.string().min(1).max(10000),
  as: z.enum(['app', 'user']).optional().default('user'),
});

app.post('/api/posts/:postId/reply', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const postId = c.req.param('postId');

  let rawReplyBody: unknown;
  try {
    rawReplyBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsedReply = postReplyBodySchema.safeParse(rawReplyBody);
  if (!parsedReply.success) {
    return c.json({ error: 'validation failed', issues: parsedReply.error.issues }, 400);
  }

  const actor = context.username ?? 'api';
  try {
    const comment = await reddit.submitComment({
      id: `t3_${postId}`,
      text: parsedReply.data.body,
    });
    void recordAudit('mod-reply', postId, { as: parsedReply.data.as, actor });
    return c.json({ commentId: comment.id });
  } catch (err) {
    log.error('post-reply-failed', { postId, err: String(err) });
    return c.json({ error: 'failed to submit comment', hint: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// Mod actions — approve / remove / lock / distinguish
// ---------------------------------------------------------------------------

app.post('/api/posts/:postId/approve', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const postId = c.req.param('postId');
  try {
    const fullPostId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
    await reddit.approve(fullPostId as `t3_${string}`);
    void recordAudit('mod-approve', postId, { type: 'post' });
    return c.json({ ok: true });
  } catch (err) {
    log.error('mod-approve-post-failed', { postId, err: String(err) });
    return c.json({ error: 'approve failed', hint: String(err) }, 500);
  }
});

const modRemoveBodySchema = z.object({ spam: z.boolean().optional().default(false) });

app.post('/api/posts/:postId/remove', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const postId = c.req.param('postId');
  let raw: unknown;
  try {
    raw = await c.req.json().catch(() => ({}));
  } catch {
    raw = {};
  }
  const parsed = modRemoveBodySchema.safeParse(raw);
  const spam = parsed.success ? parsed.data.spam : false;
  try {
    const fullId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
    await reddit.remove(fullId as `t3_${string}`, spam);
    void recordAudit(spam ? 'mod-spam' : 'mod-remove', postId, { type: 'post', spam });
    return c.json({ ok: true });
  } catch (err) {
    log.error('mod-remove-post-failed', { postId, err: String(err) });
    return c.json({ error: 'remove failed', hint: String(err) }, 500);
  }
});

app.post('/api/posts/:postId/lock', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const postId = c.req.param('postId');
  try {
    const lockFullId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
    const post = await reddit.getPostById(lockFullId as `t3_${string}`);
    await post.lock();
    void recordAudit('mod-lock', postId, { type: 'post' });
    return c.json({ ok: true });
  } catch (err) {
    log.error('mod-lock-post-failed', { postId, err: String(err) });
    return c.json({ error: 'lock failed', hint: String(err) }, 500);
  }
});

app.post('/api/comments/:commentId/approve', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const commentId = c.req.param('commentId');
  try {
    const fullCommentId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
    await reddit.approve(fullCommentId as `t1_${string}`);
    void recordAudit('mod-approve', commentId, { type: 'comment' });
    return c.json({ ok: true });
  } catch (err) {
    log.error('mod-approve-comment-failed', { commentId, err: String(err) });
    return c.json({ error: 'approve failed', hint: String(err) }, 500);
  }
});

app.post('/api/comments/:commentId/remove', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const commentId = c.req.param('commentId');
  let raw: unknown;
  try {
    raw = await c.req.json().catch(() => ({}));
  } catch {
    raw = {};
  }
  const parsed = modRemoveBodySchema.safeParse(raw);
  const spam = parsed.success ? parsed.data.spam : false;
  try {
    const fullCmtId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
    await reddit.remove(fullCmtId as `t1_${string}`, spam);
    void recordAudit(spam ? 'mod-spam' : 'mod-remove', commentId, { type: 'comment', spam });
    return c.json({ ok: true });
  } catch (err) {
    log.error('mod-remove-comment-failed', { commentId, err: String(err) });
    return c.json({ error: 'remove failed', hint: String(err) }, 500);
  }
});

app.post('/api/comments/:commentId/distinguish', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const commentId = c.req.param('commentId');
  try {
    const distFullId = commentId.startsWith('t1_') ? commentId : `t1_${commentId}`;
    const comment = await reddit.getCommentById(distFullId as `t1_${string}`);
    await comment.distinguish();
    void recordAudit('mod-distinguish', commentId, { type: 'comment' });
    return c.json({ ok: true });
  } catch (err) {
    log.error('mod-distinguish-comment-failed', { commentId, err: String(err) });
    return c.json({ error: 'distinguish failed', hint: String(err) }, 500);
  }
});

const bulkTagBodySchema = z.object({
  postIds: z.array(z.string()).min(1).max(50),
  driverId: z.string().min(1),
});

app.post('/api/posts/bulk-tag', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let rawTagBody: unknown;
  try {
    rawTagBody = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsedTag = bulkTagBodySchema.safeParse(rawTagBody);
  if (!parsedTag.success) {
    return c.json({ error: 'validation failed', issues: parsedTag.error.issues }, 400);
  }

  const { postIds, driverId } = parsedTag.data;
  const actor = context.username ?? 'api';
  const taggedAt = Date.now();

  const settledResults = await Promise.allSettled(
    postIds.map(async (postId) => {
      const existing = await getPostTag(postId);
      await setPostTag({
        postId,
        driverId,
        taggedBy: 'manual',
        taggedByUser: actor,
        taggedAt,
        status: existing?.status ?? 'open',
      });
    }),
  );

  const succeeded = settledResults.filter((r) => r.status === 'fulfilled').length;
  const failed = settledResults.length - succeeded;

  void recordAudit('tag-issue', null, { count: postIds.length, driverId, postIds });

  return c.json({ ok: failed === 0, succeeded, failed });
});

// ---------------------------------------------------------------------------
// Triggers — Reddit POSTs the trigger payload as JSON to these endpoints
// ---------------------------------------------------------------------------

app.post('/internal/triggers/app-install', async (c) => {
  await dispatch('onAppInstall', await c.req.json());
  // Idempotently seed pre-installed pipeline instances on first install.
  await seedInstancesIfNeeded();
  return c.json({ ok: true });
});

app.post('/internal/triggers/app-upgrade', async (c) => {
  await dispatch('onAppUpgrade', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/post-create', async (c) => {
  const body = await c.req.json();
  await dispatch('onPostCreate', body);

  // Forward post-create event to Studio (best-effort, after modules ran).
  const post = (body as Record<string, unknown>).post as Record<string, unknown> | undefined;
  if (post?.id) {
    void forwardToStudio('post-create', {
      postId: String(post.id),
      authorName: typeof post.authorName === 'string' ? post.authorName : 'unknown',
      title: typeof post.title === 'string' ? post.title : '',
      createdAt: Date.now(),
    });
  }

  return c.json({ ok: true });
});

app.post('/internal/triggers/post-update', async (c) => {
  await dispatch('onPostUpdate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/comment-create', async (c) => {
  const body = await c.req.json();
  await dispatch('onCommentCreate', body);

  // Forward comment-create event to Studio (best-effort, after modules ran).
  const comment = (body as Record<string, unknown>).comment as Record<string, unknown> | undefined;
  if (comment?.id) {
    void forwardToStudio('comment-create', {
      commentId: String(comment.id),
      postId: typeof comment.postId === 'string' ? comment.postId : null,
      authorName: typeof comment.authorName === 'string' ? comment.authorName : 'unknown',
      createdAt: Date.now(),
    });
  }

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
      title: 'SubVitals · Analytics Dashboard',
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

// ---------------------------------------------------------------------------
// Scheduler — daily-aggregate
// ---------------------------------------------------------------------------

app.post('/internal/scheduler/daily-aggregate', async (c) => {
  log.info('scheduler: daily-aggregate fired');
  // Auto-resolve any open incidents that have gone quiet
  try {
    await autoResolveQuietIncidents();
  } catch (err) {
    log.warn('daily-aggregate: autoResolveQuietIncidents failed', { err: String(err) });
  }
  // Regenerate theme clusters from yesterday's negative posts
  try {
    const snapshot = await regenerateThemes();
    log.info('daily-aggregate: theme clustering done', {
      themeCount: snapshot?.themes.length ?? 0,
    });
  } catch (err) {
    log.warn('daily-aggregate: regenerateThemes failed', { err: String(err) });
  }
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Scheduler — weekly-digest
// ---------------------------------------------------------------------------

const DIGEST_MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

app.post('/internal/scheduler/weekly-digest', async (c) => {
  log.info('scheduler: weekly-digest fired');
  const subredditName = context.subredditName;
  if (!subredditName) {
    log.warn('weekly-digest: no subredditName in context, skipping');
    return c.json({ ok: false, reason: 'no-subreddit' });
  }

  // De-dup: skip if last digest was within 6 days
  const lastSent = await getLastDigestSentAt();
  if (lastSent && Date.now() - lastSent < DIGEST_MIN_INTERVAL_MS) {
    log.info('weekly-digest: skipping, last digest too recent', {
      lastSent: new Date(lastSent).toISOString(),
    });
    return c.json({ ok: false, reason: 'too-soon' });
  }

  try {
    const stats = await gatherDigestStats();
    const body = buildWeeklyDigest(stats, subredditName);
    await reddit.modMail.createConversation({
      subredditName,
      to: null,
      subject: `[SubVitals] Weekly Digest — ${stats.weekDates[0]} to ${stats.weekDates[stats.weekDates.length - 1]}`,
      body,
    });
    await setLastDigestSentAt(Date.now());
    log.info('weekly-digest: sent', {
      subredditName,
      period: `${stats.weekDates[0]}..${stats.weekDates[stats.weekDates.length - 1]}`,
      totalPosts: stats.totalPosts,
    });
    return c.json({ ok: true });
  } catch (err) {
    log.error('weekly-digest: failed', {
      err: err instanceof Error ? err.message : String(err),
      subredditName,
    });
    return c.json({ ok: false, reason: 'error' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Scheduler — retry-sweep
//
// Runs every 5 minutes. Drains each known retry-queue job type, replaying
// items whose backoff has expired. Each handler is idempotent; transient
// failures get re-queued with the next backoff step (30s → 2m → 8m → 30m
// → 2h) and dropped after 5 attempts.
//
// To add a new job type:
//   1. Define a payload + handler in the owning module (export it).
//   2. Add a `drainRetries('your-job-type', handler)` call here.
//   3. Call `enqueueRetry('your-job-type', payload)` from the failure site.
// ---------------------------------------------------------------------------

app.post('/internal/scheduler/retry-sweep', async (c) => {
  log.info('scheduler: retry-sweep fired');
  const { drainRetries } = await import('@shared/retry-queue.js');
  const { retryPipelineRun } = await import('@modules/generic-pipeline-runner/index.js');

  // Pipeline LLM retries (spam/fraud/intent etc.)
  try {
    await drainRetries('pipeline-run', retryPipelineRun);
  } catch (err) {
    log.warn('retry-sweep: pipeline-run drain failed', { err: String(err) });
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Taxonomy template routes — mod-only.
// ---------------------------------------------------------------------------

type TemplateId = 'ecommerce' | 'saas' | 'hardware' | 'gaming' | 'finance' | 'media';

const TAXONOMY_TEMPLATES: Record<
  TemplateId,
  { id: TemplateId; name: string; description: string; nodes: unknown[] }
> = {
  ecommerce: {
    id: 'ecommerce',
    name: 'E-Commerce',
    description:
      'Orders, returns, products, account, pricing, and feedback for online retail brands.',
    nodes: ecommerceTemplate as unknown[],
  },
  saas: {
    id: 'saas',
    name: 'SaaS / Software',
    description:
      'Bugs, feature requests, billing, integrations, and onboarding for software products.',
    nodes: saasTemplate as unknown[],
  },
  hardware: {
    id: 'hardware',
    name: 'Hardware / Devices',
    description: 'Defects, setup, compatibility, warranty, and repair for physical products.',
    nodes: hardwareTemplate as unknown[],
  },
  gaming: {
    id: 'gaming',
    name: 'Gaming',
    description: 'Bugs, balance, cheating, account issues, and feature requests for games.',
    nodes: gamingTemplate as unknown[],
  },
  finance: {
    id: 'finance',
    name: 'Finance / FinTech',
    description:
      'Transactions, security, fees, withdrawals, and compliance for financial services.',
    nodes: financeTemplate as unknown[],
  },
  media: {
    id: 'media',
    name: 'Media & Streaming',
    description:
      'Content, subscriptions, streaming issues, recommendations, and moderation for media platforms.',
    nodes: mediaTemplate as unknown[],
  },
};

function computeDeepestDepth(nodes: unknown[]): number {
  const arr = nodes as Array<{ id: string; parentId?: string | null }>;
  const childrenOf = new Map<string | null, string[]>();
  for (const n of arr) {
    const pid = n.parentId ?? null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid)?.push(n.id);
  }
  let maxDepth = 0;
  function walk(id: string | null, depth: number) {
    if (depth > maxDepth) maxDepth = depth;
    for (const child of childrenOf.get(id) ?? []) walk(child, depth + 1);
  }
  walk(null, 0);
  return maxDepth;
}

/** GET /api/taxonomy/templates — list all available templates */
app.get('/api/taxonomy/templates', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const list = Object.values(TAXONOMY_TEMPLATES).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    driverCount: t.nodes.length,
    deepestDepth: computeDeepestDepth(t.nodes),
  }));
  return c.json({ templates: list });
});

const applyTemplateBodySchema = z.object({
  templateId: z.enum(['ecommerce', 'saas', 'hardware', 'gaming', 'finance', 'media']),
  mode: z.enum(['replace', 'merge']),
});

/** POST /api/taxonomy/apply-template — apply a pre-built taxonomy template */
app.post('/api/taxonomy/apply-template', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = applyTemplateBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  }

  const { templateId, mode } = parsed.data;
  const template = TAXONOMY_TEMPLATES[templateId];

  let candidateNodes: unknown[];
  if (mode === 'replace') {
    candidateNodes = template.nodes;
  } else {
    // merge: keep existing; add template nodes whose IDs don't conflict
    const existing = await getTaxonomy();
    const existingIds = new Set(existing.map((n) => n.id));
    const newNodes = (template.nodes as Array<{ id: string }>).filter(
      (n) => !existingIds.has(n.id),
    );
    candidateNodes = [...existing, ...newNodes];
  }

  const validated = taxonomyArraySchema.safeParse(candidateNodes);
  if (!validated.success) {
    return c.json(
      { error: 'template produced invalid taxonomy', issues: validated.error.issues },
      422,
    );
  }

  await setTaxonomy(validated.data);
  await writeOverrideSetting('taxonomy-json', JSON.stringify(validated.data));
  void recordAudit('settings-update', null, {
    templateId,
    mode,
    driverCount: validated.data.length,
  });

  return c.json({ taxonomy: validated.data, driverCount: validated.data.length });
});

// ---------------------------------------------------------------------------
// Settings CRUD — mod-only. Reads/writes Redis overrides for user-editable
// settings. openrouter-api-key is never surfaced here (global+secret).
// ---------------------------------------------------------------------------

app.get('/api/settings', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const [effective, openrouterKeyRaw] = await Promise.all([
    readAllEffectiveSettings(),
    readEffectiveSetting<string>('openrouter-api-key'),
  ]);
  return c.json({
    ...effective,
    openrouterKeyConfigured: typeof openrouterKeyRaw === 'string' && openrouterKeyRaw.length > 0,
  });
});

app.put('/api/settings', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  }

  const updates = parsed.data;

  // Deep-validate routing-json if provided
  if (typeof updates['routing-json'] === 'string') {
    let routingParsed: unknown;
    try {
      routingParsed = JSON.parse(updates['routing-json']);
    } catch {
      return c.json({ error: 'routing-json is not valid JSON' }, 400);
    }
    const routingCheck = routingRulesSchema.safeParse(routingParsed);
    if (!routingCheck.success) {
      return c.json(
        { error: 'routing-json schema invalid', issues: routingCheck.error.issues },
        400,
      );
    }
  }

  // Deep-validate taxonomy-json if provided, and sync to the primary taxonomy store
  if (typeof updates['taxonomy-json'] === 'string') {
    let taxParsed: unknown;
    try {
      taxParsed = JSON.parse(updates['taxonomy-json']);
    } catch {
      return c.json({ error: 'taxonomy-json is not valid JSON' }, 400);
    }
    const taxCheck = taxonomyArraySchema.safeParse(taxParsed);
    if (!taxCheck.success) {
      return c.json({ error: 'taxonomy-json schema invalid', issues: taxCheck.error.issues }, 400);
    }
    // Also write to primary taxonomy store so existing readers see it immediately.
    await setTaxonomy(taxCheck.data);
  }

  // Write all provided values to Redis overrides
  await Promise.all(
    Object.entries(updates).map(([k, v]) => {
      if (v === undefined) return Promise.resolve();
      return writeOverrideSetting(k, v as string | number | boolean);
    }),
  );

  const updated = await readAllEffectiveSettings();
  const openrouterKeyRaw = await readEffectiveSetting<string>('openrouter-api-key');
  void recordAudit('settings-update', null, { keys: Object.keys(updates) });
  return c.json({
    ...updated,
    openrouterKeyConfigured: typeof openrouterKeyRaw === 'string' && openrouterKeyRaw.length > 0,
  });
});

app.post('/api/settings/test-draft', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  const recentIds = await getRecentPostIds(1);
  const postId = recentIds[0];
  if (!postId) {
    return c.json(
      { error: 'no-posts', hint: 'No posts in the index yet. Submit a post in the sub first.' },
      404,
    );
  }

  const [postMeta, postTag, postSent, commentIds, brandVoiceOverride] = await Promise.all([
    getPostMeta(postId),
    getPostTag(postId),
    getSentimentScore(postId),
    getCommentIdsForPost(postId),
    readEffectiveSetting<string>('brand-voice'),
  ]);

  if (!postMeta) return c.json({ error: 'post not in index', postId }, 404);

  const recentCommentIds = commentIds.slice(-10);
  const recentComments = await Promise.all(recentCommentIds.map((id) => getCommentMeta(id)));
  const recentSents = await Promise.all(recentCommentIds.map((id) => getSentimentScore(id)));
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
    typeof brandVoiceOverride === 'string' && brandVoiceOverride.trim().length > 0
      ? brandVoiceOverride.trim()
      : "Warm and professional. Acknowledge the user, be specific, avoid generic corporate phrases. Never make commitments you can't back up.";

  const testDraftSchema = z.object({
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
    'Produce 2-3 candidate replies for the brand to post as a Reddit comment. Distinct tones (empathetic, direct, concise, investigative). Brief rationale + the reply. Keep replies under ~150 words.',
  ]
    .filter((x): x is string => typeof x === 'string')
    .join('\n');

  const result = await llmObject({
    name: 'draft-reply',
    schema: testDraftSchema,
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
              ? 'Monthly AI cost cap reached.'
              : 'Try again or check logs.',
      },
      503,
    );
  }

  return c.json({
    postId,
    postTitle: postMeta.title,
    candidates: result.data.candidates,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: Number(result.costCents.toFixed(4)),
    cached: result.cached,
  });
});

// ---------------------------------------------------------------------------
// Saved views — GET/PUT/DELETE /api/views
// ---------------------------------------------------------------------------

const VIEWS_KEY = 'rl:views';
const VIEWS_CAP = 20;

const saveViewBodySchema = z.object({
  name: z.string().min(1).max(60),
  tab: z.enum(['inbox', 'drivers']),
  params: z.record(z.string(), z.string()),
});

interface StoredView {
  id: string;
  name: string;
  tab: 'inbox' | 'drivers';
  params: Record<string, string>;
  createdAt: number;
}

app.get('/api/views', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const raw = await redis.hGetAll(VIEWS_KEY);
  const views: StoredView[] = Object.values(raw ?? {})
    .map((v) => {
      try {
        return JSON.parse(v) as StoredView;
      } catch {
        return null;
      }
    })
    .filter((v): v is StoredView => v !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
  return c.json({ views });
});

app.put('/api/views', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = saveViewBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  }

  // Enforce cap
  const existing = await redis.hGetAll(VIEWS_KEY);
  const count = Object.keys(existing ?? {}).length;
  if (count >= VIEWS_CAP) {
    return c.json({ error: 'view cap reached', limit: VIEWS_CAP }, 400);
  }

  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const view: StoredView = { id, ...parsed.data, createdAt: Date.now() };
  await redis.hSet(VIEWS_KEY, { [id]: JSON.stringify(view) });
  return c.json(view);
});

app.delete('/api/views/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'missing id' }, 400);
  await redis.hDel(VIEWS_KEY, [id]);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

const ONBOARDED_KEY = (userId: string) => `rl:onboarded:${userId}`;

app.get('/api/onboarding/status', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const userId = context.username ?? 'unknown';
  const val = await redis.get(ONBOARDED_KEY(userId));
  return c.json({ onboarded: val === '1' });
});

app.post('/api/onboarding/complete', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const userId = context.username ?? 'unknown';
  await redis.set(ONBOARDED_KEY(userId), '1');
  return c.json({ ok: true });
});

app.post('/api/onboarding/reset', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const userId = context.username ?? 'unknown';
  await redis.del(ONBOARDED_KEY(userId));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI model validation + fallback management
// ---------------------------------------------------------------------------

const validateModelBodySchema = z.object({
  slug: z.string().min(1).max(200),
});

app.post('/api/ai/validate-model', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const parsed = validateModelBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
  }

  const { slug } = parsed.data;
  const catalog = findModel(slug);
  const inCatalog = catalog !== null;
  const supportsStructuredOutput = isStructuredOutputCapable(slug);

  // Estimate cost in cents for 1 tagging call (500 in + 200 out tokens).
  const rate = CURATED_MODELS.find((m) => m.slug === slug);
  const estimatedCostCents = rate ? Math.round(rate.pricePer1kTaggingCalls * 1000) / 100 : null;

  // Quick structured-output probe using the existing llmObject infrastructure.
  // We temporarily override model by calling the provider directly to avoid
  // writing to the shared cost tracker for a probe call.
  const probeSchema = z.object({ ok: z.boolean() });
  const apiKeyRaw = await readEffectiveSetting<string>('openrouter-api-key');
  if (typeof apiKeyRaw !== 'string' || !apiKeyRaw) {
    return c.json({
      valid: false,
      supportsStructuredOutput,
      error: 'no-api-key',
      hint: 'Set openrouter-api-key first.',
    });
  }

  const { createOpenAI } = await import('@ai-sdk/openai');
  const { generateObject: go, NoObjectGeneratedError: NOGE } = await import('ai');

  // Direct OpenAI provider — openrouter.ai is pending Devvit gateway approval.
  const openai = createOpenAI({ apiKey: apiKeyRaw });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), 15_000);

  // Reasoning models burn 128+ output tokens on internal thinking and reject
  // non-default temperature; budget + omit accordingly.
  const isReasoning = /^(gpt-5|o1|o3|o4)/.test(slug);

  try {
    await go({
      model: openai(slug),
      schema: probeSchema,
      prompt: 'Respond with ok: true.',
      maxOutputTokens: isReasoning ? 800 : 50,
      ...(isReasoning ? {} : { temperature: 0 }),
      abortSignal: ac.signal,
    });
    clearTimeout(timer);
    return c.json({
      valid: true,
      supportsStructuredOutput: true,
      inCatalog,
      estimatedCostCents,
      hint: inCatalog ? undefined : 'Model not in curated catalog — use at your own risk.',
    });
  } catch (err) {
    clearTimeout(timer);
    const isNoObject = err instanceof NOGE;
    const isTimeout = ac.signal.aborted;
    const errMsg = err instanceof Error ? err.message : String(err);

    if (isNoObject) {
      return c.json({
        valid: true,
        supportsStructuredOutput: false,
        inCatalog,
        estimatedCostCents,
        hint: 'Model responded but does not support structured output. Tagging pipelines may fail.',
      });
    }

    return c.json({
      valid: false,
      supportsStructuredOutput: false,
      inCatalog,
      estimatedCostCents,
      error: isTimeout ? 'Request timed out (8s).' : errMsg,
      hint: isTimeout
        ? 'Model may be overloaded or the slug is wrong.'
        : `Verify the slug at openrouter.ai. Detail: ${errMsg}`,
    });
  }
});

app.post('/api/ai/clear-fallback', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  const originalSlug = await getFallbackOriginalSlug();
  if (!originalSlug) {
    return c.json({ ok: true, message: 'No fallback active.' });
  }

  await clearFallback(originalSlug);
  log.info('llm: fallback cleared by mod', { slug: originalSlug });
  return c.json({ ok: true, slug: originalSlug });
});

app.post('/api/ai/set-key', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON' }, 400);
  }
  const body = raw as Record<string, unknown>;
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key || !key.startsWith('sk-')) {
    return c.json({ error: 'Invalid API key — must start with sk-' }, 400);
  }
  try {
    await writeOverrideSetting('openrouter-api-key', key);
    return c.json({ ok: true });
  } catch (err) {
    log.error('ai: set-key failed', { err: String(err) });
    return c.json({ error: 'Failed to save key' }, 500);
  }
});

/** Returns the current AI model state: effective model, whether fallback is active, original slug. */
app.get('/api/ai/status', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const { model, isFallback } = await getEffectiveModel();
  const originalSlug = isFallback ? await getFallbackOriginalSlug() : null;
  return c.json({
    effectiveModel: model,
    isFallback,
    originalSlug,
    defaultModel: DEFAULT_MODEL,
    catalog: CURATED_MODELS,
  });
});

// ---------------------------------------------------------------------------
// Webhooks (mod-only)
// ---------------------------------------------------------------------------

const webhookCreateSchema = z.object({
  name: z.string().min(1).max(100),
  targetUrl: z.string().url(),
  events: z.array(z.string()).min(1),
  format: z.enum(['auto', 'slack', 'discord', 'pagerduty', 'generic']).default('auto'),
});

const webhookPatchSchema = z.object({
  enabled: z.boolean().optional(),
  events: z.array(z.string()).min(1).optional(),
  format: z.enum(['slack', 'discord', 'pagerduty', 'generic']).optional(),
  name: z.string().min(1).max(100).optional(),
});

/** Generate a 32-char hex secret for new webhooks. */
function genWebhookSecret(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Tiny ID — same approach as crisis-detection/nanoid.ts */
function webhookNanoid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/** Sample payloads for the /test endpoint */
const SAMPLE_PAYLOADS: Record<string, Record<string, unknown>> = {
  'post-tag': { postId: 'test_post', driverId: 'billing', taggedBy: 'auto', confidence: 0.9 },
  'sentiment-spike': { postId: 'test_post', score: -0.8, label: 'negative', threshold: -0.5 },
  'incident-open': { incidentId: 'test_inc', reason: 'Negative spike', startedAt: Date.now() },
  'incident-resolve': { incidentId: 'test_inc', resolvedAt: Date.now(), resolvedBy: 'mod' },
  'theme-regenerate': { generatedAt: Date.now(), themeCount: 5 },
  'custom-rule-fire': { ruleId: 'rule_1', ruleName: 'High-priority alert', postId: 'test_post' },
};

app.get('/api/webhooks', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const hooks = await listWebhooks();
  return c.json({ count: hooks.length, webhooks: hooks });
});

app.post('/api/webhooks', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = webhookCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  const { name, targetUrl, events, format: rawFormat } = parsed.data;
  const resolvedFormat: WebhookFormat =
    rawFormat === 'auto' ? detectFormat(targetUrl, 'generic') : rawFormat;

  const hook: Webhook = {
    id: webhookNanoid(),
    name,
    targetUrl,
    events,
    enabled: true,
    secret: genWebhookSecret(),
    format: resolvedFormat,
    createdAt: Date.now(),
  };
  await saveWebhook(hook);
  log.info('webhook created', { id: hook.id, name, format: resolvedFormat });
  return c.json({ webhook: hook }, 201);
});

app.patch('/api/webhooks/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const hook = await getWebhook(id);
  if (!hook) return c.json({ error: 'not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = webhookPatchSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid body', issues: parsed.error.issues }, 400);

  const patch = parsed.data;
  const updated: Webhook = {
    ...hook,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.events !== undefined ? { events: patch.events } : {}),
    ...(patch.format !== undefined ? { format: patch.format } : {}),
  };
  await saveWebhook(updated);
  return c.json({ webhook: updated });
});

app.delete('/api/webhooks/:id', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const hook = await getWebhook(id);
  if (!hook) return c.json({ error: 'not found' }, 404);
  await deleteWebhook(id);
  return c.json({ ok: true });
});

app.post('/api/webhooks/:id/test', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const hook = await getWebhook(id);
  if (!hook) return c.json({ error: 'not found' }, 404);

  const firstEvent = hook.events.find((e) => e !== '*') ?? 'post-tag';
  const samplePayload = SAMPLE_PAYLOADS[firstEvent] ?? { test: true };

  const result = await deliverWebhook(id, firstEvent, samplePayload, { skipLog: true });
  return c.json(result);
});

app.get('/api/webhooks/:id/deliveries', async (c) => {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
  const id = c.req.param('id');
  const hook = await getWebhook(id);
  if (!hook) return c.json({ error: 'not found' }, 404);
  const deliveries = await getDeliveries(id);
  return c.json({ count: deliveries.length, deliveries });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const port = getServerPort();
serve({ fetch: app.fetch, createServer, port });
log.info('sub-vitals server listening', { port });
