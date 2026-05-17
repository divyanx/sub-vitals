/**
 * Module dispatcher.
 *
 * Fans trigger events to every registered module that subscribes, in parallel,
 * with failure isolation — one module throwing on a handler never breaks the
 * others. Each module's `enabled()` is checked first.
 */

// TODO(Sprint 13): Custom pipeline runtime — currently custom pipelines are persisted only.
// The dispatcher does not yet fan events to custom pipelines. Implement in Sprint 13 after
// the schema stabilizes. See listCustomPipelines() in pipeline-overrides.ts for the data model.

import { log } from './log.js';
import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentCreateRequest,
  OnModActionRequest,
  OnPostCreateRequest,
  OnPostUpdateRequest,
  RedLatticeModule,
} from './types.js';

interface EventMap {
  onAppInstall: OnAppInstallRequest;
  onAppUpgrade: OnAppUpgradeRequest;
  onPostCreate: OnPostCreateRequest;
  onPostUpdate: OnPostUpdateRequest;
  onCommentCreate: OnCommentCreateRequest;
  onModAction: OnModActionRequest;
}

const modules: RedLatticeModule[] = [];

export function registerModule(mod: RedLatticeModule): void {
  modules.push(mod);
  log.info('module registered', { name: mod.name, tier: mod.tier });
}

export function listModules(): readonly RedLatticeModule[] {
  return modules;
}

export async function dispatch<E extends keyof EventMap>(
  event: E,
  payload: EventMap[E],
): Promise<void> {
  const handlers: Array<Promise<void>> = [];
  for (const mod of modules) {
    const handler = mod[event];
    if (typeof handler !== 'function') continue;
    handlers.push(runOne(mod, event, handler as (e: EventMap[E]) => Promise<void>, payload));
  }
  await Promise.allSettled(handlers);
}

async function runOne<E extends keyof EventMap>(
  mod: RedLatticeModule,
  event: E,
  handler: (e: EventMap[E]) => Promise<void>,
  payload: EventMap[E],
): Promise<void> {
  try {
    const enabled = await mod.enabled();
    if (!enabled) return;
    await handler.call(mod, payload);
  } catch (err) {
    log.error('module handler threw', {
      module: mod.name,
      event,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
