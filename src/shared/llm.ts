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
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { redis, settings } from '@devvit/web/server';
import { generateObject, NoObjectGeneratedError } from 'ai';
import pRetry, { AbortError } from 'p-retry';
import type { ZodTypeAny, z } from 'zod';
import { K, yyyymm } from './keys.js';
import { log } from './log.js';
import { takeToken } from './ratelimit.js';

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
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
  'openai/gpt-5-mini': { in: 0.025, out: 0.2 },
  'openai/gpt-5-nano': { in: 0.005, out: 0.04 },
  'google/gemini-2.5-flash': { in: 0.03, out: 0.25 },
  'google/gemini-2.5-pro': { in: 0.125, out: 1.0 },
  'meta-llama/llama-4-scout': { in: 0.011, out: 0.034 },
  default: { in: 0.2, out: 0.8 },
};

const REDIS_FIELDS = { tokensIn: 'tin', tokensOut: 'tout', cents: 'c' } as const;

export interface LLMSettings {
  apiKey: string;
  model: string;
  capCents: number;
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

  // Cache lookup
  const cacheKey = makeCacheKey(args.name, cfg.model, args.system, args.prompt);
  const cached = await readCache<z.infer<S>>(cacheKey);
  if (cached) {
    return { ok: true, data: cached, cached: true, tokensIn: 0, tokensOut: 0, costCents: 0 };
  }

  // Rate-limit gate (60 reqs / min per installation by default)
  const allowed = await takeToken({ name: 'llm', capacity: 60, refillPerSec: 1 });
  if (!allowed) {
    return { ok: false, reason: 'rate-limited' };
  }

  // Build provider + model handle
  const openrouter = createOpenAICompatible({
    name: 'openrouter',
    apiKey: cfg.apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': 'https://github.com/devvit/redlattice',
      'X-Title': 'RedLattice',
    },
  });
  const modelHandle = openrouter(cfg.model);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), TIMEOUT_MS);

  try {
    const result = await pRetry(
      async () => {
        try {
          return await generateObject({
            model: modelHandle,
            schema: args.schema,
            ...(args.system ? { system: args.system } : {}),
            prompt: args.prompt,
            maxOutputTokens: args.maxTokens ?? 200,
            temperature: args.temperature ?? 0.2,
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
  const [apiKey, model, capCents] = await Promise.all([
    settings.get('openrouter-api-key').catch(() => undefined),
    settings.get('llm-model').catch(() => undefined),
    settings.get('llm-monthly-cost-cap-cents').catch(() => undefined),
  ]);
  return {
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    model: typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL,
    capCents: typeof capCents === 'number' && capCents > 0 ? capCents : DEFAULT_CAP_CENTS,
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
