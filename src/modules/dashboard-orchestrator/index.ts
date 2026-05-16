/**
 * Module 04 — Dashboard Orchestrator
 * Tier: CORE · Phase 1
 *
 * Cross-cutting concerns for the dashboard post:
 *   - On AppInstall and AppUpgrade, ensure exactly one pinned RedLattice
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

async function ensurePinnedDashboard(trigger: 'install' | 'upgrade'): Promise<void> {
  const sub = context.subredditName;
  if (!sub) {
    log.warn('orchestrator: no subreddit context, skipping pin', { trigger });
    return;
  }
  try {
    const existing = await redis.get(K.pulsePostId());
    if (existing) {
      log.debug('orchestrator: dashboard post already exists', {
        trigger,
        postId: existing,
      });
      return;
    }
    const post = await reddit.submitCustomPost({
      title: 'RedLattice · Live Analytics',
      subredditName: sub,
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
