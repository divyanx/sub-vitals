/**
 * Permission guards.
 *
 * `requireMod` enforces moderator status on the current request. Fail-closed:
 * any error returns `false`, never `true`.
 *
 * 5-minute Redis cache keyed by username avoids hammering Reddit's API on
 * repeated mod actions. Cache key encodes only the username (Devvit Redis is
 * per-installation scoped, so the subreddit is implicit).
 */

import { context, reddit, redis } from '@devvit/web/server';
import { K } from './keys.js';
import { log } from './log.js';

const CACHE_TTL_SEC = 5 * 60;

/**
 * @returns true if the current user is a moderator of the current subreddit.
 */
export async function isCurrentUserMod(): Promise<boolean> {
  let username: string | undefined;
  let subredditName: string | undefined;
  try {
    username = context.username;
    subredditName = context.subredditName;
  } catch (err) {
    log.warn('mod-check: no request context', { err: String(err) });
    return false;
  }

  if (!username || !subredditName) {
    log.warn('mod-check: missing username or subreddit', { username, subredditName });
    return false;
  }

  // Cache lookup
  try {
    const cached = await redis.get(K.modPermCache(username));
    if (cached === '1') return true;
    if (cached === '0') return false;
  } catch (err) {
    log.warn('mod-check: cache read failed', { err: String(err) });
    // Continue to fresh check
  }

  // Fresh check
  let isMod = false;
  try {
    const mods = await reddit.getModerators({ subredditName }).all();
    isMod = mods.some((m) => m.username === username);
  } catch (err) {
    log.error('mod-check: reddit.getModerators failed', { err: String(err), subredditName });
    return false; // fail-closed
  }

  // Cache result
  try {
    await redis.set(K.modPermCache(username), isMod ? '1' : '0', {
      expiration: new Date(Date.now() + CACHE_TTL_SEC * 1000),
    });
  } catch (err) {
    log.warn('mod-check: cache write failed', { err: String(err) });
    // Non-fatal — return the live result
  }

  return isMod;
}

/**
 * Convenience helper for handlers — returns the typed result of `isCurrentUserMod`
 * with a clear name to match the architecture doc.
 */
export async function requireMod(): Promise<boolean> {
  return isCurrentUserMod();
}
