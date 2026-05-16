/**
 * RedLattice — Devvit Web server entry.
 *
 * Boots a Hono app, registers shared middleware + module API routes, mounts
 * the platform-facing `/internal/*` endpoints declared in `devvit.json`, and
 * starts an HTTP server backed by Devvit's `createServer`.
 *
 * Architecture rules:
 *   - `/api/*`        client-facing JSON routes; mod-guarded unless explicit.
 *   - `/internal/*`   platform-facing — Reddit POSTs here for triggers/menu/
 *                     forms/scheduler. Never call from the React client.
 *
 * Module dispatcher lives in `@shared/dispatcher`. Modules contribute event
 * handlers + optional `/api/*` routes. Menu/form handlers are co-located in
 * each module and imported here so the server has the full HTTP surface in
 * one file.
 */

import { createServer, getServerPort } from '@devvit/web/server';
import { getRequestListener } from '@hono/node-server';
import {
  agentVerificationModule,
  handleMarkAgentMenu,
  handleUnmarkAgentMenu,
} from '@modules/agent-verification/index.js';
import {
  contactDriversModule,
  handleTagIssueFormSubmit,
  handleTagIssueMenu,
} from '@modules/contact-drivers/index.js';
import { handleSentimentTrailMenu, sentimentModule } from '@modules/sentiment/index.js';
import { dispatch, registerModule } from '@shared/dispatcher.js';
import { today, yyyymm } from '@shared/keys.js';
import { log } from '@shared/log.js';
import { getDriverRollup, getSentimentRollup } from '@shared/storage.js';
import { Hono } from 'hono';
import { logger } from 'hono/logger';

// ---------------------------------------------------------------------------
// Module registration — order doesn't matter; failure isolation in dispatcher.
// ---------------------------------------------------------------------------

registerModule(agentVerificationModule);
registerModule(contactDriversModule);
registerModule(sentimentModule);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

app.use(
  '*',
  logger((str) => log.debug(str)),
);

app.onError((err, c) => {
  log.error('unhandled error', {
    err: err instanceof Error ? err.message : String(err),
    path: c.req.path,
  });
  return c.json({ error: 'internal' }, 500);
});

// Health probe (no auth).
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
// Cross-module aggregate route — single fetch for the dashboard overview tab
// ---------------------------------------------------------------------------

app.get('/api/dashboard/summary', async (c) => {
  const d = today();
  const yMonth = yyyymm();
  const [driversToday, sentToday] = await Promise.all([getDriverRollup(d), getSentimentRollup(d)]);

  let topDriverId: string | null = null;
  let topDriverCount = 0;
  if (driversToday) {
    for (const [id, count] of Object.entries(driversToday.counts)) {
      if (count > topDriverCount) {
        topDriverCount = count;
        topDriverId = id;
      }
    }
  }

  return c.json({
    today: d,
    month: yMonth,
    drivers: {
      today: driversToday,
      topDriverId,
      topDriverCount,
    },
    sentiment: sentToday,
  });
});

// ---------------------------------------------------------------------------
// Mount module-owned /api routes
// ---------------------------------------------------------------------------

for (const mod of [agentVerificationModule, contactDriversModule, sentimentModule]) {
  mod.apiRoutes?.(app);
}

// ---------------------------------------------------------------------------
// Triggers — Reddit POSTs the trigger payload as JSON to these endpoints
// ---------------------------------------------------------------------------

app.post('/internal/triggers/app-install', async (c) => {
  await dispatch('onAppInstall', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/app-upgrade', async (c) => {
  await dispatch('onAppUpgrade', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/post-create', async (c) => {
  await dispatch('onPostCreate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/post-update', async (c) => {
  await dispatch('onPostUpdate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/comment-create', async (c) => {
  await dispatch('onCommentCreate', await c.req.json());
  return c.json({ ok: true });
});

app.post('/internal/triggers/mod-action', async (c) => {
  await dispatch('onModAction', await c.req.json());
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Menu actions — return UI-effect responses
// ---------------------------------------------------------------------------

app.post('/internal/menu/tag-issue', handleTagIssueMenu);
app.post('/internal/menu/sentiment-trail', handleSentimentTrailMenu);
app.post('/internal/menu/mark-agent', handleMarkAgentMenu);
app.post('/internal/menu/unmark-agent', handleUnmarkAgentMenu);

app.post('/internal/menu/open-dashboard', (c) =>
  c.json({
    navigateTo: `https://www.reddit.com/r/${c.req.header('x-subreddit') ?? ''}`,
  }),
);

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

app.post('/internal/forms/tag-issue', handleTagIssueFormSubmit);

// ---------------------------------------------------------------------------
// Scheduler — Phase 1 stubs; modules can grow into these as needed
// ---------------------------------------------------------------------------

app.post('/internal/scheduler/daily-aggregate', (c) => {
  log.info('scheduler: daily-aggregate fired');
  return c.json({ ok: true });
});

app.post('/internal/scheduler/weekly-digest', (c) => {
  log.info('scheduler: weekly-digest fired');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const port = getServerPort();
const listener = getRequestListener(app.fetch);
const server = createServer(listener);
server.listen(port);
log.info('redlattice server listening', { port });
