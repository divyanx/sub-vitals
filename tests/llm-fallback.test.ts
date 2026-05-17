/**
 * Unit tests for the LLM auto-fallback mechanism.
 *
 * We mock @devvit/web/server (redis + reddit) and @shared/settings-overrides
 * so these tests run outside of the Devvit platform.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const redisStore = new Map<string, string>();
const redisHashes = new Map<string, Map<string, string>>();

const redisMock = {
  get: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
  }),
  del: vi.fn(async (key: string) => {
    redisStore.delete(key);
  }),
  hIncrBy: vi.fn(async (key: string, field: string, by: number) => {
    if (!redisHashes.has(key)) redisHashes.set(key, new Map());
    const hash = redisHashes.get(key) as Map<string, string>;
    const prev = Number(hash.get(field) ?? '0');
    const next = prev + by;
    hash.set(field, String(next));
    return next;
  }),
  hGet: vi.fn(async (key: string, field: string) => {
    return redisHashes.get(key)?.get(field) ?? null;
  }),
  hGetAll: vi.fn(async (key: string) => {
    const h = redisHashes.get(key);
    if (!h) return {};
    return Object.fromEntries(h);
  }),
  expire: vi.fn(async () => undefined),
};

const redditMock = {
  sendModmail: vi.fn(async () => undefined),
};

vi.mock('@devvit/web/server', () => ({
  redis: redisMock,
  reddit: redditMock,
  settings: {
    get: vi.fn(async () => 'test-api-key'),
  },
}));

vi.mock('../src/shared/settings-overrides.ts', () => ({
  readEffectiveSetting: vi.fn(async (key: string) => {
    if (key === 'llm-model') return 'openai/gpt-5';
    if (key === 'llm-monthly-cost-cap-cents') return 500;
    return undefined;
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLM fallback: getEffectiveModel', () => {
  beforeEach(() => {
    redisStore.clear();
    redisHashes.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('returns the configured model when no fallback flag is set', async () => {
    // Dynamically import after mocks are set up.
    const { getEffectiveModel } = await import('../src/shared/llm.ts');
    const result = await getEffectiveModel();
    expect(result.model).toBe('openai/gpt-5');
    expect(result.isFallback).toBe(false);
  });

  it('returns DEFAULT_MODEL when the fallback flag is active', async () => {
    const { DEFAULT_MODEL, getEffectiveModel } = await import('../src/shared/llm.ts');
    const { K } = await import('../src/shared/keys.ts');
    // Simulate an active fallback flag.
    redisStore.set(K.llmFallbackActive('openai/gpt-5'), 'error');

    const result = await getEffectiveModel();
    expect(result.model).toBe(DEFAULT_MODEL);
    expect(result.isFallback).toBe(true);
  });
});

describe('LLM fallback: clearFallback', () => {
  beforeEach(() => {
    redisStore.clear();
    redisHashes.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('removes the sticky flag', async () => {
    const { clearFallback, isFallbackActive } = await import('../src/shared/llm.ts');
    const { K } = await import('../src/shared/keys.ts');

    redisStore.set(K.llmFallbackActive('openai/gpt-5'), 'error');
    expect(await isFallbackActive('openai/gpt-5')).toBe(true);

    await clearFallback('openai/gpt-5');
    expect(await isFallbackActive('openai/gpt-5')).toBe(false);
  });
});
