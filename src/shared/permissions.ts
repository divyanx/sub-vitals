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
const MOD_LIST_TTL_SEC = 5 * 60;
const MOD_LIST_KEY = 'rl:perm:modlist';

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

/**
 * Returns the full lowercased moderator-username set for the current
 * subreddit, cached for 5 minutes in Redis. Used by `isUserMod` and by
 * triggers that need to bulk-check incoming comment authors without
 * making one Reddit API call per comment.
 *
 * Falls back to an empty set on any failure — fail-closed.
 */
export async function getModUsernames(): Promise<Set<string>> {
  const subredditName = context.subredditName;
  if (!subredditName) return new Set();

  try {
    const cached = await redis.get(MOD_LIST_KEY);
    if (cached) return new Set(JSON.parse(cached) as string[]);
  } catch (err) {
    log.warn('mod-list: cache read failed', { err: String(err) });
  }

  let usernames: string[] = [];
  try {
    const mods = await reddit.getModerators({ subredditName }).all();
    usernames = mods.map((m) => m.username.toLowerCase()).filter(Boolean);
  } catch (err) {
    log.error('mod-list: reddit.getModerators failed', { err: String(err), subredditName });
    return new Set();
  }

  try {
    await redis.set(MOD_LIST_KEY, JSON.stringify(usernames), {
      expiration: new Date(Date.now() + MOD_LIST_TTL_SEC * 1000),
    });
  } catch (err) {
    log.warn('mod-list: cache write failed', { err: String(err) });
  }

  return new Set(usernames);
}

/**
 * Cheap, cached check — is the given username a moderator of the current sub?
 * Mods are presumed to be brand employees (they have admin keys to the sub).
 */
export async function isUserMod(username: string): Promise<boolean> {
  if (!username) return false;
  const mods = await getModUsernames();
  return mods.has(username.toLowerCase());
}
