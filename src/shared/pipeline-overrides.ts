/**
 * Pipeline overrides — Redis-backed tuning for built-in pipelines + custom
 * pipeline CRUD.
 *
 * Override storage format:
 *   KEY: rl:pipeline:{id}:overrides
 *   VALUE: JSON blob — partial shape:
 *   {
 *     systemPrompt?: string;
 *     userPrompt?: string;
 *     thresholds?: Record<string, number>;
 *     enabled?: boolean;
 *   }
 *
 * Callers merge overrides on top of built-in defaults via `getEffectiveOverrides`.
 */

import { redis } from '@devvit/web/server';
import { K } from './keys.js';
import { log } from './log.js';

export interface PipelineOverrides {
  systemPrompt?: string;
  userPrompt?: string;
  thresholds?: Record<string, number>;
  enabled?: boolean;
}

export interface CustomPipeline {
  id: string;
  name: string;
  description: string;
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: 'single-label' | 'label-confidence' | 'boolean';
  action: CustomPipelineAction;
  createdAt: number;
  updatedAt: number;
}

export type CustomPipelineAction =
  | { type: 'tag-driver'; driverId: string }
  | { type: 'send-modmail'; bodyTemplate: string }
  | { type: 'set-status'; status: 'open' | 'in-progress' | 'resolved' };

/**
 * Read the stored overrides for a built-in pipeline. Returns `{}` when none.
 */
export async function getEffectiveOverrides(pipelineId: string): Promise<PipelineOverrides> {
  try {
    const raw = await redis.get(K.pipelineOverrides(pipelineId));
    if (!raw) return {};
    return JSON.parse(raw) as PipelineOverrides;
  } catch (err) {
    log.warn('pipeline-overrides: read failed (non-fatal)', { pipelineId, err: String(err) });
    return {};
  }
}

/**
 * Save overrides for a built-in pipeline. Merges with existing overrides so
 * callers can update individual fields without clobbering others.
 */
export async function saveOverrides(
  pipelineId: string,
  patch: Partial<PipelineOverrides>,
): Promise<PipelineOverrides> {
  const existing = await getEffectiveOverrides(pipelineId);
  const mergedThresholds =
    patch.thresholds !== undefined
      ? { ...(existing.thresholds ?? {}), ...patch.thresholds }
      : existing.thresholds;

  const merged: PipelineOverrides = {
    ...existing,
    ...patch,
  };
  if (mergedThresholds !== undefined) {
    merged.thresholds = mergedThresholds;
  } else {
    delete merged.thresholds;
  }
  await redis.set(K.pipelineOverrides(pipelineId), JSON.stringify(merged));
  return merged;
}

/**
 * Return `true` if the pipeline is enabled (default = true for built-ins).
 */
export async function isEnabled(pipelineId: string): Promise<boolean> {
  const overrides = await getEffectiveOverrides(pipelineId);
  return overrides.enabled !== false; // explicitly false = disabled, anything else = enabled
}

/**
 * Read the effective prompt with Redis override > provided default.
 * If no override exists, returns the default.
 */
export async function getEffectivePrompt(
  pipelineId: string,
  defaults: { systemPrompt: string; userPrompt: string },
): Promise<{ systemPrompt: string; userPrompt: string }> {
  const overrides = await getEffectiveOverrides(pipelineId);
  return {
    systemPrompt: overrides.systemPrompt ?? defaults.systemPrompt,
    userPrompt: overrides.userPrompt ?? defaults.userPrompt,
  };
}

// ---------------------------------------------------------------------------
// Custom pipelines CRUD
// ---------------------------------------------------------------------------

const CUSTOM_CAP = 50;

export async function listCustomPipelines(): Promise<CustomPipeline[]> {
  const members = await redis.zRange(K.customPipelineList(), 0, CUSTOM_CAP - 1, {
    reverse: true,
    by: 'rank',
  });
  const ids = members.map((m) => m.member);
  const records = await Promise.all(
    ids.map(async (id) => {
      const raw = await redis.get(K.customPipeline(id));
      return raw ? (JSON.parse(raw) as CustomPipeline) : null;
    }),
  );
  return records.filter((r): r is CustomPipeline => r !== null);
}

export async function getCustomPipeline(id: string): Promise<CustomPipeline | null> {
  const raw = await redis.get(K.customPipeline(id));
  return raw ? (JSON.parse(raw) as CustomPipeline) : null;
}

export async function saveCustomPipeline(pipeline: CustomPipeline): Promise<void> {
  await redis.set(K.customPipeline(pipeline.id), JSON.stringify(pipeline));
  await redis.zAdd(K.customPipelineList(), { score: pipeline.createdAt, member: pipeline.id });
}

export async function deleteCustomPipeline(id: string): Promise<void> {
  await redis.del(K.customPipeline(id));
  await redis.zRem(K.customPipelineList(), [id]);
}
