/**
 * Idempotency guard for write-once semantics.
 *
 * Devvit's PostCreate / CommentCreate triggers can fire more than once for
 * the same content (platform retries, automod re-approval). Any handler that
 * increments a counter must gate the increment behind this check.
 *
 * Implementation: HSETNX claims the slot atomically (returns 1 on first
 * write, 0 on repeat). Then EXPIRE applies the TTL.
 */

import { redis } from '@devvit/web/server';
import { K } from './keys.js';

const DEFAULT_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

/**
 * Claim the right to process (handler, contentId) exactly once.
 *
 * @returns true if this is the first processing attempt (proceed), false if
 *          we've already processed it (skip).
 */
export async function processedOnce(
  handler: string,
  contentId: string,
  ttlSec: number = DEFAULT_TTL_SEC,
): Promise<boolean> {
  const key = K.processed(handler, contentId);
  const claimed = await redis.hSetNX(key, 'p', '1');
  if (claimed === 1) {
    await redis.expire(key, ttlSec);
    return true;
  }
  return false;
}

/**
 * Release the claim so the next call to processedOnce(handler, contentId)
 * will succeed again. Used by retry-queue handlers after a transient
 * failure — without this the retry would no-op because the original
 * attempt set the sentinel.
 */
export async function clearProcessedSentinel(handler: string, contentId: string): Promise<void> {
  const key = K.processed(handler, contentId);
  await redis.del(key).catch(() => {});
}
