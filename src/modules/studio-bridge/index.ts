/**
 * Module — Studio Bridge
 * Tier: CORE · Phase 2
 *
 * RedLattice module that registers with the dispatcher but does no event
 * processing itself. The actual outbound webhook logic lives in
 * `src/shared/studio-bridge.ts` and is called by other modules via
 * `forwardToStudio(kind, payload)` after they persist their own state.
 *
 * This module provides:
 *   - `enabled()` check (true iff studio-token is set)
 *   - `/api/studio/status` GET — returns connection status (mod-only)
 *   - `/api/studio/test`   POST — sends a no-op ping to Studio (mod-only)
 */

import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  deleteOverrideSetting,
  readEffectiveSetting,
  writeOverrideSetting,
} from '@shared/settings-overrides.js';
import type { RedLatticeModule } from '@shared/types.js';
import type { Hono } from 'hono';
import { z } from 'zod';

const studioPutSchema = z.object({
  'studio-url': z.string().url().optional(),
  'studio-token': z.string().optional(),
});

export const studioBridgeModule: RedLatticeModule = {
  name: 'studio-bridge',
  description: 'Forwards selected events to RedLattice Studio via authenticated outbound webhook.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    const token = await readEffectiveSetting<string>('studio-token');
    return typeof token === 'string' && token.trim().length > 0;
  },

  apiRoutes(app: Hono): void {
    // -----------------------------------------------------------------------
    // GET /api/studio/status — connection summary (mod-only)
    // -----------------------------------------------------------------------

    app.get('/api/studio/status', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

      const [token, studioUrl] = await Promise.all([
        readEffectiveSetting<string>('studio-token'),
        readEffectiveSetting<string>('studio-url', 'https://studio.redlattice.app'),
      ]);

      const connected = typeof token === 'string' && token.trim().length > 0;
      return c.json({
        connected,
        studioUrl: studioUrl ?? 'https://studio.redlattice.app',
        tokenConfigured: connected,
      });
    });

    // -----------------------------------------------------------------------
    // POST /api/studio/test — sends a no-op ping to Studio (mod-only)
    // -----------------------------------------------------------------------

    app.post('/api/studio/test', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

      const [token, studioUrl] = await Promise.all([
        readEffectiveSetting<string>('studio-token'),
        readEffectiveSetting<string>('studio-url', 'https://studio.redlattice.app'),
      ]);

      if (!token || typeof token !== 'string' || token.trim().length === 0) {
        return c.json({ ok: false, error: 'studio-token not configured' }, 400);
      }

      const endpoint = `${(studioUrl ?? 'https://studio.redlattice.app').replace(/\/$/, '')}/api/webhooks/devvit`;

      // Build a minimal "ping" event for the test
      const ts = Date.now();
      const pingBody = JSON.stringify({ v: 1, ts, sub: 'test', kind: 'ping', payload: {} });

      // Sign the ping
      let hexSig: string;
      try {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(token.trim()),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${pingBody}`));
        hexSig = Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      } catch (err) {
        log.error('studio-test: HMAC sign failed', { err: String(err) });
        return c.json({ ok: false, error: 'hmac-sign-failed' }, 500);
      }

      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        let statusCode: number;
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-redlattice-signature': `sha256=${hexSig}`,
              'x-redlattice-timestamp': String(ts),
            },
            body: pingBody,
            signal: ctrl.signal,
          });
          statusCode = res.status;
        } finally {
          clearTimeout(timer);
        }

        log.info('studio-test: ping sent', { endpoint, statusCode });
        return c.json({ ok: statusCode < 500, statusCode, endpoint });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn('studio-test: fetch failed', { err: msg, endpoint });
        return c.json({ ok: false, error: msg }, 502);
      }
    });

    // -----------------------------------------------------------------------
    // PUT /api/studio/settings — set studio-url + studio-token (mod-only)
    // -----------------------------------------------------------------------

    app.put('/api/studio/settings', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400);
      }

      const parsed = studioPutSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'validation failed', issues: parsed.error.issues }, 400);
      }

      const { 'studio-url': url, 'studio-token': token } = parsed.data;
      if (url !== undefined) await writeOverrideSetting('studio-url', url);
      if (token !== undefined) await writeOverrideSetting('studio-token', token);

      return c.json({ ok: true });
    });

    // -----------------------------------------------------------------------
    // DELETE /api/studio/settings — clear token to disconnect (mod-only)
    // -----------------------------------------------------------------------

    app.delete('/api/studio/settings', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      await deleteOverrideSetting('studio-token');
      log.info('studio-bridge: token cleared — Studio disconnected');
      return c.json({ ok: true });
    });
  },
};
