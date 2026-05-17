/**
 * Settings overrides — Redis-backed runtime overrides for user-editable settings.
 *
 * Key pattern: rl:cfg:{name}  (STRING, JSON-encoded value)
 *
 * Read path: Redis override first, fall back to Devvit settings.get(name).
 * Write path: Redis only.
 *
 * Keys listed in OVERRIDABLE_KEYS are the full set that the Settings tab
 * exposes in the dashboard. openrouter-api-key is intentionally excluded —
 * it is global + secret and must only be set via `npx devvit settings set`.
 */

import { redis, settings } from '@devvit/web/server';

/** All setting names that can be overridden via Redis (shown in Settings tab). */
export const OVERRIDABLE_KEYS = [
  'brand-name',
  'brand-voice',
  'agent-flair-pattern',
  'agent-flair-text',
  'agent-flair-color',
  'sentiment-threshold',
  'sla-minutes',
  'routing-json',
  'taxonomy-json',
  'agent-whitelist',
  'llm-model',
  'llm-monthly-cost-cap-cents',
  'studio-url',
  'studio-token',
] as const;

export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];

function overrideKey(name: string): string {
  return `rl:cfg:${name}`;
}

/**
 * Read the effective value for a setting. Checks Redis override first,
 * then falls back to Devvit settings.get(). Returns `fallback` (or
 * `undefined`) when neither source has a value.
 */
export async function readEffectiveSetting<T = unknown>(
  name: string,
  fallback?: T,
): Promise<T | undefined> {
  // 1. Redis override
  try {
    const raw = await redis.get(overrideKey(name));
    if (raw !== null && raw !== undefined) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // If Redis read or JSON.parse fails, fall through to settings.get
  }

  // 2. Devvit settings
  try {
    const v = await settings.get(name);
    if (v !== null && v !== undefined) {
      return v as T;
    }
  } catch {
    // settings.get can throw if the key doesn't exist or isn't scoped correctly
  }

  return fallback;
}

/**
 * Write a value to the Redis override store. Value is JSON-encoded.
 */
export async function writeOverrideSetting(
  name: string,
  value: string | number | boolean,
): Promise<void> {
  await redis.set(overrideKey(name), JSON.stringify(value));
}

/**
 * Delete the Redis override for a setting, causing reads to fall back to
 * the Devvit-declared default.
 */
export async function deleteOverrideSetting(name: string): Promise<void> {
  await redis.del(overrideKey(name));
}

/**
 * Read all overridable settings at once, merging Redis overrides with
 * Devvit settings.get() fallbacks. Returns a record keyed by setting name.
 * Missing values are omitted from the record.
 */
export async function readAllEffectiveSettings(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  await Promise.all(
    OVERRIDABLE_KEYS.map(async (name) => {
      const v = await readEffectiveSetting(name);
      if (v !== null && v !== undefined) {
        result[name] = v;
      }
    }),
  );

  return result;
}
