/**
 * Module: Data Lab
 * Tier: core (developer-facing; not shown to end users in prod)
 *
 * Simulation API — lets mods and developers inject synthetic posts/comments
 * through the standard dispatcher pipeline so every module (sentiment, drivers,
 * crisis, etc.) processes them exactly as real Reddit events.
 *
 * Synthetic content is identified by the `lab_` author-name prefix. The clear
 * endpoint purges all Redis state associated with those posts.
 */

import { redis } from '@devvit/web/server';
import { dispatch } from '@shared/dispatcher.js';
import { K } from '@shared/keys.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import type { RedLatticeModule } from '@shared/types.js';
import type { Hono } from 'hono';
import { z } from 'zod';
import { findScenario, SCENARIOS } from './scenarios.js';
import {
  type SyntheticCommentEvent,
  type SyntheticPostEvent,
  synthesizeCommentEvent,
  synthesizePostEvent,
} from './synthetic.js';

// ---------------------------------------------------------------------------
// In-memory scenario status tracker (per server process lifetime)
// ---------------------------------------------------------------------------

interface ScenarioStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  lastRunAt: number | null;
  error?: string;
}

const scenarioStatus = new Map<string, ScenarioStatus>(
  SCENARIOS.map((s) => [s.name, { state: 'idle', lastRunAt: null }]),
);

// ---------------------------------------------------------------------------
// Redis key for lab post index (ZSET — score = createdAt, member = postId)
// ---------------------------------------------------------------------------

const LAB_POST_INDEX = 'rl:lab:posts';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const simulatePostSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(10_000).default(''),
  authorName: z.string().min(1).max(60).default('lab_test_user_1'),
  driverOverride: z.string().max(60).optional(),
  sentimentOverride: z.enum(['positive', 'neutral', 'negative']).optional(),
});

const simulateCommentSchema = z.object({
  postId: z.string().min(1),
  body: z.string().min(1).max(10_000),
  authorName: z.string().min(1).max(60).default('lab_test_user_1'),
});

const importJsonSchema = z.object({
  posts: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        body: z.string().max(10_000).default(''),
        author: z.string().max(60).optional(),
        comments: z
          .array(
            z.object({
              body: z.string().min(1).max(10_000),
              author: z.string().max(60).optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1)
    .max(100),
});

const clearSchema = z.object({ confirm: z.literal('YES') });

// ---------------------------------------------------------------------------
// Core simulate helpers
// ---------------------------------------------------------------------------

async function runSimulatePost(
  title: string,
  body: string,
  authorName: string,
  driverOverride?: string,
  sentimentOverride?: 'positive' | 'neutral' | 'negative',
): Promise<string> {
  const prefixed = authorName.startsWith('lab_') ? authorName : `lab_${authorName}`;
  const event: SyntheticPostEvent = synthesizePostEvent({ title, body, author: prefixed });
  const postId = event.post.id;

  // Record in lab index before dispatching so clear works even on partial failures
  await redis.zAdd(LAB_POST_INDEX, { score: Date.now(), member: postId });

  await dispatch('onPostCreate', event);

  // Write overrides directly after pipeline has run (overrides win)
  if (driverOverride) {
    const { setPostTag } = await import('@shared/storage.js');
    await setPostTag({
      postId,
      driverId: driverOverride,
      taggedBy: 'manual',
      taggedByUser: 'lab',
      confidence: 1,
      taggedAt: Date.now(),
      status: 'open',
    });
  }
  if (sentimentOverride) {
    const scoreMap = { positive: 3, neutral: 0, negative: -3 } as const;
    const raw = await redis.get(K.sentimentScore(postId));
    const existing = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    await redis.set(
      K.sentimentScore(postId),
      JSON.stringify({
        ...existing,
        contentId: postId,
        contentType: 'post',
        score: scoreMap[sentimentOverride],
        label: sentimentOverride,
        scoredAt: Date.now(),
        scoredBy: 'lexicon',
      }),
    );
  }

  log.info('lab: simulated post', { postId, title, author: prefixed });
  return postId;
}

async function runSimulateComment(
  postId: string,
  body: string,
  authorName: string,
): Promise<string> {
  const prefixed = authorName.startsWith('lab_') ? authorName : `lab_${authorName}`;
  const event: SyntheticCommentEvent = synthesizeCommentEvent({ postId, body, author: prefixed });
  const commentId = event.comment.id;
  await dispatch('onCommentCreate', event);
  log.info('lab: simulated comment', { commentId, postId, author: prefixed });
  return commentId;
}

// ---------------------------------------------------------------------------
// Clear all lab data
// ---------------------------------------------------------------------------

async function clearLabData(): Promise<{ deleted: number }> {
  // Collect all lab post ids from the index
  const members = await redis.zRange(LAB_POST_INDEX, 0, -1, { by: 'rank' });
  const postIds = members.map((m) => m.member);

  let deleted = 0;
  for (const postId of postIds) {
    // Post meta + recent-posts zset entry
    await redis.del(K.postMeta(postId));
    await redis.zRem(K.recentPosts(), [postId]);

    // Tag + driver index entry
    const tagRaw = await redis.get(K.postTag(postId));
    if (tagRaw) {
      const tag = JSON.parse(tagRaw) as { driverId?: string };
      if (tag.driverId) {
        await redis.zRem(K.driverIndex(tag.driverId), [postId]);
      }
      await redis.del(K.postTag(postId));
    }

    // Sentiment score
    await redis.del(K.sentimentScore(postId));
    await redis.zRem(K.sentimentLabelIndex('positive'), [postId]);
    await redis.zRem(K.sentimentLabelIndex('neutral'), [postId]);
    await redis.zRem(K.sentimentLabelIndex('negative'), [postId]);

    // Comments for post
    const commentMembers = await redis.zRange(K.commentsForPost(postId), 0, -1, { by: 'rank' });
    for (const cm of commentMembers) {
      await redis.del(K.commentMeta(cm.member));
      await redis.del(K.sentimentScore(cm.member));
    }
    await redis.del(K.commentsForPost(postId));

    // Idempotency sentinels
    await redis.del(K.processed('contact-drivers', postId));
    await redis.del(K.processed('sentiment', postId));
    await redis.del(K.processed('crisis-detection', postId));
    await redis.del(K.processed('impostor-detection', postId));

    deleted++;
  }

  // Clear the lab index itself
  await redis.del(LAB_POST_INDEX);

  log.info('lab: cleared', { deleted });
  return { deleted };
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

export const dataLabModule: RedLatticeModule = {
  name: 'data-lab',
  description: 'Simulation APIs — inject synthetic events through the real dispatcher pipeline.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  apiRoutes(app: Hono): void {
    // ── POST /api/lab/simulate-post ────────────────────────────────────────
    app.post('/api/lab/simulate-post', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const body = await c.req.json().catch(() => null);
      const parsed = simulatePostSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
      }
      const { title, body: postBody, authorName, driverOverride, sentimentOverride } = parsed.data;

      try {
        const postId = await runSimulatePost(
          title,
          postBody,
          authorName,
          driverOverride,
          sentimentOverride,
        );
        return c.json({ postId });
      } catch (err) {
        log.error('lab: simulate-post failed', { err: String(err) });
        return c.json({ error: 'internal' }, 500);
      }
    });

    // ── POST /api/lab/simulate-comment ────────────────────────────────────
    app.post('/api/lab/simulate-comment', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const body = await c.req.json().catch(() => null);
      const parsed = simulateCommentSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
      }
      const { postId, body: commentBody, authorName } = parsed.data;

      try {
        const commentId = await runSimulateComment(postId, commentBody, authorName);
        return c.json({ commentId });
      } catch (err) {
        log.error('lab: simulate-comment failed', { err: String(err) });
        return c.json({ error: 'internal' }, 500);
      }
    });

    // ── POST /api/lab/import-json ──────────────────────────────────────────
    app.post('/api/lab/import-json', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const body = await c.req.json().catch(() => null);
      const parsed = importJsonSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid', issues: parsed.error.issues }, 400);
      }

      const results: Array<{ postId: string; commentIds: string[] }> = [];
      for (const post of parsed.data.posts) {
        const author = post.author ?? 'lab_import_user';
        const postId = await runSimulatePost(post.title, post.body, author);
        const commentIds: string[] = [];
        for (const comment of post.comments ?? []) {
          const cAuthor = comment.author ?? 'lab_import_user';
          const commentId = await runSimulateComment(postId, comment.body, cAuthor);
          commentIds.push(commentId);
        }
        results.push({ postId, commentIds });
      }
      return c.json({ imported: results.length, results });
    });

    // ── POST /api/lab/scenario/:name ──────────────────────────────────────
    app.post('/api/lab/scenario/:name', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const name = c.req.param('name');
      const scenario = findScenario(name);
      if (!scenario) {
        return c.json({ error: 'not_found', available: SCENARIOS.map((s) => s.name) }, 404);
      }

      const status = scenarioStatus.get(name)!;
      if (status.state === 'running') {
        return c.json({ status: 'running', lastRunAt: status.lastRunAt });
      }

      status.state = 'running';
      status.lastRunAt = Date.now();

      // Fire-and-forget — scenarios can take seconds; don't block the HTTP response
      void scenario
        .run()
        .then(() => {
          const s = scenarioStatus.get(name)!;
          s.state = 'done';
          s.lastRunAt = Date.now();
          log.info('lab: scenario complete', { name });
        })
        .catch((err: unknown) => {
          const s = scenarioStatus.get(name)!;
          s.state = 'error';
          s.error = err instanceof Error ? err.message : String(err);
          log.error('lab: scenario error', { name, err: s.error });
        });

      return c.json({ status: 'started', name });
    });

    // ── GET /api/lab/scenario/status/:name ───────────────────────────────
    app.get('/api/lab/scenario/status/:name', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const name = c.req.param('name');
      const status = scenarioStatus.get(name);
      if (!status) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json({ name, ...status });
    });

    // ── GET /api/lab/scenarios ─────────────────────────────────────────────
    app.get('/api/lab/scenarios', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      return c.json({
        scenarios: SCENARIOS.map((s) => ({
          name: s.name,
          description: s.description,
          status: scenarioStatus.get(s.name) ?? { state: 'idle', lastRunAt: null },
        })),
      });
    });

    // ── GET /api/lab/recent-posts ─────────────────────────────────────────
    app.get('/api/lab/recent-posts', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const members = await redis.zRange(LAB_POST_INDEX, 0, 4, {
        reverse: true,
        by: 'rank',
      });
      const postIds = members.map((m) => m.member);
      return c.json({ postIds });
    });

    // ── DELETE /api/lab/clear ──────────────────────────────────────────────
    app.delete('/api/lab/clear', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const body = await c.req.json().catch(() => null);
      const parsed = clearSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid', detail: 'body must be { "confirm": "YES" }' }, 400);
      }

      try {
        const result = await clearLabData();
        // Reset scenario statuses
        for (const s of SCENARIOS) {
          scenarioStatus.set(s.name, { state: 'idle', lastRunAt: null });
        }
        return c.json(result);
      } catch (err) {
        log.error('lab: clear failed', { err: String(err) });
        return c.json({ error: 'internal' }, 500);
      }
    });

    // ── GET /api/lab/recent-posts-full ────────────────────────────────────
    // Returns the last 5 simulated postIds for the UI quick-pick chip list
    app.get('/api/lab/recent-posts-full', async (c) => {
      const isMod = await requireMod();
      if (!isMod) return c.json({ error: 'forbidden' }, 403);

      const members = await redis.zRange(LAB_POST_INDEX, 0, 4, {
        reverse: true,
        by: 'rank',
      });
      const { getPostMeta } = await import('@shared/storage.js');
      const posts = await Promise.all(
        members.map(async (m) => {
          const meta = await getPostMeta(m.member);
          return { postId: m.member, title: meta?.title ?? m.member };
        }),
      );
      return c.json({ posts });
    });
  },
};
