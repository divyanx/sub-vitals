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
import { BUILTIN_PIPELINES } from './builtin-pipelines.js';
import { K } from './keys.js';
import { log } from './log.js';
import type { Pipeline } from './types.js';

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
  kind: 'categorical' | 'ordinal' | 'cluster' | 'scalar' | 'boolean';
  trigger: 'post-create' | 'comment-create';
  systemPrompt: string;
  userPrompt: string;
  outputSchema: 'single-label' | 'label-confidence' | 'boolean' | 'scalar' | 'cluster';
  /** Labels for categorical/ordinal pipelines */
  labels?: string[];
  action: CustomPipelineAction;
  createdAt: number;
  updatedAt: number;
  order?: number;
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

// ---------------------------------------------------------------------------
// Unified pipeline listing (builtin + custom)
// ---------------------------------------------------------------------------

/**
 * Convert a CustomPipeline to the shared Pipeline interface shape so the
 * frontend and server can treat all pipelines uniformly.
 */
export function customToUnified(cp: CustomPipeline): Pipeline {
  return {
    id: cp.id,
    name: cp.name,
    description: cp.description,
    kind: cp.kind,
    trigger: cp.trigger,
    systemPrompt: cp.systemPrompt,
    userPrompt: cp.userPrompt,
    outputSchema: cp.outputSchema,
    labels: cp.labels,
    source: 'custom',
    enabled: true,
    order: cp.order,
  };
}

/**
 * Return all pipelines (builtin + custom), merging per-pipeline overrides
 * (enabled flag, order) into the builtin records.
 */
export async function listAllPipelines(): Promise<Pipeline[]> {
  const builtins = await Promise.all(
    BUILTIN_PIPELINES.map(async (bp) => {
      const overrides = await getEffectiveOverrides(bp.id);
      const order = await getPipelineOrder(bp.id);
      return {
        ...bp,
        enabled: overrides.enabled !== false,
        order: order ?? bp.order,
        systemPrompt: overrides.systemPrompt ?? bp.systemPrompt,
        userPrompt: overrides.userPrompt ?? bp.userPrompt,
      } satisfies Pipeline;
    }),
  );

  const customs = await listCustomPipelines();
  const customPipelines = customs.map(customToUnified);

  return [...builtins, ...customPipelines].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

/**
 * Return only enabled pipelines, sorted by order.
 */
export async function listEnabledPipelines(): Promise<Pipeline[]> {
  const all = await listAllPipelines();
  return all.filter((p) => p.enabled);
}

// ---------------------------------------------------------------------------
// Pipeline display order
// ---------------------------------------------------------------------------

export async function getPipelineOrder(id: string): Promise<number | null> {
  try {
    const raw = await redis.get(K.pipelineOrder(id));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function setPipelineOrder(id: string, order: number): Promise<void> {
  await redis.set(K.pipelineOrder(id), String(order));
}
