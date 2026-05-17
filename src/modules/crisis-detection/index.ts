/**
 * Module 04 — Crisis / Spike Detection
 * Tier: PRO · Phase 2
 *
 * Detects when comment volume or negative sentiment spikes vs a rolling 14-day
 * baseline, groups related activity into an "incident", and sends a modmail.
 *
 * State in Redis:
 *   rl:hr:cmt:{YYYY-MM-DDTHH}  HASH  { total, neg }  TTL 30 days
 *   rl:incident:active          HASH  { id }          TTL 30 min (touch on each comment)
 *   rl:incident:{id}            STRING JSON Incident   TTL 30 days
 *   rl:incident:list            ZSET  score=startedAt
 *
 * Trigger: onCommentCreate only. Scoring is done inline via scoreText (no race
 * with sentiment module; we don't depend on its Redis writes landing first).
 */

import { context, reddit, redis } from '@devvit/web/server';
import { recordAudit } from '@modules/audit-log/index.js';
import { scoreText } from '@modules/sentiment/index.js';
import { currentHourSlot, K } from '@shared/keys.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  claimActiveIncident,
  clearActiveIncident,
  getActiveIncidentId,
  getIncident,
  getPostMeta,
  listIncidentIds,
  refreshActiveIncidentTTL,
  saveIncident,
} from '@shared/storage.js';
import type { Incident, OnCommentCreateRequest, RedLatticeModule } from '@shared/types.js';
import { commentCreateMinimalSchema } from '@shared/validation.js';
import type { Hono } from 'hono';
import { nanoid } from './nanoid.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUR_TTL_SEC = 30 * 24 * 60 * 60; // 30 days
/** How many recent hour buckets to sample for the baseline (14 days) */
const MAX_SAMPLE = 336;
/** Minimum comments in current hour before we even attempt spike detection */
const MIN_HOUR_TOTAL = 5;
/** Neg rate threshold: 50% of comments negative */
const NEG_RATE_THRESHOLD = 0.5;
/** Volume spike multiplier vs p95 */
const VOLUME_SPIKE_MULTIPLIER = 1.5;
/** Negative count spike multiplier vs p95 of neg buckets */
const NEG_SPIKE_MULTIPLIER = 2.0;
/** Max post links to include in the opening modmail */
const MODMAIL_EXAMPLE_COUNT = 5;
/** Auto-resolve quiet window: no new activity attached = incident stays resolved */
const QUIET_WINDOW_MS = 30 * 60 * 1000; // 30 min

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const crisisDetectionModule: RedLatticeModule = {
  name: 'crisis-detection',
  description: 'Detects comment-volume and sentiment spikes; opens incident modmails.',
  tier: 'pro',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onCommentCreate(event: OnCommentCreateRequest): Promise<void> {
    const parsed = commentCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.comment) return;
    const comment = parsed.data.comment;
    if (!comment.id) return;

    const postId = comment.postId ?? null;
    const text = comment.body ?? '';
    const { label } = scoreText(text);
    const isNeg = label === 'negative';

    // 1. Increment current-hour bucket
    const slot = currentHourSlot();
    const bucketKey = K.hourBucket(slot);
    await redis.hIncrBy(bucketKey, 'total', 1);
    if (isNeg) await redis.hIncrBy(bucketKey, 'neg', 1);
    await redis.expire(bucketKey, HOUR_TTL_SEC);

    // 2. Read current bucket stats
    const bucketRaw = await redis.hGetAll(bucketKey);
    const hourTotal = Number(bucketRaw?.total ?? '0');
    const hourNeg = Number(bucketRaw?.neg ?? '0');

    // 3. Auto-resolve if active incident has been quiet (TTL lapsed = key gone)
    // If rl:incident:active is missing but we have a record pointing to it,
    // the platform TTL already cleaned it. Nothing to do — our "no active" path
    // handles it below.

    // 4. Check if we need to declare or attach to an incident
    if (hourTotal >= MIN_HOUR_TOTAL) {
      const spike = await detectSpike(slot, hourTotal, hourNeg);
      if (spike) {
        await handleSpike({
          reason: spike,
          commentId: comment.id,
          postId,
          hourTotal,
          hourNeg,
        });
      } else {
        // Still within normal range — if active incident exists, attach & refresh
        const activeId = await getActiveIncidentId();
        if (activeId) {
          await attachToIncident(activeId, comment.id, postId);
        }
      }
    }
  },

  apiRoutes(app: Hono): void {
    // -----------------------------------------------------------------------
    // Crisis detection API
    // -----------------------------------------------------------------------

    /** GET /api/incidents?status=active|resolved|all  (default: active) */
    app.get('/api/incidents', async (c) => {
      const statusParam = (c.req.query('status') ?? 'active') as string;
      const ids = await listIncidentIds(100);
      const incidents = (await Promise.all(ids.map((id) => getIncident(id)))).filter(
        (inc): inc is Incident => inc !== null,
      );
      const filtered =
        statusParam === 'all' ? incidents : incidents.filter((inc) => inc.status === statusParam);
      return c.json({ incidents: filtered, count: filtered.length });
    });

    /** GET /api/incidents/:id */
    app.get('/api/incidents/:id', async (c) => {
      const id = c.req.param('id');
      const incident = await getIncident(id);
      if (!incident) return c.json({ error: 'not found' }, 404);

      // Enrich with post metas for convenience
      const posts = await Promise.all(incident.postIds.map((pid) => getPostMeta(pid)));
      return c.json({ incident, posts: posts.filter((p) => p !== null) });
    });

    /** POST /api/incidents/:id/resolve  (mod-only) */
    app.post('/api/incidents/:id/resolve', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const id = c.req.param('id');
      const incident = await getIncident(id);
      if (!incident) return c.json({ error: 'not found' }, 404);
      if (incident.status === 'resolved') return c.json({ incident });

      const resolved: Incident = {
        ...incident,
        status: 'resolved',
        resolvedAt: Date.now(),
        resolvedBy: context.username ?? 'unknown',
      };
      await saveIncident(resolved);

      // If this was the active incident, clear the pointer
      const activeId = await getActiveIncidentId();
      if (activeId === id) await clearActiveIncident();

      log.info('crisis: incident resolved manually', { id, by: resolved.resolvedBy });
      void recordAudit('incident-resolve', id, { resolvedBy: resolved.resolvedBy });
      return c.json({ incident: resolved });
    });
  },
};

// ---------------------------------------------------------------------------
// Spike detection logic
// ---------------------------------------------------------------------------

/**
 * Compare current-hour stats against a 14-day rolling baseline.
 * Returns a human-readable reason string if a spike is detected, else null.
 */
async function detectSpike(
  currentSlot: string,
  hourTotal: number,
  hourNeg: number,
): Promise<string | null> {
  // Build list of the last BASELINE_HOURS slot strings (excluding the current one)
  const slots = pastHourSlots(currentSlot, MAX_SAMPLE);
  if (slots.length === 0) return null;

  // Fetch all buckets in parallel
  const rawBuckets = await Promise.all(slots.map((s) => redis.hGetAll(K.hourBucket(s))));
  const totals: number[] = [];
  const negs: number[] = [];
  for (const b of rawBuckets) {
    if (!b || Object.keys(b).length === 0) continue;
    totals.push(Number(b.total ?? '0'));
    negs.push(Number(b.neg ?? '0'));
  }

  if (totals.length < 6) return null; // not enough history

  const p95Total = percentile(totals, 95);
  const p95Neg = percentile(negs, 95);
  const negRate = hourTotal > 0 ? hourNeg / hourTotal : 0;

  if (hourTotal > p95Total * VOLUME_SPIKE_MULTIPLIER) {
    return `Volume spike: ${hourTotal} comments this hour vs p95 baseline ${p95Total.toFixed(1)}`;
  }
  if (negRate >= NEG_RATE_THRESHOLD && hourTotal >= MIN_HOUR_TOTAL) {
    return `Negative-rate spike: ${Math.round(negRate * 100)}% negative (${hourNeg}/${hourTotal})`;
  }
  if (p95Neg > 0 && hourNeg > p95Neg * NEG_SPIKE_MULTIPLIER) {
    return `Negative-count spike: ${hourNeg} negative comments vs p95 baseline ${p95Neg.toFixed(1)}`;
  }
  return null;
}

/** Attach a comment (and optionally its post) to an existing open incident. */
async function attachToIncident(
  incidentId: string,
  commentId: string,
  postId: string | null,
): Promise<void> {
  const incident = await getIncident(incidentId);
  if (!incident || incident.status !== 'open') return;

  let changed = false;
  if (!incident.commentIds.includes(commentId)) {
    incident.commentIds.push(commentId);
    changed = true;
  }
  if (postId && !incident.postIds.includes(postId)) {
    incident.postIds.push(postId);
    changed = true;
  }
  if (changed) {
    await saveIncident(incident);
    await refreshActiveIncidentTTL();
  }
}

/** Open a new incident or attach to the existing one. */
async function handleSpike(args: {
  reason: string;
  commentId: string;
  postId: string | null;
  hourTotal: number;
  hourNeg: number;
}): Promise<void> {
  // Try to attach to existing active incident first
  const existingId = await getActiveIncidentId();
  if (existingId) {
    await attachToIncident(existingId, args.commentId, args.postId);
    return;
  }

  // No active incident — try to open one atomically
  const newId = nanoid();
  const claimed = await claimActiveIncident(newId);
  if (!claimed) {
    // Another concurrent handler just claimed it — attach to that one
    const nowActive = await getActiveIncidentId();
    if (nowActive) await attachToIncident(nowActive, args.commentId, args.postId);
    return;
  }

  // We own the new incident
  const incident: Incident = {
    id: newId,
    startedAt: Date.now(),
    reason: args.reason,
    postIds: args.postId ? [args.postId] : [],
    commentIds: [args.commentId],
    status: 'open',
  };
  await saveIncident(incident);

  log.info('crisis: incident opened', {
    id: newId,
    reason: args.reason,
    hourTotal: args.hourTotal,
    hourNeg: args.hourNeg,
  });

  await sendOpenModmail(incident);
}

async function sendOpenModmail(incident: Incident): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) {
    log.warn('crisis: no subredditName in context, skipping modmail');
    return;
  }

  // Fetch first N post metas for links
  const firstPostIds = incident.postIds.slice(0, MODMAIL_EXAMPLE_COUNT);
  const postMetas = await Promise.all(firstPostIds.map((id) => getPostMeta(id)));

  const lines: string[] = [
    `**[RedLattice] Crisis incident opened — ${incident.id}**`,
    '',
    `**Reason:** ${incident.reason}`,
    `**Started:** ${new Date(incident.startedAt).toUTCString()}`,
    '',
    'Recent posts in this spike:',
  ];
  for (const meta of postMetas) {
    if (meta) {
      lines.push(`- [${meta.title}](${meta.url})`);
    }
  }
  if (incident.postIds.length > MODMAIL_EXAMPLE_COUNT) {
    lines.push(`_(and ${incident.postIds.length - MODMAIL_EXAMPLE_COUNT} more)_`);
  }
  lines.push('');
  lines.push(
    'Resolve via `POST /api/incidents/:id/resolve` or let it auto-expire after 30 min of quiet.',
  );

  try {
    await reddit.modMail.createConversation({
      subredditName,
      to: null,
      subject: `[RedLattice] Crisis incident ${incident.id}`,
      body: lines.join('\n'),
    });
    log.info('crisis: opening modmail sent', { id: incident.id });
  } catch (err) {
    log.error('crisis: modmail send failed', {
      id: incident.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Stat helpers
// ---------------------------------------------------------------------------

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))] ?? 0;
}

/**
 * Build the list of past hour slot strings before `currentSlot`,
 * newest first, up to `count` entries.
 */
function pastHourSlots(currentSlot: string, count: number): string[] {
  // Parse the current slot as a UTC date
  const base = new Date(`${currentSlot}:00:00Z`);
  const slots: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(base.getTime() - i * 60 * 60 * 1000);
    slots.push(d.toISOString().slice(0, 13));
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Quiet-period resolution check (called from daily-aggregate scheduler too)
// ---------------------------------------------------------------------------

/**
 * Check if the active incident has been quiet (its TTL-based key has expired).
 * If so, mark it resolved. Safe to call from any scheduler context.
 *
 * Note: Devvit Redis TTL auto-removes `rl:incident:active` after 30 min of no
 * `refreshActiveIncidentTTL` calls. We detect this by checking whether the
 * key still exists.
 */
export async function autoResolveQuietIncidents(): Promise<void> {
  const activeId = await getActiveIncidentId();
  if (activeId) return; // still active — TTL not expired

  // The key is gone — find any 'open' incidents and close them
  const ids = await listIncidentIds(20);
  for (const id of ids) {
    const inc = await getIncident(id);
    if (!inc || inc.status !== 'open') continue;
    if (Date.now() - inc.startedAt > QUIET_WINDOW_MS) {
      const resolved: Incident = {
        ...inc,
        status: 'resolved',
        resolvedAt: Date.now(),
        resolvedBy: 'auto',
      };
      await saveIncident(resolved);
      log.info('crisis: incident auto-resolved (quiet window)', { id });
    }
  }
}
