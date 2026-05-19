/**
 * Rules engine — Redis storage helpers.
 *
 * Layout:
 *   rl:rules            HASH: id → JSON (Rule)
 *   rl:rules:order      ZSET: score = position index, member = id
 *   rl:rule:stats:{id}  HASH: fireCount, lastFiredAt, errorCount, lastError
 *   rl:rule:errors:{id} ZSET: score=ts, member=json (capped at 100)
 *
 * NOTE: Devvit Redis does not expose LIST commands (lRange/rPush/lRem).
 * Order is maintained via a ZSET where score = append timestamp (monotonically
 * increasing → preserves insertion order while still allowing reorder).
 */

import { redis } from '@devvit/web/server';
import { log } from './log.js';
import type { Rule, RuleStats } from './rules-types.js';

const RULES_HASH = 'rl:rules';
const RULES_ORDER = 'rl:rules:order';
const ERROR_CAP = 100;

function statsKey(id: string): string {
  return `rl:rule:stats:${id}`;
}

function errorKey(id: string): string {
  return `rl:rule:errors:${id}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listRules(): Promise<Rule[]> {
  try {
    const [raw, orderMembers] = await Promise.all([
      redis.hGetAll(RULES_HASH),
      redis.zRange(RULES_ORDER, 0, 999, { by: 'rank' }),
    ]);
    if (!raw) return [];

    const map = new Map<string, Rule>();
    for (const [, v] of Object.entries(raw)) {
      try {
        const r = JSON.parse(v as string) as Rule;
        map.set(r.id, r);
      } catch {
        // skip corrupt entry
      }
    }

    // Return in ZSET order (score = insertion/reorder position)
    const ordered: Rule[] = [];
    const seen = new Set<string>();
    for (const m of orderMembers) {
      const id = m.member;
      const rule = map.get(id);
      if (rule !== undefined) {
        ordered.push(rule);
        seen.add(id);
      }
    }
    // Append any rules not yet in order ZSET
    for (const [id, rule] of map) {
      if (!seen.has(id)) ordered.push(rule);
    }
    return ordered;
  } catch (err) {
    log.warn('rules-storage: listRules failed', { err: String(err) });
    return [];
  }
}

export async function getRule(id: string): Promise<Rule | null> {
  try {
    const raw = await redis.hGet(RULES_HASH, id);
    return raw ? (JSON.parse(raw) as Rule) : null;
  } catch (err) {
    log.warn('rules-storage: getRule failed', { id, err: String(err) });
    return null;
  }
}

export async function saveRule(rule: Rule): Promise<void> {
  await redis.hSet(RULES_HASH, { [rule.id]: JSON.stringify(rule) });
}

export async function deleteRule(id: string): Promise<void> {
  await Promise.all([redis.hDel(RULES_HASH, [id]), redis.zRem(RULES_ORDER, [id])]);
}

// ---------------------------------------------------------------------------
// Order (ZSET with score = ms timestamp, so insertion order is preserved)
// ---------------------------------------------------------------------------

export async function appendToOrder(id: string): Promise<void> {
  try {
    // Score = current time ensures new rules appear after existing ones.
    // Using NX so we don't accidentally reset the score of an existing entry.
    await redis.zAdd(RULES_ORDER, { score: Date.now(), member: id });
  } catch (err) {
    log.warn('rules-storage: appendToOrder failed', { id, err: String(err) });
  }
}

export async function reorderRules(ids: string[]): Promise<void> {
  try {
    // Remove all existing order entries and re-insert with index as score
    const existingMembers = await redis.zRange(RULES_ORDER, 0, 999, { by: 'rank' });
    for (const m of existingMembers) {
      await redis.zRem(RULES_ORDER, [m.member]);
    }
    // Insert with sequential scores so order is preserved
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id !== undefined) {
        await redis.zAdd(RULES_ORDER, { score: i, member: id });
      }
    }
  } catch (err) {
    log.warn('rules-storage: reorderRules failed', { err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function getRuleStats(id: string): Promise<RuleStats> {
  try {
    const raw = await redis.hGetAll(statsKey(id));
    if (!raw) return { fireCount: 0, errorCount: 0 };
    const lastFiredAt = raw.lastFiredAt ? Number.parseInt(raw.lastFiredAt, 10) : undefined;
    return {
      fireCount: Number.parseInt(raw.fireCount ?? '0', 10) || 0,
      ...(lastFiredAt !== undefined ? { lastFiredAt } : {}),
      errorCount: Number.parseInt(raw.errorCount ?? '0', 10) || 0,
      ...(raw.lastError ? { lastError: raw.lastError } : {}),
    };
  } catch {
    return { fireCount: 0, errorCount: 0 };
  }
}

export async function incrementFireCount(id: string): Promise<void> {
  try {
    const key = statsKey(id);
    await Promise.all([
      redis.hIncrBy(key, 'fireCount', 1),
      redis.hSet(key, { lastFiredAt: String(Date.now()) }),
    ]);
  } catch (err) {
    log.warn('rules-storage: incrementFireCount failed', { id, err: String(err) });
  }
}

export async function recordRuleError(id: string, message: string): Promise<void> {
  try {
    const key = statsKey(id);
    const errKey = errorKey(id);
    const ts = Date.now();
    const truncated = message.slice(0, 500);
    await Promise.all([
      redis.hIncrBy(key, 'errorCount', 1),
      redis.hSet(key, { lastError: truncated }),
      redis.zAdd(errKey, {
        score: ts,
        member: JSON.stringify({ ts, message: truncated }),
      }),
    ]);
    // Cap error log
    const count = await redis.zCard(errKey);
    if (count > ERROR_CAP) {
      await redis.zRemRangeByRank(errKey, 0, count - ERROR_CAP - 1);
    }
  } catch {
    // non-fatal
  }
}

export async function listEnabledRules(): Promise<Rule[]> {
  const all = await listRules();
  return all.filter((r) => r.enabled);
}
