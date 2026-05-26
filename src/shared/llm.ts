/**
 * LLM client — OpenRouter via Vercel AI SDK.
 *
 * Wraps `generateObject` with:
 *   - Lazy provider init (reads `openrouter-api-key` global setting)
 *   - Configurable model (`llm-model` global setting, defaults to claude-haiku-4.5)
 *   - Token-based monthly cost tracking (rl:cost:{YYYY-MM} HASH)
 *   - Hard cap per installation (`llm-monthly-cost-cap-cents` global setting)
 *   - Per-installation rate limit (token bucket)
 *   - 15 s AbortController timeout
 *   - 3-attempt p-retry with exponential backoff + jitter
 *   - SHA-256 prompt-hash response cache (24 h TTL)
 *   - Returns `{ ok: false, reason }` instead of throwing — callers fall back to lexicon
 *
 * Cost model: OpenRouter exposes per-request token counts; we keep a rough
 * per-1k-tokens cents table per model and estimate cumulative spend. Not as
 * accurate as billing data but enough to enforce a hard cap. Conservative
 * defaults round up.
 */

import { createHash } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { reddit, redis, settings } from '@devvit/web/server';
import { generateObject, NoObjectGeneratedError } from 'ai';
import pRetry, { AbortError } from 'p-retry';
import type { ZodTypeAny, z } from 'zod';
import { DEFAULT_MODEL } from './ai-models.js';
import { K, today, yyyymm } from './keys.js';
import { log } from './log.js';
import { takeToken } from './ratelimit.js';
import { readEffectiveSetting } from './settings-overrides.js';

// Re-export so callers can import from one place.
export { DEFAULT_MODEL };
const TIMEOUT_MS = 15_000;
const RETRIES = 3;
const CACHE_TTL_SEC = 24 * 60 * 60;
const DEFAULT_CAP_CENTS = 500;

/**
 * Rough cost table — USD cents per 1K input / 1K output tokens.
 * Used to estimate cumulative spend. Update as needed.
 */
const COST_PER_1K: Record<string, { in: number; out: number }> = {
  'anthropic/claude-haiku-4.5': { in: 0.1, out: 0.5 },
  'anthropic/claude-sonnet-4.6': { in: 0.3, out: 1.5 },
  'gpt-5.4-mini': { in: 0.015, out: 0.06 },
  'gpt-5.4-nano': { in: 0.005, out: 0.02 },
  'google/gemini-2.5-flash': { in: 0.03, out: 0.25 },
  'google/gemini-2.5-pro': { in: 0.125, out: 1.0 },

  'gpt-5.4': { in: 0.25, out: 1.0 },
  'meta-llama/llama-4-scout': { in: 0.011, out: 0.034 },
  default: { in: 0.2, out: 0.8 },
};

const REDIS_FIELDS = { tokensIn: 'tin', tokensOut: 'tout', cents: 'c' } as const;

// ---------------------------------------------------------------------------
// Fallback constants
// ---------------------------------------------------------------------------

const FALLBACK_ERROR_THRESHOLD = 3; // errors in 24h before we flip to default
const FALLBACK_ERROR_TTL_SEC = 48 * 60 * 60; // 48h — covers the HINCRBY key
const FALLBACK_FLAG_TTL_SEC = 7 * 24 * 60 * 60; // 7d sticky flag

export interface LLMSettings {
  apiKey: string;
  model: string;
  capCents: number;
  isFallback: boolean;
  /** The slug that was configured before fallback kicked in (null when not in fallback). */
  originalSlug: string | null;
}

export type LLMSuccess<T> = {
  ok: true;
  data: T;
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
};

export type LLMFailure = {
  ok: false;
  reason: 'no-api-key' | 'cost-cap-exceeded' | 'rate-limited' | 'timeout' | 'no-object' | 'error';
  error?: string;
};

export type LLMResult<T> = LLMSuccess<T> | LLMFailure;

// ---------------------------------------------------------------------------
// Public API — fallback helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the model that will actually be used for a call.
 * If the mod-configured model has a sticky fallback flag, returns DEFAULT_MODEL.
 * The original setting is preserved in Redis so the mod can fix it.
 */
export async function getEffectiveModel(): Promise<{ model: string; isFallback: boolean }> {
  const configured = await readEffectiveSetting<string>('llm-model');
  const slug =
    typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_MODEL;

  if (slug === DEFAULT_MODEL) {
    return { model: slug, isFallback: false };
  }

  const flag = await redis.get(K.llmFallbackActive(slug)).catch(() => null);
  if (flag) {
    return { model: DEFAULT_MODEL, isFallback: true };
  }
  return { model: slug, isFallback: false };
}

/** Returns the original configured slug if fallback is active, otherwise null. */
export async function getFallbackOriginalSlug(): Promise<string | null> {
  const configured = await readEffectiveSetting<string>('llm-model');
  const slug =
    typeof configured === 'string' && configured.trim() ? configured.trim() : DEFAULT_MODEL;
  if (slug === DEFAULT_MODEL) return null;
  const flag = await redis.get(K.llmFallbackActive(slug)).catch(() => null);
  return flag ? slug : null;
}

/** Clears the sticky fallback flag for the given slug. Called after mod fixes the setting. */
export async function clearFallback(slug: string): Promise<void> {
  await redis.del(K.llmFallbackActive(slug));
  log.info('llm: fallback flag cleared', { slug });
}

/** Returns true if the model has an active fallback flag. */
export async function isFallbackActive(slug: string): Promise<boolean> {
  const flag = await redis.get(K.llmFallbackActive(slug)).catch(() => null);
  return !!flag;
}

/**
 * Increment the per-model daily error count and trigger fallback if the threshold
 * is crossed. Sends a modmail notification on first activation.
 * Returns true if fallback was newly activated.
 */
async function trackModelError(slug: string, reason: string): Promise<boolean> {
  if (slug === DEFAULT_MODEL) return false; // never fallback the default

  const key = K.llmErrorDay(today());
  const field = slug;

  let count = 0;
  try {
    count = await redis.hIncrBy(key, field, 1);
    // Set/refresh the TTL on every write so it lives 48h from last write.
    await redis.expire(key, FALLBACK_ERROR_TTL_SEC);
  } catch (err) {
    log.warn('llm: error tracking write failed', { err: String(err) });
    return false;
  }

  if (count < FALLBACK_ERROR_THRESHOLD) return false;

  // Check if flag already set (avoid duplicate modmail).
  const flagKey = K.llmFallbackActive(slug);
  const existing = await redis.get(flagKey).catch(() => null);
  if (existing) return false; // already triggered

  // Set the sticky flag.
  try {
    await redis.set(flagKey, reason, {
      expiration: new Date(Date.now() + FALLBACK_FLAG_TTL_SEC * 1000),
    });
  } catch (err) {
    log.warn('llm: fallback flag write failed', { err: String(err) });
    return false;
  }

  log.warn('llm: auto-fallback activated', { slug, count, reason, fallbackTo: DEFAULT_MODEL });

  // Attempt modmail — non-fatal if it fails.
  try {
    await reddit.modMail.createConversation({
      subredditName: null as unknown as string, // platform fills in from installation context
      to: null,
      subject: 'SubVitals: AI model auto-switched',
      body: [
        `SubVitals auto-switched your AI model from **${slug}** to **${DEFAULT_MODEL}** because of repeated errors (${FALLBACK_ERROR_THRESHOLD}+ in 24h).`,
        '',
        `Last error reason: ${reason}`,
        '',
        'Visit **Settings → AI** in the SubVitals dashboard to fix the setting or accept the default.',
      ].join('\n'),
    });
  } catch (mailErr) {
    log.warn('llm: modmail send failed after fallback activation', { err: String(mailErr) });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a structured-output LLM call. Returns the typed result or a failure
 * descriptor — never throws. Caller decides what to do on failure.
 */
export async function llmObject<S extends ZodTypeAny>(args: {
  /** Logical name of this call type (e.g. "contact-drivers-tag") — used for rate-limit bucket + cache namespace. */
  name: string;
  /** Zod schema describing the expected JSON object. */
  schema: S;
  /** Full prompt to send. Goes into the user message. */
  prompt: string;
  /** Optional system message (model instructions, persona). */
  system?: string;
  /** Max tokens to generate. Default 200 — keep small for classification tasks. */
  maxTokens?: number;
  /** Temperature. Default 0.2 — low for classification consistency. */
  temperature?: number;
}): Promise<LLMResult<z.infer<S>>> {
  const cfg = await readSettings();
  if (!cfg.apiKey) {
    return { ok: false, reason: 'no-api-key' };
  }

  // Cost cap pre-check
  const spent = await readMonthlyCents();
  if (spent >= cfg.capCents) {
    log.warn('llm: monthly cost cap exceeded', { spent, cap: cfg.capCents });
    return { ok: false, reason: 'cost-cap-exceeded' };
  }

  // Cache lookup (use effective model for cache key so fallback hits a different bucket)
  const cacheKey = makeCacheKey(args.name, cfg.model, args.system, args.prompt);
  const cached = await readCache<z.infer<S>>(cacheKey);
  if (cached) {
    return { ok: true, data: cached, cached: true, tokensIn: 0, tokensOut: 0, costCents: 0 };
  }

  // Rate-limit gate (60 reqs / min per installation by default)
  const allowed = await takeToken({ name: 'llm', capacity: 10, refillPerSec: 0.5 });
  if (!allowed) {
    return { ok: false, reason: 'rate-limited' };
  }

  // Official @ai-sdk/openai provider — handles OpenAI model quirks
  // (max_completion_tokens, reasoning_effort, etc.) natively.
  // openrouter.ai is blocked by Devvit's outbound HTTP gate pending
  // api@reddit.com approval; api.openai.com is in devvit.json.
  const provider = createOpenAI({ apiKey: cfg.apiKey });
  const modelHandle = provider(cfg.model);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), TIMEOUT_MS);

  // Track the originally-configured slug (before fallback) for error accounting.
  const configuredSlug = cfg.originalSlug;

  // o-series are reasoning models: they consume ~128-256 tokens of the
  // output budget on internal reasoning BEFORE producing any content, and
  // they reject non-default `temperature`. Compensate so small callers
  // (e.g. sentiment with maxTokens=120) don't silently return empty.
  const isReasoning = /^(o1|o3|o4)/.test(cfg.model);
  const requestedMax = args.maxTokens ?? 200;
  const effectiveMax = isReasoning ? Math.max(requestedMax + 512, 768) : requestedMax;

  try {
    const result = await pRetry(
      async () => {
        try {
          return await generateObject({
            model: modelHandle,
            schema: args.schema,
            ...(args.system ? { system: args.system } : {}),
            prompt: args.prompt,
            maxOutputTokens: effectiveMax,
            ...(isReasoning ? {} : { temperature: args.temperature ?? 0.2 }),
            abortSignal: ac.signal,
          });
        } catch (err) {
          // Don't retry abort / no-object / non-transient errors.
          if (ac.signal.aborted) throw new AbortError('timeout');
          if (err instanceof NoObjectGeneratedError) throw new AbortError('no-object');
          throw err;
        }
      },
      {
        retries: RETRIES,
        factor: 2,
        minTimeout: 250,
        maxTimeout: 4_000,
        randomize: true,
      },
    );

    const tokensIn = result.usage?.inputTokens ?? 0;
    const tokensOut = result.usage?.outputTokens ?? 0;
    const costCents = estimateCents(cfg.model, tokensIn, tokensOut);

    await Promise.all([
      writeCache(cacheKey, result.object),
      recordSpend(tokensIn, tokensOut, costCents),
    ]);

    log.info('llm: call ok', {
      name: args.name,
      model: cfg.model,
      isFallback: cfg.isFallback,
      tokensIn,
      tokensOut,
      costCents: Number(costCents.toFixed(4)),
    });
    return {
      ok: true,
      data: result.object as z.infer<S>,
      cached: false,
      tokensIn,
      tokensOut,
      costCents,
    };
  } catch (err) {
    const reason = classifyError(err);
    log.warn('llm: call failed', {
      name: args.name,
      reason,
      err: err instanceof Error ? err.message : String(err),
    });
    // Track errors against the originally-configured slug, not the fallback slug.
    if (configuredSlug) {
      void trackModelError(configuredSlug, reason);
    }
    return { ok: false, reason, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read cumulative spend for the current month in cents. Used by dashboard +
 * pre-flight cost cap check.
 */
export async function readMonthlyCents(): Promise<number> {
  const raw = await redis.hGet(K.llmCostMonth(yyyymm()), REDIS_FIELDS.cents);
  if (!raw) return 0;
  // Cents stored as integer micro-cents (×1000) for hIncrBy fidelity.
  return Number(raw) / 1000;
}

export async function readMonthlyTokens(): Promise<{ tokensIn: number; tokensOut: number }> {
  const all = await redis.hGetAll(K.llmCostMonth(yyyymm()));
  return {
    tokensIn: Number(all?.[REDIS_FIELDS.tokensIn] ?? '0'),
    tokensOut: Number(all?.[REDIS_FIELDS.tokensOut] ?? '0'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readSettings(): Promise<LLMSettings> {
  // openrouter-api-key is global+secret — never override via Redis.
  const [apiKey, capCents, { model, isFallback }] = await Promise.all([
    settings.get('openrouter-api-key').catch(() => undefined),
    readEffectiveSetting<number>('llm-monthly-cost-cap-cents'),
    getEffectiveModel(),
  ]);
  const configuredRaw = await readEffectiveSetting<string>('llm-model');
  const configured =
    typeof configuredRaw === 'string' && configuredRaw.trim()
      ? configuredRaw.trim()
      : DEFAULT_MODEL;

  return {
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    model,
    capCents: typeof capCents === 'number' && capCents > 0 ? capCents : DEFAULT_CAP_CENTS,
    isFallback,
    originalSlug: isFallback ? configured : null,
  };
}

function makeCacheKey(
  name: string,
  model: string,
  system: string | undefined,
  prompt: string,
): string {
  const hash = createHash('sha256')
    .update(`${name}${model}${system ?? ''}${prompt}`)
    .digest('hex')
    .slice(0, 32);
  return K.llmCache(hash);
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn('llm: cache read failed', { err: String(err), key });
    return null;
  }
}

async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), {
      expiration: new Date(Date.now() + CACHE_TTL_SEC * 1000),
    });
  } catch (err) {
    log.warn('llm: cache write failed', { err: String(err), key });
  }
}

const FALLBACK_PRICE = { in: 0.2, out: 0.8 };

function estimateCents(model: string, tokensIn: number, tokensOut: number): number {
  const price = COST_PER_1K[model] ?? COST_PER_1K.default ?? FALLBACK_PRICE;
  return (tokensIn / 1000) * price.in + (tokensOut / 1000) * price.out;
}

async function recordSpend(tokensIn: number, tokensOut: number, costCents: number): Promise<void> {
  const key = K.llmCostMonth(yyyymm());
  try {
    await Promise.all([
      redis.hIncrBy(key, REDIS_FIELDS.tokensIn, tokensIn),
      redis.hIncrBy(key, REDIS_FIELDS.tokensOut, tokensOut),
      // Cost stored as integer micro-cents (×1000) for hIncrBy fidelity.
      redis.hIncrBy(key, REDIS_FIELDS.cents, Math.round(costCents * 1000)),
    ]);
    // Hold rollups for 60 days then let them go.
    await redis.expire(key, 60 * 24 * 60 * 60);
  } catch (err) {
    log.warn('llm: spend record failed', { err: String(err) });
  }
}

function classifyError(err: unknown): LLMFailure['reason'] {
  if (err instanceof AbortError) {
    return err.message === 'no-object' ? 'no-object' : 'timeout';
  }
  if (err instanceof Error && err.name === 'AbortError') return 'timeout';
  return 'error';
}
