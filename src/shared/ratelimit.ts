/**
 * Token-bucket rate limiter on Devvit Redis.
 *
 * Why hand-rolled: `@upstash/ratelimit` is the standard choice but requires
 * Upstash Redis's REST interface — Devvit's RedisClient is a different shape.
 * Wrapping it would be more code than the ~30 lines here.
 *
 * Algorithm: each named bucket holds two fields — `tokens` (current balance)
 * and `ts` (last refill timestamp ms). On every `takeToken`, we:
 *   1. Read current state.
 *   2. Refill based on elapsed time × refillPerSec, capped at `capacity`.
 *   3. If tokens >= 1, decrement and write back, return true.
 *   4. Otherwise write back the refill (no decrement), return false.
 *
 * This is not strictly atomic (read-then-write). Under high concurrency we
 * may slightly overshoot — fine for cost-control rate limiting where the
 * downside is "one extra LLM call". If we ever need strict guarantees we can
 * swap to a Lua script via `redis.eval`.
 */

import { redis } from '@devvit/web/server';
import { K } from './keys.js';

export interface TokenBucketConfig {
  /** Bucket name, used as the Redis key suffix. */
  name: string;
  /** Max tokens in the bucket. */
  capacity: number;
  /** Tokens refilled per second. */
  refillPerSec: number;
}

interface BucketState {
  tokens: number;
  ts: number;
}

/**
 * Attempt to take one token. Returns true if a token was available (caller
 * may proceed), false otherwise (caller should back off or fail closed).
 */
export async function takeToken(cfg: TokenBucketConfig): Promise<boolean> {
  const key = K.rateLimit(cfg.name);
  const now = Date.now();

  const raw = await redis.hGetAll(key);
  const prev: BucketState =
    raw?.tokens && raw?.ts
      ? { tokens: Number(raw.tokens), ts: Number(raw.ts) }
      : { tokens: cfg.capacity, ts: now };

  const elapsedSec = Math.max(0, (now - prev.ts) / 1000);
  const refilled = Math.min(cfg.capacity, prev.tokens + elapsedSec * cfg.refillPerSec);

  if (refilled >= 1) {
    await redis.hSet(key, { tokens: String(refilled - 1), ts: String(now) });
    await redis.expire(key, Math.ceil(cfg.capacity / cfg.refillPerSec) * 2);
    return true;
  }

  await redis.hSet(key, { tokens: String(refilled), ts: String(now) });
  await redis.expire(key, Math.ceil(cfg.capacity / cfg.refillPerSec) * 2);
  return false;
}
