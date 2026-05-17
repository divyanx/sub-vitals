/**
 * Shared Playwright API mock helper.
 *
 * Call `setupMocks(page)` at the start of each test to intercept every
 * `/api/*` request and respond with the corresponding JSON fixture.
 * This keeps specs decoupled from the real Hono server.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.resolve(__dirname, 'fixtures');

function fixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf-8'));
}

/** Per-driver fixture selector. Falls back to a generic empty response if no file exists. */
function driverPostsFixture(driverId: string): unknown {
  const file = path.join(FIXTURES, `driver-posts-${driverId}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  }
  return { driverId, posts: [], count: 0 };
}

export async function setupMocks(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname; // e.g. /api/dashboard/summary
    const method = route.request().method();

    // Health check
    if (pathname === '/api/health') {
      return route.fulfill({ json: { ok: true, ts: Date.now() } });
    }

    // Dashboard summary
    if (pathname === '/api/dashboard/summary') {
      return route.fulfill({ json: fixture('summary') });
    }

    // Pulse stats (Sprint 10)
    if (pathname === '/api/dashboard/pulse-stats') {
      return route.fulfill({
        json: {
          today: '2026-05-17',
          postsToday: 14,
          topDriver: { id: 'bug', label: 'Bug / broken experience', count: 6 },
          negativeShare: 0.36,
          negativeShareTrend: 'up',
          activeIncidents: 1,
          sentimentTrend: Array.from({ length: 7 }, (_, i) => ({
            date: `2026-05-${String(10 + i).padStart(2, '0')}`,
            positive: 4 + i,
            neutral: 6,
            negative: 3 + (i % 3),
          })),
        },
      });
    }

    // Onboarding (Sprint 10)
    if (pathname === '/api/onboarding/status') {
      return route.fulfill({ json: { onboarded: true } });
    }
    if (pathname === '/api/onboarding/complete' && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/onboarding/reset' && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }

    // Recent posts
    if (pathname === '/api/dashboard/recent-posts') {
      return route.fulfill({ json: fixture('recent-posts') });
    }

    // Taxonomy
    if (pathname === '/api/drivers/taxonomy') {
      return route.fulfill({ json: fixture('taxonomy') });
    }

    // Driver volume
    if (pathname === '/api/drivers/volume') {
      return route.fulfill({ json: fixture('drivers-volume') });
    }

    // Per-driver posts  e.g. /api/drivers/bug/posts
    const driverPostsMatch = pathname.match(/^\/api\/drivers\/([^/]+)\/posts$/);
    if (driverPostsMatch) {
      return route.fulfill({ json: driverPostsFixture(driverPostsMatch[1]) });
    }

    // Sentiment rollup
    if (pathname === '/api/sentiment/rollup') {
      return route.fulfill({ json: fixture('sentiment-rollup') });
    }

    // Agents
    if (pathname === '/api/agents') {
      return route.fulfill({ json: fixture('agents') });
    }

    // Agent leaderboard
    if (pathname === '/api/agents/leaderboard') {
      return route.fulfill({ json: { days: 30, count: 0, rows: [] } });
    }

    // Incidents
    if (pathname === '/api/incidents') {
      return route.fulfill({ json: { count: 0, incidents: [] } });
    }
    if (pathname.match(/^\/api\/incidents\/[^/]+\/resolve$/) && method === 'POST') {
      return route.fulfill({ status: 200, json: {} });
    }

    // Themes
    if (pathname === '/api/themes/latest') {
      return route.fulfill({ json: fixture('themes') });
    }
    if (pathname === '/api/themes/regenerate' && method === 'POST') {
      return route.fulfill({ json: { generatedAt: Date.now(), themes: [] } });
    }

    // Settings
    if (pathname === '/api/settings' && method === 'GET') {
      return route.fulfill({ json: { openrouterKeyConfigured: true } });
    }
    if (pathname === '/api/settings' && method === 'PUT') {
      return route.fulfill({ json: { openrouterKeyConfigured: true } });
    }
    if (pathname === '/api/settings/test-draft' && method === 'POST') {
      return route.fulfill({ json: fixture('draft-reply') });
    }

    // Triage queue
    if (pathname === '/api/triage/queue') {
      return route.fulfill({ json: fixture('triage-queue') });
    }

    // User history  e.g. /api/users/frustrated_frank/history
    if (pathname.match(/^\/api\/users\/[^/]+\/history$/)) {
      return route.fulfill({ json: fixture('user-history') });
    }

    // Post thread  e.g. /api/posts/post_001/thread
    if (pathname.match(/^\/api\/posts\/[^/]+\/thread$/)) {
      return route.fulfill({ json: fixture('post-thread') });
    }

    // Draft reply (POST)  e.g. /api/posts/post_001/draft-reply
    if (pathname.match(/^\/api\/posts\/[^/]+\/draft-reply$/) && method === 'POST') {
      return route.fulfill({ json: fixture('draft-reply') });
    }

    // Post status mutation (POST)  e.g. /api/posts/post_001/status
    if (pathname.match(/^\/api\/posts\/[^/]+\/status$/) && method === 'POST') {
      return route.fulfill({ status: 200, json: {} });
    }

    // Export endpoints — let them through (they are just links, not fetched by React)
    if (pathname.startsWith('/api/export/')) {
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/csv' },
        body: 'postId,title\npost_001,App crashes every time I try to checkout\n',
      });
    }

    // Admin debug
    if (pathname === '/api/admin/debug') {
      return route.fulfill({
        json: {
          server: { ts: Date.now(), uptimeSec: 42 },
          modules: ['contact-drivers', 'sentiment', 'impostor-detection', 'crisis-detection'],
          llm: { monthCents: 12.5, tokensIn: 1000, tokensOut: 500, capCents: 500 },
          taxonomy: ['bug', 'praise', 'feature-request', 'billing', 'onboarding'],
          recentPostIds: [],
          dashboardPostId: null,
          subreddit: 'testsubreddit',
          username: 'test_mod',
        },
      });
    }

    // Audit log
    if (pathname === '/api/audit') {
      return route.fulfill({
        json: {
          count: 0,
          entries: [],
        },
      });
    }

    // Bulk status mutation
    if (pathname === '/api/posts/bulk-status' && method === 'POST') {
      return route.fulfill({
        json: { ok: true, results: [], succeeded: 0, failed: 0 },
      });
    }

    // Studio Bridge
    if (pathname === '/api/studio/status') {
      return route.fulfill({
        json: {
          connected: false,
          studioUrl: 'https://studio.redlattice.app',
          tokenConfigured: false,
        },
      });
    }
    if (pathname === '/api/studio/test' && method === 'POST') {
      return route.fulfill({ json: { ok: true, statusCode: 200 } });
    }
    if (pathname === '/api/studio/settings' && method === 'PUT') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/studio/settings' && method === 'DELETE') {
      return route.fulfill({ json: { ok: true } });
    }

    // Saved views
    if (pathname === '/api/views' && method === 'GET') {
      return route.fulfill({ json: { views: [] } });
    }
    if (pathname === '/api/views' && method === 'PUT') {
      return route.fulfill({
        json: {
          id: 'v_test',
          name: 'Test view',
          tab: 'inbox',
          params: {},
          createdAt: Date.now(),
        },
      });
    }
    if (pathname.match(/^\/api\/views\/[^/]+$/) && method === 'DELETE') {
      return route.fulfill({ status: 200, json: { ok: true } });
    }

    // Onboarding
    if (pathname === '/api/onboarding/status') {
      return route.fulfill({ json: { onboarded: true } });
    }
    if (pathname === '/api/onboarding/complete' && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/onboarding/reset' && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }

    // Fallback: abort unknown API paths so tests get a clear failure signal
    console.warn(`[mock-api] Unhandled request: ${method} ${pathname}`);
    return route.fulfill({ status: 404, json: { error: `mock: no handler for ${pathname}` } });
  });
}
