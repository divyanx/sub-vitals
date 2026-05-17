/**
 * Unit tests for src/shared/studio-bridge.ts
 *
 * Rules verified:
 *   1. No-op when studio-token is empty (or absent).
 *   2. Correct headers when token is set (x-redlattice-signature, x-redlattice-timestamp).
 *   3. Retries once on 5xx, then gives up.
 *   4. Does not retry on 4xx.
 *   5. Never throws to caller under any failure.
 *   6. Rate-limit hit silently drops the event (no fetch call).
 *
 * Strategy: vi.mock the heavy dependencies (@devvit/web/server, ./ratelimit,
 * ./settings-overrides) so the test runs in plain Node without a Devvit
 * sandbox. fetch is replaced with vi.fn().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @devvit/web/server — imported by studio-bridge transitively via log.ts
// ---------------------------------------------------------------------------

vi.mock('@devvit/web/server', () => ({
  context: { subredditName: 'testSub', username: 'test_mod', userId: null, postId: null },
  redis: {},
  settings: {},
}));

// ---------------------------------------------------------------------------
// Mock shared/ratelimit — control whether tokens are available
// ---------------------------------------------------------------------------

const mockTakeToken = vi.fn<() => Promise<boolean>>();

vi.mock('@shared/ratelimit.js', () => ({
  takeToken: (...args: unknown[]) => mockTakeToken(...args),
}));

// ---------------------------------------------------------------------------
// Mock shared/settings-overrides — control studio-token + studio-url
// ---------------------------------------------------------------------------

const mockReadEffectiveSetting = vi.fn<(name: string, fallback?: unknown) => Promise<unknown>>();

vi.mock('@shared/settings-overrides.js', () => ({
  readEffectiveSetting: (name: string, fallback?: unknown) =>
    mockReadEffectiveSetting(name, fallback),
  writeOverrideSetting: vi.fn(),
  deleteOverrideSetting: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Replace globalThis.fetch with a vi.fn BEFORE importing the module
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

// Stub crypto.subtle — Node 22 has it built-in; this ensures consistent
// availability regardless of test runner configuration.
// We DO NOT mock it — we rely on the real Web Crypto API.

// ---------------------------------------------------------------------------
// Import the module under test AFTER all mocks are in place
// ---------------------------------------------------------------------------

const { forwardToStudio } = await import('../src/shared/studio-bridge.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSettings(token: string, url = 'https://studio.redlattice.app') {
  mockReadEffectiveSetting.mockImplementation(async (name: string, fallback?: unknown) => {
    if (name === 'studio-token') return token;
    if (name === 'studio-url') return url;
    return fallback;
  });
}

function makeFetchResponse(status: number): Response {
  return new Response(null, { status });
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

describe('forwardToStudio', () => {
  beforeEach(() => {
    mockTakeToken.mockResolvedValue(true); // allow by default
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. No-op when token is empty
  // -------------------------------------------------------------------------

  it('does not call fetch when studio-token is empty string', async () => {
    mockSettings('');
    await forwardToStudio('post-create', { postId: 'p1' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when studio-token setting is undefined', async () => {
    mockReadEffectiveSetting.mockResolvedValue(undefined);
    await forwardToStudio('sentiment-score', {
      id: 'c1',
      kind: 'comment',
      label: 'negative',
      score: -0.5,
      scoredBy: 'lexicon',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when rate limit is exceeded', async () => {
    mockSettings('tok-abc');
    mockTakeToken.mockResolvedValue(false);
    await forwardToStudio('post-tag', {
      postId: 'p1',
      driverId: 'bug',
      taggedBy: 'auto',
      confidence: 0.8,
      reasoning: null,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Correct headers on successful call
  // -------------------------------------------------------------------------

  it('calls fetch with correct headers and body when token is set', async () => {
    mockSettings('secret-token-xyz');
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200));

    await forwardToStudio('agent-mark', { username: 'alice', role: 'verified', byUser: 'mod1' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://studio.redlattice.app/api/webhooks/devvit');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['x-redlattice-timestamp']).toMatch(/^\d+$/);

    const sig = (init.headers as Record<string, string>)['x-redlattice-signature'];
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);

    const sentBody = JSON.parse(init.body as string) as {
      v: number;
      ts: number;
      sub: string;
      kind: string;
      payload: Record<string, unknown>;
    };
    expect(sentBody.v).toBe(1);
    expect(sentBody.kind).toBe('agent-mark');
    expect(sentBody.sub).toBe('testSub');
    expect(sentBody.payload.username).toBe('alice');
  });

  it('uses configured studio-url when present', async () => {
    mockSettings('tok', 'https://custom.studio.example.com');
    mockFetch.mockResolvedValueOnce(makeFetchResponse(200));

    await forwardToStudio('theme-regenerate', { generatedAt: 1000, themeCount: 3 });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://custom.studio.example.com/api/webhooks/devvit');
  });

  // -------------------------------------------------------------------------
  // 3. Retry on 5xx — expects 2 total calls (initial + 1 retry)
  // -------------------------------------------------------------------------

  it('retries once on 503 then gives up', async () => {
    mockSettings('tok-retry');
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse(503))
      .mockResolvedValueOnce(makeFetchResponse(503));

    // Should resolve without throwing
    await expect(
      forwardToStudio('incident-open', {
        incidentId: 'inc1',
        reason: 'spike',
        postIds: [],
        commentIds: [],
        startedAt: Date.now(),
      }),
    ).resolves.toBeUndefined();

    // p-retry: 1 initial + 1 retry = 2 calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 10_000);

  // -------------------------------------------------------------------------
  // 4. Does NOT retry on 4xx — only 1 call
  // -------------------------------------------------------------------------

  it('does not retry on 401', async () => {
    mockSettings('tok-bad');
    mockFetch.mockResolvedValueOnce(makeFetchResponse(401));

    await forwardToStudio('incident-resolve', {
      incidentId: 'inc2',
      resolvedAt: Date.now(),
      resolvedBy: 'mod1',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 5. Never throws — even on network error
  // -------------------------------------------------------------------------

  it('does not throw when fetch rejects (network error)', async () => {
    mockSettings('tok-net');
    mockFetch.mockRejectedValue(new Error('network unreachable'));

    await expect(
      forwardToStudio('comment-create', {
        commentId: 'c1',
        postId: 'p1',
        authorName: 'user1',
        createdAt: Date.now(),
      }),
    ).resolves.toBeUndefined();
  }, 10_000);

  it('does not throw when HMAC fails (should not happen in practice)', async () => {
    mockSettings('tok-hmac');
    // Simulate crypto failure by temporarily replacing crypto.subtle.importKey
    const origImportKey = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('crypto error'));

    await expect(
      forwardToStudio('post-create', { postId: 'px', authorName: 'u', title: 't', createdAt: 0 }),
    ).resolves.toBeUndefined();

    vi.spyOn(crypto.subtle, 'importKey').mockImplementation(origImportKey);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
