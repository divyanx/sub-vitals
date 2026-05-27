/**
 * Module 04 — Dashboard Orchestrator
 * Tier: CORE · Phase 1
 *
 * Cross-cutting concerns for the dashboard post:
 *   - On AppInstall and AppUpgrade, ensure exactly one pinned SubVitals
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
import { readEffectiveSetting, writeOverrideSetting } from '@shared/settings-overrides.js';
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
    await autoPopulateBrandIdentity();
  },

  async onAppUpgrade(_event: OnAppUpgradeRequest): Promise<void> {
    await ensurePinnedDashboard('upgrade');
    await autoPopulateBrandIdentity();
  },
};

// media-dir-relative path (devvit.json `media.dir` defaults to `assets/`).

/**
 * Fetch subreddit title + description from Reddit and write them as default
 * brand-name / brand-voice settings. Only writes if the setting is not already
 * configured so manual overrides are never clobbered.
 */
async function autoPopulateBrandIdentity(): Promise<void> {
  const subName = context.subredditName;
  if (!subName) return;
  try {
    const sub = await reddit.getSubredditByName(subName);
    const existingName = await readEffectiveSetting<string>('brand-name').catch(() => undefined);
    const existingVoice = await readEffectiveSetting<string>('brand-voice').catch(() => undefined);

    // Only set defaults if not already configured
    if (!existingName) {
      const brandName = sub.title || subName;
      await writeOverrideSetting('brand-name', brandName);
    }
    if (!existingVoice) {
      const desc = sub.description;
      if (desc) {
        await writeOverrideSetting('brand-voice', desc.slice(0, 500));
      }
    }
    log.info('dashboard-orchestrator: brand identity auto-populated', { subName });
  } catch (err) {
    log.warn('dashboard-orchestrator: failed to auto-populate brand identity', {
      err: String(err),
    });
  }
}

async function ensurePinnedDashboard(trigger: 'install' | 'upgrade'): Promise<void> {
  const sub = context.subredditName;
  if (!sub) {
    log.warn('orchestrator: no subreddit context, skipping pin', { trigger });
    return;
  }
  try {
    const existing = await redis.get(K.pulsePostId());
    if (existing) {
      return;
    }
    const post = await reddit.submitCustomPost({
      title: 'SubVitals · Live Analytics',
      subredditName: sub,
      ...({
        splash: {
          appDisplayName: 'SubVitals',
          appIconUri: 'icon-1024.png',
          heading: 'SubVitals · Live Analytics',
          description: 'Customer experience mod cockpit for brand subreddits',
          buttonLabel: 'Open Dashboard',
        },
      } as Record<string, unknown>),
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
