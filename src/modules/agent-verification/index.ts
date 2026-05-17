/**
 * Module 01 — Agent Verification
 * Tier: CORE · Phase 1
 *
 * Distinguishes company-verified agents from regular customers. Foundation
 * for every analytics module that asks "who said this?".
 *
 * Identification sources (in priority order):
 *   1. Explicit Redis record (set by mod menu action or app-install seed)
 *   2. (Phase 2) Mod-applied flair pattern
 *   3. (Phase 2) Subreddit moderator status
 */

import { context, settings as devvitSettings, reddit } from '@devvit/web/server';
import { recordAudit } from '@modules/audit-log/index.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import { readEffectiveSetting } from '@shared/settings-overrides.js';
import { getAgent, listAgents, setAgent } from '@shared/storage.js';
import { forwardToStudio } from '@shared/studio-bridge.js';
import { type OnAppInstallRequest, type RedLatticeModule, SETTINGS } from '@shared/types.js';
import { agentBulkAddBodySchema, menuRequestSchema } from '@shared/validation.js';
import type { Context, Hono } from 'hono';

export const agentVerificationModule: RedLatticeModule = {
  name: 'agent-verification',
  description: 'Identifies verified company agents vs. customers in a brand subreddit.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    // Core module — always on.
    return true;
  },

  async onAppInstall(_event: OnAppInstallRequest): Promise<void> {
    // agent-whitelist is install-time; read from Devvit settings directly.
    const raw = ((await devvitSettings.get(SETTINGS.AGENT_WHITELIST)) as string | undefined) ?? '';
    const usernames = parseWhitelist(raw);
    if (usernames.length === 0) {
      log.info('agent-verification: no whitelist to seed');
      return;
    }
    const now = Date.now();
    await Promise.all(
      usernames.map((username) =>
        setAgent({
          username,
          role: 'verified',
          verifiedAt: now,
          verifiedBy: 'app-install-seed',
        }),
      ),
    );
    log.info('agent-verification: seeded agents from whitelist', { count: usernames.length });
  },

  apiRoutes(app: Hono): void {
    app.get('/api/agents', async (c) => {
      const agents = await listAgents();
      return c.json({ agents });
    });

    app.get('/api/agents/:username', async (c) => {
      const username = c.req.param('username');
      const agent = await getAgent(username);
      return c.json({ agent });
    });

    app.post('/api/agents', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const body = agentBulkAddBodySchema.safeParse(await c.req.json());
      if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
      const now = Date.now();
      await Promise.all(
        body.data.usernames.map((u) =>
          setAgent({
            username: u.replace(/^u\//, ''),
            role: 'verified',
            verifiedAt: now,
            verifiedBy: 'api',
          }),
        ),
      );
      return c.json({ added: body.data.usernames.length });
    });
  },
};

// ---------------------------------------------------------------------------
// Menu action handlers — registered on the server, but live with the module
// they belong to. The server imports these and mounts them under
// /internal/menu/* per devvit.json.
// ---------------------------------------------------------------------------

export async function handleMarkAgentMenu(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ showToast: 'Mod-only action.' });
  const body = menuRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ showToast: 'Invalid request.' }, 400);

  let username: string;
  try {
    const comment = await reddit.getCommentById(body.data.targetId as `t1_${string}`);
    username = comment.authorName;
  } catch (err) {
    log.error('mark-agent: getCommentById failed', { err: String(err) });
    return c.json({ showToast: 'Could not load comment.' }, 500);
  }

  const existing = await getAgent(username);
  if (existing && existing.role !== 'removed') {
    return c.json({ showToast: `u/${username} is already verified.` });
  }
  await setAgent({
    username,
    role: 'verified',
    verifiedAt: Date.now(),
    verifiedBy: 'menu-action',
  });

  // Forward to Studio (best-effort).
  void forwardToStudio('agent-mark', {
    username,
    role: 'verified',
    byUser: context.username ?? 'unknown',
  });

  // Best-effort: apply a Reddit user flair so the verification is visible
  // to everyone reading the sub, not just in our dashboard.
  await applyVerifiedFlair(username);
  void recordAudit('mark-agent', body.data.targetId, { username });

  return c.json({
    showToast: { text: `✓ Marked u/${username} as verified agent.`, appearance: 'success' },
  });
}

export async function handleUnmarkAgentMenu(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ showToast: 'Mod-only action.' });
  const body = menuRequestSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ showToast: 'Invalid request.' }, 400);

  let username: string;
  try {
    const comment = await reddit.getCommentById(body.data.targetId as `t1_${string}`);
    username = comment.authorName;
  } catch (err) {
    log.error('unmark-agent: getCommentById failed', { err: String(err) });
    return c.json({ showToast: 'Could not load comment.' }, 500);
  }

  const existing = await getAgent(username);
  if (!existing || existing.role === 'removed') {
    return c.json({ showToast: `u/${username} is not currently verified.` });
  }
  await setAgent({ ...existing, role: 'removed' });

  // Forward to Studio (best-effort).
  void forwardToStudio('agent-unmark', {
    username,
    role: 'removed',
    byUser: context.username ?? 'unknown',
  });

  // Clear the visible Reddit flair when revoking verification.
  await clearVerifiedFlair(username);
  void recordAudit('unmark-agent', body.data.targetId, { username });
  return c.json({
    showToast: { text: `Removed agent status for u/${username}.`, appearance: 'success' },
  });
}

// ---------------------------------------------------------------------------
// Visible-in-Reddit verification badge — apply / clear user flair.
// ---------------------------------------------------------------------------

async function applyVerifiedFlair(username: string): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  let text = 'Verified Agent';
  let color = '#1e3a8a';
  try {
    const cfgText = await readEffectiveSetting<string>('agent-flair-text');
    const cfgColor = await readEffectiveSetting<string>('agent-flair-color');
    if (typeof cfgText === 'string' && cfgText.trim().length > 0) text = cfgText.trim();
    if (typeof cfgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cfgColor.trim())) {
      color = cfgColor.trim();
    }
  } catch (err) {
    log.warn('agent-flair: settings read failed (non-fatal)', { err: String(err) });
  }
  // Empty text means the mod has explicitly disabled flair sync.
  if (!text) return;
  try {
    await reddit.setUserFlair({
      subredditName,
      username,
      text,
      backgroundColor: color,
      textColor: 'light',
    });
    log.info('agent-flair: applied', { username, text });
  } catch (err) {
    log.warn('agent-flair: setUserFlair failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
      username,
    });
  }
}

async function clearVerifiedFlair(username: string): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  try {
    await reddit.setUserFlair({ subredditName, username, text: '' });
    log.info('agent-flair: cleared', { username });
  } catch (err) {
    log.warn('agent-flair: clear failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
      username,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseWhitelist(raw: string): string[] {
  return raw
    .split('\n')
    .map((u) => u.trim().replace(/^u\//, '').replace(/^\//, ''))
    .filter(Boolean);
}
