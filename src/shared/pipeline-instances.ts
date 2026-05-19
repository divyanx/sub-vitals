/**
 * Pipeline instance storage — Redis-backed CRUD for PipelineInstance records.
 *
 * Storage layout:
 *   rl:pipelines:instances  HASH  instanceId → JSON(PipelineInstance)
 *   rl:pipelines:order      LIST  ordered instance ids (display order)
 *   rl:pipelines:seed:done  STRING  "1" after first seed
 *
 * Migration path (lazy, on first read):
 *   If the instances HASH is empty, seed from PREINSTALLED_TEMPLATE_IDS
 *   (creates 7 pre-installed instances) + migrate any legacy CustomPipeline rows
 *   to PipelineInstance with source='scratch'.
 */

import { redis } from '@devvit/web/server';
import { nanoid } from '../modules/crisis-detection/nanoid.js';
import { K } from './keys.js';
import { log } from './log.js';
import { PIPELINE_TEMPLATES, PREINSTALLED_TEMPLATE_IDS } from './pipeline-templates.js';
import type {
  PipelineInstance,
  PipelineInstanceConfig,
  PipelineInstanceSource,
  PipelineShowIn,
  PipelineTemplate,
} from './types.js';

// ---------------------------------------------------------------------------
// Showln defaults — where each pre-installed instance's output appears
// ---------------------------------------------------------------------------

const PREINSTALLED_SHOWIN: Record<string, PipelineShowIn[]> = {
  'intent-classifier': ['insights'],
  'sentiment-scorer': ['insights'],
  'topic-clusterer': ['insights'],
  'impostor-flagger': ['audit'],
  'volume-spike-detector': ['incidents'],
  'team-response-tracker': ['team'],
  'root-cause-summariser': ['insights'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Seed / migration (idempotent)
// ---------------------------------------------------------------------------

/**
 * Seed 7 pre-installed instances from templates. Idempotent — uses hSetNX on
 * the seed sentinel so concurrent AppInstall triggers can't double-seed.
 *
 * Also migrates legacy CustomPipeline rows to PipelineInstance with
 * source='scratch' on first run.
 */
export async function seedInstancesIfNeeded(): Promise<void> {
  // Idempotency: only run if the HASH is truly empty
  const existing = await redis.hLen(K.pipelineInstances());
  if (existing > 0) return;

  log.info('pipeline-instances: seeding pre-installed instances');

  const now = Date.now();
  for (let i = 0; i < PREINSTALLED_TEMPLATE_IDS.length; i++) {
    const tplId = PREINSTALLED_TEMPLATE_IDS[i];
    if (!tplId) continue;
    const tpl = PIPELINE_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) continue;
    const id = `pi_${tplId}`;
    const instance: PipelineInstance = {
      id,
      templateId: tplId,
      name: tpl.name,
      description: tpl.shortDescription,
      enabled: true,
      config: { ...tpl.defaultConfig },
      source: 'preinstalled',
      createdAt: now,
      updatedAt: now,
      showIn: PREINSTALLED_SHOWIN[tplId] ?? ['insights'],
      order: i,
    };
    await redis.hSet(K.pipelineInstances(), { [id]: JSON.stringify(instance) });
  }

  // Migrate legacy custom pipelines (best-effort, non-blocking)
  try {
    const customListRaw = await redis.zRange(K.customPipelineList(), 0, 49, { by: 'rank' });
    for (const entry of customListRaw) {
      const legacyId = entry.member;
      const raw = await redis.get(K.customPipeline(legacyId));
      if (!raw) continue;
      const legacy = JSON.parse(raw) as {
        id: string;
        name: string;
        description: string;
        kind: PipelineInstance['config']['outputSchema'];
        trigger: PipelineInstanceConfig['trigger'];
        systemPrompt: string;
        userPrompt: string;
        outputSchema: PipelineInstanceConfig['outputSchema'];
        labels?: string[];
        createdAt: number;
        updatedAt: number;
        order?: number;
      };
      const migratedId = `pi_scratch_${legacyId}`;
      const migrated: PipelineInstance = {
        id: migratedId,
        templateId: 'scratch',
        name: legacy.name,
        description: legacy.description,
        enabled: true,
        config: {
          trigger: legacy.trigger,
          systemPrompt: legacy.systemPrompt,
          userPrompt: legacy.userPrompt,
          outputSchema: legacy.outputSchema,
          labels: legacy.labels,
        },
        source: 'scratch',
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        showIn: ['insights'],
        order: legacy.order,
      };
      await redis.hSet(K.pipelineInstances(), { [migratedId]: JSON.stringify(migrated) });
    }
  } catch (err) {
    log.warn('pipeline-instances: legacy migration failed (non-fatal)', { err: String(err) });
  }

  log.info('pipeline-instances: seed complete');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getInstance(id: string): Promise<PipelineInstance | null> {
  await seedInstancesIfNeeded();
  const raw = await redis.hGet(K.pipelineInstances(), id);
  return raw ? (JSON.parse(raw) as PipelineInstance) : null;
}

export async function listInstances(): Promise<PipelineInstance[]> {
  await seedInstancesIfNeeded();
  const all = await redis.hGetAll(K.pipelineInstances());
  if (!all) return [];
  const instances = Object.values(all)
    .map((v) => JSON.parse(v) as PipelineInstance)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return instances;
}

export async function listEnabledInstances(): Promise<PipelineInstance[]> {
  const all = await listInstances();
  return all.filter((i) => i.enabled);
}

export async function saveInstance(instance: PipelineInstance): Promise<void> {
  await redis.hSet(K.pipelineInstances(), { [instance.id]: JSON.stringify(instance) });
}

/**
 * Install a new instance from a template with optional config overrides.
 * source = 'installed'.
 */
export async function installFromTemplate(opts: {
  templateId: string;
  name?: string;
  configOverrides?: Partial<PipelineInstanceConfig>;
  showIn?: PipelineShowIn[];
}): Promise<PipelineInstance> {
  await seedInstancesIfNeeded();
  const tpl = PIPELINE_TEMPLATES.find((t) => t.id === opts.templateId);
  if (!tpl) throw new Error(`Unknown template: ${opts.templateId}`);

  // Determine display order (append at end)
  const existing = await listInstances();
  const maxOrder = existing.reduce((m, i) => Math.max(m, i.order ?? 0), 0);

  const id = `pi_${nanoid()}`;
  const instance: PipelineInstance = {
    id,
    templateId: opts.templateId,
    name: opts.name ?? tpl.name,
    description: tpl.shortDescription,
    enabled: true,
    config: {
      ...tpl.defaultConfig,
      ...(opts.configOverrides ?? {}),
    },
    source: 'installed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    showIn: opts.showIn ?? PREINSTALLED_SHOWIN[opts.templateId] ?? ['insights'],
    order: maxOrder + 1,
  };
  await saveInstance(instance);
  return instance;
}

/**
 * Create a new from-scratch instance (no template).
 * source = 'scratch'.
 */
export async function createScratchInstance(opts: {
  name: string;
  kind: string;
  config: PipelineInstanceConfig;
  showIn?: PipelineShowIn[];
}): Promise<PipelineInstance> {
  await seedInstancesIfNeeded();
  const existing = await listInstances();
  const maxOrder = existing.reduce((m, i) => Math.max(m, i.order ?? 0), 0);

  const id = `pi_scratch_${nanoid()}`;
  const instance: PipelineInstance = {
    id,
    templateId: 'scratch',
    name: opts.name,
    enabled: true,
    config: opts.config,
    source: 'scratch',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    showIn: opts.showIn ?? ['insights'],
    order: maxOrder + 1,
  };
  await saveInstance(instance);
  return instance;
}

/**
 * Update mutable fields on an existing instance.
 * Refuses to delete preinstalled instances — disables them instead.
 */
export async function patchInstance(
  id: string,
  patch: Partial<
    Pick<PipelineInstance, 'name' | 'description' | 'enabled' | 'config' | 'showIn' | 'order'>
  >,
): Promise<PipelineInstance | null> {
  const existing = await getInstance(id);
  if (!existing) return null;
  const updated: PipelineInstance = {
    ...existing,
    ...patch,
    id: existing.id,
    templateId: existing.templateId,
    source: existing.source,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };
  await saveInstance(updated);
  return updated;
}

/**
 * Delete an instance. Pre-installed instances cannot be deleted — they are
 * disabled instead. Returns { deleted: true } or { deleted: false, disabled: true }.
 */
export async function deleteInstance(
  id: string,
): Promise<{ deleted: boolean; disabled?: boolean }> {
  const existing = await getInstance(id);
  if (!existing) return { deleted: false };
  if (existing.source === 'preinstalled') {
    // Cannot delete pre-installed — disable instead
    await patchInstance(id, { enabled: false });
    return { deleted: false, disabled: true };
  }
  await redis.hDel(K.pipelineInstances(), [id]);
  return { deleted: true };
}

/**
 * Duplicate an instance with a new id and " (copy)" suffix.
 */
export async function duplicateInstance(id: string): Promise<PipelineInstance | null> {
  const existing = await getInstance(id);
  if (!existing) return null;
  const allInstances = await listInstances();
  const maxOrder = allInstances.reduce((m, i) => Math.max(m, i.order ?? 0), 0);

  const newId = `pi_${nanoid()}`;
  const copy: PipelineInstance = {
    ...existing,
    id: newId,
    name: `${existing.name} (copy)`,
    source: 'installed', // copies are no longer preinstalled
    createdAt: Date.now(),
    updatedAt: Date.now(),
    order: maxOrder + 1,
  };
  await saveInstance(copy);
  return copy;
}

/**
 * Reorder all instances in bulk. Accepts an ordered array of instance ids.
 */
export async function reorderInstances(orderedIds: string[]): Promise<void> {
  await seedInstancesIfNeeded();
  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    if (!id) continue;
    const raw = await redis.hGet(K.pipelineInstances(), id);
    if (!raw) continue;
    const instance = JSON.parse(raw) as PipelineInstance;
    instance.order = i;
    instance.updatedAt = Date.now();
    await redis.hSet(K.pipelineInstances(), { [id]: JSON.stringify(instance) });
  }
}

/**
 * Look up the effective config for a pre-installed instance by its template id.
 * Used by modules that previously read hardcoded prompts — they now read from here.
 * Falls back to template defaults if no instance is found.
 */
export async function getEffectiveInstanceConfig(
  templateId: string,
): Promise<PipelineInstanceConfig | null> {
  await seedInstancesIfNeeded();
  // Find the first enabled instance for this template
  const all = await redis.hGetAll(K.pipelineInstances());
  if (!all) return null;
  const found = Object.values(all)
    .map((v) => JSON.parse(v) as PipelineInstance)
    .find((i) => i.templateId === templateId && i.enabled);
  if (found) return found.config;
  // Fall back to template defaults
  const tpl = PIPELINE_TEMPLATES.find((t) => t.id === templateId);
  return tpl ? { ...tpl.defaultConfig } : null;
}
