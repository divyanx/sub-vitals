/**
 * Tag storage helper.
 *
 * Tags are the unified output record from any pipeline (builtin or custom).
 * Storage layout:
 *   - rl:tags:{targetType}:{targetId}  HASH  → field = pipelineId, value = JSON Tag
 *   - rl:tag:idx:{pipelineId}:{encodedValue}  ZSET → score = createdAt, member = targetId
 */

import { redis } from '@devvit/web/server';
import { K } from './keys.js';
import { log } from './log.js';
import type { Tag, TagDistributionEntry } from './types.js';

// Lazy import to avoid circular deps — rules-engine imports tags.ts
async function fireRulesOnTag(tag: Tag): Promise<void> {
  try {
    const { onTagWrite } = await import('./rules-engine.js');
    const payload: {
      pipelineId: string;
      value: string | number | boolean;
      confidence?: number;
      targetId: string;
      targetType: 'post' | 'comment';
    } = {
      pipelineId: tag.pipelineId,
      value: tag.value,
      targetId: tag.targetId,
      targetType: tag.targetType,
    };
    if (tag.confidence !== undefined) {
      payload.confidence = tag.confidence;
    }
    await onTagWrite(payload);
  } catch (err) {
    log.warn('tags: rules engine hook failed (non-fatal)', { err: String(err) });
  }
}

/**
 * After each tag-write on a post, re-derive flair + maybe-comment so the
 * native Reddit mod queue shows current enrichment. Comment-only tags
 * (Tag.targetType === 'comment') are skipped — flair only applies to
 * posts. Lazy import + best-effort to avoid feedback loops.
 */
async function fireModSurfaceOnTag(tag: Tag): Promise<void> {
  if (tag.targetType !== 'post') return;
  try {
    const { recomputeForPost } = await import('../modules/mod-surface/index.js');
    await recomputeForPost(tag.targetId);
  } catch (err) {
    log.warn('tags: mod-surface hook failed (non-fatal)', { err: String(err) });
  }
}

const TAG_INDEX_CAP = 1000;

/**
 * Write a tag and update the per-pipeline-value index.
 * Idempotent: overwrites an existing tag for the same pipeline + target.
 */
export async function recordTag(tag: Tag): Promise<void> {
  try {
    const key = K.tagTarget(tag.targetType, tag.targetId);
    await redis.hSet(key, { [tag.pipelineId]: JSON.stringify(tag) });
    const idxKey = K.tagValueIndex(tag.pipelineId, String(tag.value));
    await redis.zAdd(idxKey, { score: tag.createdAt, member: tag.targetId });
    const count = await redis.zCard(idxKey);
    if (count > TAG_INDEX_CAP) {
      await redis.zRemRangeByRank(idxKey, 0, count - TAG_INDEX_CAP - 1);
    }
    // Fire rules engine hook — non-blocking, failure-isolated
    void fireRulesOnTag(tag);
    // Project enrichment into the native Reddit mod queue (flair + sticky
    // analysis comment). Also non-blocking + failure-isolated.
    void fireModSurfaceOnTag(tag);
  } catch (err) {
    // Non-fatal: existing modules keep working even if tag write fails.
    log.warn('tags: recordTag failed (non-fatal)', {
      pipelineId: tag.pipelineId,
      targetId: tag.targetId,
      err: String(err),
    });
  }
}

/** Read all tags for a single target (e.g. one post). */
export async function getTagsForTarget(
  targetType: 'post' | 'comment',
  targetId: string,
): Promise<Tag[]> {
  try {
    const raw = await redis.hGetAll(K.tagTarget(targetType, targetId));
    if (!raw) return [];
    return Object.values(raw).map((v) => JSON.parse(v) as Tag);
  } catch (err) {
    log.warn('tags: getTagsForTarget failed', { targetType, targetId, err: String(err) });
    return [];
  }
}

/** Read a single tag for a given pipeline + target. */
export async function getTag(
  pipelineId: string,
  targetType: 'post' | 'comment',
  targetId: string,
): Promise<Tag | null> {
  try {
    const raw = await redis.hGet(K.tagTarget(targetType, targetId), pipelineId);
    return raw ? (JSON.parse(raw) as Tag) : null;
  } catch (err) {
    log.warn('tags: getTag failed', { pipelineId, targetId, err: String(err) });
    return null;
  }
}

/**
 * Return the most-recent targetIds (posts/comments) that have a given
 * pipeline+value combination.
 */
export async function getTargetsByTagValue(
  pipelineId: string,
  value: string,
  limit = 50,
): Promise<string[]> {
  try {
    const members = await redis.zRange(K.tagValueIndex(pipelineId, value), 0, limit - 1, {
      reverse: true,
      by: 'rank',
    });
    return members.map((m) => m.member);
  } catch (err) {
    log.warn('tags: getTargetsByTagValue failed', { pipelineId, value, err: String(err) });
    return [];
  }
}

/**
 * Return the value distribution for a pipeline over recent targets.
 *
 * This is an approximation: we scan the known value indexes and return their
 * cardinalities. Fast because each ZSET count is O(1).
 */
export async function getTagDistribution(
  pipelineId: string,
  knownValues: string[],
): Promise<TagDistributionEntry[]> {
  const results = await Promise.all(
    knownValues.map(async (value) => {
      const count = await redis.zCard(K.tagValueIndex(pipelineId, value));
      return { value, count };
    }),
  );
  return results.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

/**
 * Get distribution from index — discovers actual values by pattern scan is
 * not available in Devvit Redis, so callers must supply knownValues.
 * For unknown-label pipelines, use a sentinel set.
 */
export async function getTagDistributionWithSentinel(
  pipelineId: string,
  sentinelKey: string,
): Promise<TagDistributionEntry[]> {
  try {
    // The sentinel key stores all observed values as ZSET members (score=count).
    const members = await redis.zRange(sentinelKey, 0, 99, { reverse: true, by: 'rank' });
    const values = members.map((m) => m.member);
    return getTagDistribution(pipelineId, values);
  } catch {
    return [];
  }
}

/**
 * Maintain a "values seen" sentinel ZSET for a pipeline.
 * Called by recordTag for pipelines that don't have a fixed label set.
 */
export async function trackTagValue(pipelineId: string, value: string): Promise<void> {
  try {
    const key = `rl:tag:vals:${pipelineId}`;
    await redis.zAdd(key, { score: Date.now(), member: value });
  } catch {
    // non-fatal
  }
}
