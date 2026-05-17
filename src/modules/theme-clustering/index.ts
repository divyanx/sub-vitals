/**
 * Module 05 — Emerging-Theme AI Clustering
 * Tier: PRO · Phase 2
 *
 * Clusters recent negative posts into up to 8 emergent themes using the LLM.
 * Runs once a day via the daily-aggregate scheduler, or on-demand via API.
 *
 * State in Redis:
 *   rl:themes:latest  STRING JSON ThemeSnapshot  TTL 7 days
 */

import { context } from '@devvit/web/server';
import { recordAudit } from '@modules/audit-log/index.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  getPostMeta,
  getRecentPostIds,
  getSentimentScore,
  getThemeSnapshot,
  saveThemeSnapshot,
} from '@shared/storage.js';
import { forwardToStudio } from '@shared/studio-bridge.js';
import type { PostMeta, RedLatticeModule, Theme, ThemeSnapshot } from '@shared/types.js';
import type { Hono } from 'hono';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max posts to feed the LLM */
const MAX_POSTS = 40;
/** Max body characters per post sent to LLM */
const MAX_BODY_CHARS = 500;

// ---------------------------------------------------------------------------
// LLM schema
// ---------------------------------------------------------------------------

const clusterSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().max(60),
        summary: z.string().max(200),
        member_post_ids: z.array(z.string()).min(1).max(20),
      }),
    )
    .max(8),
});

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const themeClusteringModule: RedLatticeModule = {
  name: 'theme-clustering',
  description: 'Clusters recent negative posts into emergent themes via LLM.',
  tier: 'pro',

  async enabled(): Promise<boolean> {
    return true;
  },

  apiRoutes(app: Hono): void {
    // -----------------------------------------------------------------------
    // Theme clustering API
    // -----------------------------------------------------------------------

    /** GET /api/themes/latest */
    app.get('/api/themes/latest', async (c) => {
      const snapshot = await getThemeSnapshot();
      if (!snapshot) return c.json({ themes: null, generatedAt: null });
      return c.json(snapshot);
    });

    /** POST /api/themes/regenerate  (mod-only) */
    app.post('/api/themes/regenerate', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const snapshot = await regenerateThemes();
      if (!snapshot) {
        return c.json({ error: 'regeneration failed — check LLM settings or logs' }, 503);
      }
      void recordAudit('theme-regenerate', null, { themeCount: snapshot.themes.length });
      // Forward to Studio (best-effort).
      void forwardToStudio('theme-regenerate', {
        generatedAt: snapshot.generatedAt,
        themeCount: snapshot.themes.length,
      });
      return c.json(snapshot);
    });
  },
};

// ---------------------------------------------------------------------------
// Core regeneration logic (exported for scheduler use)
// ---------------------------------------------------------------------------

/**
 * Pull the last N negative posts, cluster them, persist, and return the snapshot.
 * Returns null if there are not enough posts or the LLM call fails.
 */
export async function regenerateThemes(): Promise<ThemeSnapshot | null> {
  // 1. Gather negative posts
  const allIds = await getRecentPostIds(200);
  const sentiments = await Promise.all(allIds.map((id) => getSentimentScore(id)));
  const negativeIds = allIds.filter((_, i) => sentiments[i]?.label === 'negative');

  if (negativeIds.length < 2) {
    log.info('theme-clustering: not enough negative posts, skipping', {
      count: negativeIds.length,
    });
    return null;
  }

  const sampleIds = negativeIds.slice(0, MAX_POSTS);
  const metas = await Promise.all(sampleIds.map((id) => getPostMeta(id)));
  const validMetas = metas.filter((m): m is PostMeta => m !== null);

  if (validMetas.length < 2) {
    log.info('theme-clustering: not enough post metas', { count: validMetas.length });
    return null;
  }

  // 2. Build prompt
  const subredditName = (() => {
    try {
      return context.subredditName ?? 'brand';
    } catch {
      return 'brand';
    }
  })();

  const postLines = validMetas.map((m) => {
    const body = m.title; // PostMeta only has title+url; title is enough for clustering
    return `[${m.postId}] ${body.slice(0, MAX_BODY_CHARS)}`;
  });

  const prompt = [
    `Here are ${validMetas.length} recent negative posts in the ${subredditName} subreddit.`,
    'Cluster them into at most 8 themes.',
    'For each theme, give:',
    '  - name: 3-5 word short label',
    '  - summary: one sentence describing the underlying issue',
    '  - member_post_ids: array of post IDs that belong to this theme',
    'Skip themes with fewer than 2 posts.',
    '',
    'Posts:',
    ...postLines,
  ].join('\n');

  // 3. LLM call
  const result = await llmObject({
    name: 'theme-clustering',
    schema: clusterSchema,
    system:
      'You are a CX analyst clustering Reddit community posts by their underlying issue theme. Return structured JSON only.',
    prompt,
    maxTokens: 1200,
    temperature: 0.3,
  });

  if (!result.ok) {
    log.warn('theme-clustering: LLM failed', { reason: result.reason });
    return null;
  }

  // 4. Enrich clusters with computed fields
  const sentByPost = new Map(
    sampleIds.map((id, _i) => [id, sentiments[allIds.indexOf(id)] ?? null]),
  );

  const themes: Theme[] = result.data.themes.map((raw) => {
    const memberIds = raw.member_post_ids.filter((pid) => validMetas.some((m) => m.postId === pid));
    const scores = memberIds
      .map((pid) => sentByPost.get(pid)?.score)
      .filter((s): s is number => typeof s === 'number');
    const avgSentiment = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return {
      name: raw.name,
      summary: raw.summary,
      samplePostIds: memberIds.slice(0, 5),
      postCount: memberIds.length,
      avgSentiment: Number(avgSentiment.toFixed(3)),
    };
  });

  const snapshot: ThemeSnapshot = {
    generatedAt: Date.now(),
    themes,
  };

  await saveThemeSnapshot(snapshot);

  log.info('theme-clustering: snapshot saved', {
    themeCount: themes.length,
    postsClustered: validMetas.length,
    cached: result.cached,
    costCents: result.ok ? Number(result.costCents.toFixed(4)) : 0,
  });

  return snapshot;
}
