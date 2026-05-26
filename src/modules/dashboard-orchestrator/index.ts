/**
 * Module 04 — Dashboard Orchestrator
 * Tier: CORE · Phase 1
 *
 * Cross-cutting concerns for the dashboard post:
 *   - On AppInstall and AppUpgrade, ensure exactly one pinned RedLattuce
 *     dashboard post exists in the subreddit.
 *   - The post is the React iframe; whoever opens it sees the live analytics.
 *   - Idempotent via the rl:pulse:postId key.
 *
 * This is what gives mods immediate visible value the moment they install the
 * app — no menu hunting required.
 */

import { context, reddit, redis } from '@devvit/web/server';
import { K } from '@shared/keys.js';
import { log } from '@shared/log.js';
import type { OnAppInstallRequest, OnAppUpgradeRequest, RedLatticeModule } from '@shared/types.js';

export const dashboardOrchestratorModule: RedLatticeModule = {
  name: 'dashboard-orchestrator',
  description: 'Ensures the Daily Pulse / dashboard pinned post exists in the subreddit.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onAppInstall(_event: OnAppInstallRequest): Promise<void> {
    await ensurePinnedDashboard('install');
  },

  async onAppUpgrade(_event: OnAppUpgradeRequest): Promise<void> {
    await ensurePinnedDashboard('upgrade');
  },
};

// media-dir-relative path (devvit.json `media.dir` defaults to `assets/`).
// Note: `splash` is marked @deprecated in @devvit/reddit but still the
// supported way to set the launch-screen icon in @devvit/web@0.12.x.
// Future-proof migration is an inline-entrypoint splash; out of scope here.
const SPLASH_OPTS = {
  appDisplayName: 'RedLattuce',
  appIconUri: 'icon-1024.png',
} as const;

async function ensurePinnedDashboard(trigger: 'install' | 'upgrade'): Promise<void> {
  const sub = context.subredditName;
  if (!sub) {
    log.warn('orchestrator: no subreddit context, skipping pin', { trigger });
    return;
  }
  try {
    const existing = await redis.get(K.pulsePostId());
    if (existing) {
      // Existing install — pinned post is fine, but bring its splash
      // forward (icon was added in a later version of the app).
      try {
        const post = await reddit.getPostById(existing as `t3_${string}`);
        await post.setSplash(SPLASH_OPTS);
        log.debug('orchestrator: splash refreshed on existing post', {
          trigger,
          postId: existing,
        });
      } catch (err) {
        log.warn('orchestrator: setSplash on existing post failed (non-fatal)', {
          err: err instanceof Error ? err.message : String(err),
          postId: existing,
        });
      }
      return;
    }
    const post = await reddit.submitCustomPost({
      title: 'RedLattuce · Live Analytics',
      subredditName: sub,
      splash: SPLASH_OPTS,
    });
    await redis.set(K.pulsePostId(), post.id);
    try {
      await post.sticky(2);
    } catch (err) {
      log.warn('orchestrator: sticky failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    log.info('orchestrator: dashboard post created + pinned', {
      trigger,
      postId: post.id,
    });
  } catch (err) {
    log.error('orchestrator: failed to create dashboard post', {
      trigger,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
