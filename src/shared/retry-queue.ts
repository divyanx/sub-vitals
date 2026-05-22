/**
 * Dead-letter / retry queue for background work that fails transiently.
 *
 * Design rationale
 * ----------------
 * - Every long-running or external-dependency call has failure modes:
 *   LLM API timeouts, Reddit rate limits, transient 503s. The local
 *   p-retry inside llmObject() handles short-burst failures, but doesn't
 *   help when the upstream is degraded for >10s. Without a DLQ, those
 *   failures vanish silently — the post never gets tagged, ever.
 *
 * - Stored as a per-job-type Redis ZSET. Score = the millisecond timestamp
 *   the item becomes eligible for retry. Member = JSON { attempts,
 *   payload, firstSeenAt }. Workers drain due items via zRange + zRem.
 *
 * - Exponential backoff: 30s, 2m, 8m, 30m, 2h. Cap at 5 attempts ~= 3h
 *   of retries. After that the job is dropped (and audit-logged).
 *
 * - Idempotent: pushing the same payload-shape twice yields one entry
 *   (we hash payload into the member string). Handlers MUST be safe to
 *   re-run — checking for prior side effects (tag already written, etc.)
 *   is the handler's responsibility.
 *
 * - Per-installation scoped (every key starts `rl:dlq:`). No
 *   cross-installation leakage; the 5MB Redis cap is per-installation.
 *
 * Usage
 * -----
 *   import { enqueueRetry, drainRetries } from '@shared/retry-queue.js';
 *
 *   // On transient failure inside a handler:
 *   await enqueueRetry('pipeline-run', { instanceId, postId });
 *
 *   // Inside the scheduler tick (every 5 min):
 *   await drainRetries('pipeline-run', async ({ instanceId, postId }) => {
 *     await retryPipelineRun(instanceId, postId);
 *   });
 *
 * Adding a new job type
 * ---------------------
 * 1. Pick a stable string key (e.g. `pipeline-run`, `theme-regenerate`).
 * 2. Define the payload shape — keep it small (under ~1KB) and JSON-safe.
 * 3. Call `enqueueRetry(key, payload)` from the failure site.
 * 4. Register a handler in the scheduler's sweep tick.
 */

import { redis } from '@devvit/web/server';
import { log } from './log.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum attempts before dropping the job. */
const MAX_ATTEMPTS = 5;

/** Backoff schedule in seconds, indexed by attempt count (1-based). */
const BACKOFF_SCHEDULE_SEC = [30, 120, 480, 1800, 7200];

/** Per-job-type queue size cap. Prevents runaway growth during outages. */
const QUEUE_CAP = 500;

/** Per-handler drain budget — drain at most this many items per tick. */
const DRAIN_BUDGET = 50;

const queueKey = (jobType: string) => `rl:dlq:${jobType}`;

// ---------------------------------------------------------------------------
// Payload encoding — stable, deterministic so the same payload dedupes.
// ---------------------------------------------------------------------------

interface QueueEntry<P> {
  attempts: number;
  firstSeenAt: number;
  payload: P;
}

function encodeMember<P>(entry: QueueEntry<P>): string {
  // Stable key ordering so identical payloads produce identical members.
  // Using JSON with sorted keys at the top level is sufficient since
  // payloads are kept small + flat.
  return JSON.stringify(entry, Object.keys(entry).sort());
}

function decodeMember<P>(member: string): QueueEntry<P> | null {
  try {
    return JSON.parse(member) as QueueEntry<P>;
  } catch {
    return null;
  }
}

function nextRetryTime(attempts: number): number {
  // attempts=1 means "we tried once and failed, schedule the first retry"
  const idx = Math.max(0, Math.min(attempts - 1, BACKOFF_SCHEDULE_SEC.length - 1));
  const delaySec = BACKOFF_SCHEDULE_SEC[idx] ?? 7200;
  // Add ±20% jitter so concurrent failures don't all retry at the same tick
  const jitterMs = (Math.random() - 0.5) * 0.4 * delaySec * 1000;
  return Date.now() + delaySec * 1000 + jitterMs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Push a job onto its retry queue. Idempotent against identical payloads
 * arriving in the same attempt-bucket — duplicate members coalesce.
 *
 * Returns the number of NEW entries added (0 if it was a duplicate, 1
 * if newly queued). Callers can use this to log "already queued, skipping".
 */
export async function enqueueRetry<P>(
  jobType: string,
  payload: P,
  opts?: { attempts?: number; firstSeenAt?: number },
): Promise<number> {
  const attempts = opts?.attempts ?? 1;
  const firstSeenAt = opts?.firstSeenAt ?? Date.now();

  if (attempts > MAX_ATTEMPTS) {
    log.warn('retry-queue: dropping job after max attempts', {
      jobType,
      attempts,
      firstSeenAt,
      payload,
    });
    return 0;
  }

  const entry: QueueEntry<P> = { attempts, firstSeenAt, payload };
  const member = encodeMember(entry);
  const score = nextRetryTime(attempts);

  try {
    const added = await redis.zAdd(queueKey(jobType), { score, member });

    // Trim if the queue grew past the cap (during an outage).
    // Drops oldest-by-score (i.e. items already past their retry time).
    const total = await redis.zCard(queueKey(jobType));
    if (total > QUEUE_CAP) {
      await redis.zRemRangeByRank(queueKey(jobType), 0, total - QUEUE_CAP - 1);
    }

    if (added === 1) {
      log.info('retry-queue: enqueued', {
        jobType,
        attempts,
        retryInSec: Math.round((score - Date.now()) / 1000),
      });
    }
    return added;
  } catch (err) {
    log.warn('retry-queue: enqueue failed (non-fatal)', {
      jobType,
      err: String(err),
    });
    return 0;
  }
}

/**
 * Drain due items for one job type. Calls `handler(payload)` for each.
 *
 * - Handler success → item removed from queue.
 * - Handler throws → item re-queued with bumped attempt count and the
 *   next backoff delay. After MAX_ATTEMPTS, dropped.
 *
 * Caps work at DRAIN_BUDGET items per call so a single tick can't
 * monopolize the scheduler handler timeout (Devvit kills handlers at
 * ~30s).
 *
 * Returns counts so the caller can log progress.
 */
export async function drainRetries<P>(
  jobType: string,
  handler: (payload: P) => Promise<void>,
): Promise<{ tried: number; succeeded: number; rescheduled: number; dropped: number }> {
  const stats = { tried: 0, succeeded: 0, rescheduled: 0, dropped: 0 };
  const now = Date.now();

  let due: { member: string; score: number }[];
  try {
    // Read due items (score <= now), oldest first.
    due = await redis.zRange(queueKey(jobType), 0, now, {
      by: 'score',
      limit: { offset: 0, count: DRAIN_BUDGET },
    });
  } catch (err) {
    log.warn('retry-queue: drain read failed (non-fatal)', { jobType, err: String(err) });
    return stats;
  }

  for (const item of due) {
    const entry = decodeMember<P>(item.member);
    if (!entry) {
      // Corrupt entry — remove and continue.
      await redis.zRem(queueKey(jobType), [item.member]).catch(() => {});
      continue;
    }
    stats.tried += 1;

    try {
      await handler(entry.payload);
      // Success — drop from queue.
      await redis.zRem(queueKey(jobType), [item.member]).catch(() => {});
      stats.succeeded += 1;
    } catch (err) {
      // Failure — remove old entry, re-enqueue with bumped attempts.
      await redis.zRem(queueKey(jobType), [item.member]).catch(() => {});
      const nextAttempts = entry.attempts + 1;
      if (nextAttempts > MAX_ATTEMPTS) {
        stats.dropped += 1;
        log.warn('retry-queue: dropping after max attempts', {
          jobType,
          attempts: entry.attempts,
          payload: entry.payload,
          err: String(err),
        });
      } else {
        await enqueueRetry(jobType, entry.payload, {
          attempts: nextAttempts,
          firstSeenAt: entry.firstSeenAt,
        });
        stats.rescheduled += 1;
      }
    }
  }

  if (stats.tried > 0) {
    log.info('retry-queue: drain done', { jobType, ...stats });
  }
  return stats;
}

/**
 * Inspect queue depth without modifying it. Useful for the dashboard or
 * admin diagnostics endpoint.
 */
export async function queueDepth(jobType: string): Promise<{ total: number; due: number }> {
  try {
    const [total, dueItems] = await Promise.all([
      redis.zCard(queueKey(jobType)),
      redis.zRange(queueKey(jobType), 0, Date.now(), {
        by: 'score',
        limit: { offset: 0, count: QUEUE_CAP },
      }),
    ]);
    return { total, due: dueItems.length };
  } catch {
    return { total: 0, due: 0 };
  }
}
