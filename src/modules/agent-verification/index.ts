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

import { reddit, settings } from '@devvit/web/server';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import { getAgent, listAgents, setAgent } from '@shared/storage.js';
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
    const raw = ((await settings.get(SETTINGS.AGENT_WHITELIST)) as string | undefined) ?? '';
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
  return c.json({
    showToast: { text: `Removed agent status for u/${username}.`, appearance: 'success' },
  });
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
