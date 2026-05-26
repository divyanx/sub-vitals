/**
 * Studio Bridge — outbound webhook helper.
 *
 * Exports `forwardToStudio(kind, payload)` which modules call after they
 * successfully persist their own state. The function is a no-op when the
 * studio-token setting is empty (most installs will not have Studio).
 *
 * HMAC signature scheme (matches Studio's /api/webhooks/devvit verifier):
 *   Header: x-redlettuce-signature: sha256=<hex>
 *   Header: x-redlettuce-timestamp: <unix-ms>
 *   Sig = HMAC-SHA256(key = studio-token, msg = `${timestamp}.${rawBody}`)
 *
 * Rate-limited to 10 req/min per installation via the shared token bucket.
 * 1 retry with exponential backoff (1s → 2s). Never throws to caller.
 */

import { context } from '@devvit/web/server';
import pRetry from 'p-retry';
import { log } from './log.js';
import { takeToken } from './ratelimit.js';
import { readEffectiveSetting } from './settings-overrides.js';

// ---------------------------------------------------------------------------
// Public event-kind type
// ---------------------------------------------------------------------------

export type StudioEventKind =
  | 'post-create'
  | 'comment-create'
  | 'post-tag'
  | 'sentiment-score'
  | 'incident-open'
  | 'incident-resolve'
  | 'theme-regenerate'
  | 'agent-mark'
  | 'agent-unmark';

export interface StudioEvent {
  v: 1;
  ts: number;
  sub: string;
  kind: StudioEventKind;
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Rate-limit bucket config — 10 req/min per installation
// ---------------------------------------------------------------------------

const STUDIO_BUCKET = {
  name: 'studio-bridge',
  capacity: 10,
  refillPerSec: 10 / 60, // 10 tokens per 60 seconds
};

// ---------------------------------------------------------------------------
// HMAC signature using Web Crypto (available in Node ≥ 18 + Devvit sandbox)
// ---------------------------------------------------------------------------

async function sign(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Core forward function
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enabled-flag cache — avoid hitting settings on every event.
// The `studio-bridge-enabled` App-scope setting defaults to false because
// studio.redlattice.app is pending Reddit gateway approval and every call
// fails silently. Cached for 60s; flipping the setting takes up to 1min to
// propagate, which is fine for an opt-in deprecated bridge.
// ---------------------------------------------------------------------------

const ENABLED_TTL_MS = 60_000;
let enabledCache: { value: boolean; expiresAt: number } | null = null;

async function isBridgeEnabled(): Promise<boolean> {
  const now = Date.now();
  if (enabledCache && enabledCache.expiresAt > now) {
    return enabledCache.value;
  }
  let value = false;
  try {
    const raw = await readEffectiveSetting<boolean>('studio-bridge-enabled', false);
    value = raw === true;
  } catch {
    value = false;
  }
  enabledCache = { value, expiresAt: now + ENABLED_TTL_MS };
  return value;
}

/**
 * Post a StudioEvent to Studio's webhook endpoint.
 *
 * Gated behind the App-scope `studio-bridge-enabled` setting (default: false).
 * When disabled, returns immediately — studio.redlattice.app is pending Reddit
 * outbound-HTTP gateway approval, so calls would fail silently anyway. The
 * enabled flag is cached for 60s to keep the per-event cost negligible.
 *
 * Returns silently on any failure — the bridge must never break callers.
 */
export async function forwardToStudio(
  kind: StudioEventKind,
  payload: Record<string, unknown>,
): Promise<void> {
  // Feature-gate: bridge is opt-in and off by default.
  if (!(await isBridgeEnabled())) {
    return;
  }

  // Read settings; skip if token is absent.
  const [token, studioUrl] = await Promise.all([
    readEffectiveSetting<string>('studio-token'),
    readEffectiveSetting<string>('studio-url', 'https://studio.redlattice.app'),
  ]);

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    // Studio not configured — silent no-op.
    return;
  }

  // Rate-limit check.
  const allowed = await takeToken(STUDIO_BUCKET).catch(() => false);
  if (!allowed) {
    log.warn('studio-bridge: rate limit hit, skipping event', { kind });
    return;
  }

  const sub = (() => {
    try {
      return context.subredditName ?? 'unknown';
    } catch {
      return 'unknown';
    }
  })();

  const ts = Date.now();
  const event: StudioEvent = { v: 1, ts, sub, kind, payload };
  const rawBody = JSON.stringify(event);

  // Compute HMAC signature: sha256=<hex>
  let hexSig: string;
  try {
    hexSig = await sign(`${ts}.${rawBody}`, token.trim());
  } catch (err) {
    log.error('studio-bridge: HMAC sign failed', {
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const endpoint = `${(studioUrl ?? 'https://studio.redlattice.app').replace(/\/$/, '')}/api/webhooks/devvit`;

  try {
    await pRetry(
      async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-redlettuce-signature': `sha256=${hexSig}`,
              'x-redlettuce-timestamp': String(ts),
            },
            body: rawBody,
            signal: ctrl.signal,
          });
          if (res.status >= 500) {
            // Trigger retry on 5xx
            throw new Error(`studio-bridge: server error ${res.status}`);
          }
          if (!res.ok) {
            // 4xx — don't retry, just log.
            log.warn('studio-bridge: non-retryable HTTP error', { status: res.status, kind });
            return; // exit the retry fn cleanly (no throw = success path)
          }
          log.info('studio-bridge: event forwarded', { kind, sub, status: res.status });
        } finally {
          clearTimeout(timer);
        }
      },
      {
        retries: 1,
        minTimeout: 1_000,
        maxTimeout: 2_000,
        onFailedAttempt: (err) => {
          log.warn('studio-bridge: retry attempt failed', {
            kind,
            attempt: err.attemptNumber,
            err: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  } catch (err) {
    // All retries exhausted — log and swallow. Never throw.
    log.error('studio-bridge: all retries failed', {
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
