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

    // Sentiment posts drill-through  e.g. /api/sentiment/posts?label=negative
    if (pathname === '/api/sentiment/posts') {
      const label = url.searchParams.get('label');
      if (label === 'negative') {
        return route.fulfill({ json: fixture('sentiment-posts-negative') });
      }
      // positive and neutral: return empty
      return route.fulfill({ json: { label: label ?? 'neutral', count: 0, posts: [] } });
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
      return route.fulfill({
        json: {
          openrouterKeyConfigured: true,
          'taxonomy-json': JSON.stringify([
            { id: 'bug', label: 'Bug / broken experience', color: '#f43f5e' },
            { id: 'bug.crash', label: 'Crash', color: '#f43f5e', parentId: 'bug' },
            { id: 'praise', label: 'Praise / positive feedback', color: '#10b981' },
            { id: 'feature-request', label: 'Feature request', color: '#8b5cf6' },
            { id: 'billing', label: 'Billing / pricing', color: '#f59e0b' },
            { id: 'onboarding', label: 'Onboarding / setup', color: '#3b82f6' },
          ]),
          'routing-json': '{}',
        },
      });
    }
    if (pathname === '/api/settings' && method === 'PUT') {
      return route.fulfill({ json: { openrouterKeyConfigured: true } });
    }
    if (pathname === '/api/settings/test-draft' && method === 'POST') {
      return route.fulfill({ json: fixture('draft-reply') });
    }

    // AI model status
    if (pathname === '/api/ai/status' && method === 'GET') {
      return route.fulfill({
        json: {
          effectiveModel: 'anthropic/claude-haiku-4.5',
          isFallback: false,
          originalSlug: null,
          defaultModel: 'anthropic/claude-haiku-4.5',
          catalog: [
            {
              slug: 'anthropic/claude-haiku-4.5',
              label: 'Claude Haiku 4.5',
              provider: 'anthropic',
              tier: 'recommended',
              pricePer1kTaggingCalls: 0.00015,
              supportsStructuredOutput: true,
              notes: 'Best balance of speed, cost, and reliability.',
            },
            {
              slug: 'openai/gpt-5-mini',
              label: 'GPT-5 Mini',
              provider: 'openai',
              tier: 'fast',
              pricePer1kTaggingCalls: 0.000053,
              supportsStructuredOutput: true,
              notes: 'Low latency.',
            },
            {
              slug: 'google/gemini-2.5-flash',
              label: 'Gemini 2.5 Flash',
              provider: 'google',
              tier: 'cheapest',
              pricePer1kTaggingCalls: 0.000065,
              supportsStructuredOutput: true,
              notes: 'Lowest cost option.',
            },
          ],
        },
      });
    }

    // AI validate model
    if (pathname === '/api/ai/validate-model' && method === 'POST') {
      return route.fulfill({
        json: {
          valid: true,
          supportsStructuredOutput: true,
          inCatalog: true,
          estimatedCostCents: 0.015,
        },
      });
    }

    // AI clear fallback
    if (pathname === '/api/ai/clear-fallback' && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
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

    // Pipeline builtin GET  e.g. /api/pipelines/builtin/sentiment
    const builtinMatch = pathname.match(/^\/api\/pipelines\/builtin\/([^/]+)$/);
    if (builtinMatch && method === 'GET') {
      const id = builtinMatch[1];
      if (id === 'sentiment') {
        return route.fulfill({ json: fixture('pipeline-builtin-sentiment') });
      }
      return route.fulfill({ json: { id, overrides: {} } });
    }
    // Pipeline builtin PUT
    if (builtinMatch && method === 'PUT') {
      const id = builtinMatch[1];
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({ json: { id, overrides: body } });
    }

    // Pipeline builtin test
    const builtinTestMatch = pathname.match(/^\/api\/pipelines\/builtin\/([^/]+)\/test$/);
    if (builtinTestMatch && method === 'POST') {
      return route.fulfill({
        json: {
          id: builtinTestMatch[1],
          output: { output: 'negative', label: 'negative' },
          tokensIn: 42,
          tokensOut: 12,
          costCents: 0.001,
        },
      });
    }

    // Dynamic pipeline catalog
    if (pathname === '/api/pipelines/all' && method === 'GET') {
      return route.fulfill({
        json: {
          count: 6,
          pipelines: [
            {
              id: 'intent',
              name: 'Drivers',
              kind: 'categorical',
              trigger: 'post-create',
              outputSchema: 'single-label',
              source: 'builtin',
              enabled: true,
              order: 0,
            },
            {
              id: 'sentiment',
              name: 'Sentiment',
              kind: 'ordinal',
              trigger: 'post-create',
              outputSchema: 'label-confidence',
              source: 'builtin',
              enabled: true,
              labels: ['positive', 'neutral', 'negative'],
              order: 1,
            },
            {
              id: 'themes',
              name: 'Themes',
              kind: 'cluster',
              trigger: 'scheduled',
              outputSchema: 'cluster',
              source: 'builtin',
              enabled: true,
              order: 2,
            },
            {
              id: 'impostor',
              name: 'Impostor detection',
              kind: 'boolean',
              trigger: 'comment-create',
              outputSchema: 'boolean',
              source: 'builtin',
              enabled: true,
              order: 3,
            },
            {
              id: 'crisis',
              name: 'Crisis detection',
              kind: 'boolean',
              trigger: 'comment-create',
              outputSchema: 'boolean',
              source: 'builtin',
              enabled: true,
              order: 4,
            },
            {
              id: 'agent-metrics',
              name: 'Agent metrics',
              kind: 'scalar',
              trigger: 'comment-create',
              outputSchema: 'scalar',
              source: 'builtin',
              enabled: true,
              order: 5,
            },
          ],
        },
      });
    }
    if (pathname === '/api/pipelines/enabled' && method === 'GET') {
      return route.fulfill({
        json: {
          count: 7,
          pipelines: [
            {
              id: 'intent',
              name: 'Drivers',
              kind: 'categorical',
              trigger: 'post-create',
              outputSchema: 'single-label',
              source: 'builtin',
              enabled: true,
              order: 0,
            },
            {
              id: 'sentiment',
              name: 'Sentiment',
              kind: 'ordinal',
              trigger: 'post-create',
              outputSchema: 'label-confidence',
              source: 'builtin',
              enabled: true,
              labels: ['positive', 'neutral', 'negative'],
              order: 1,
            },
            {
              id: 'themes',
              name: 'Themes',
              kind: 'cluster',
              trigger: 'scheduled',
              outputSchema: 'cluster',
              source: 'builtin',
              enabled: true,
              order: 2,
            },
            {
              id: 'impostor',
              name: 'Impostor detection',
              kind: 'boolean',
              trigger: 'comment-create',
              outputSchema: 'boolean',
              source: 'builtin',
              enabled: true,
              order: 3,
            },
            {
              id: 'crisis',
              name: 'Crisis detection',
              kind: 'boolean',
              trigger: 'comment-create',
              outputSchema: 'boolean',
              source: 'builtin',
              enabled: true,
              order: 4,
            },
            {
              id: 'agent-metrics',
              name: 'Agent metrics',
              kind: 'scalar',
              trigger: 'comment-create',
              outputSchema: 'scalar',
              source: 'builtin',
              enabled: true,
              order: 5,
            },
            {
              // Custom categorical pipeline — appears as a filter chip in Content Browser
              id: 'intent',
              name: 'Intent',
              kind: 'categorical',
              trigger: 'post-create',
              outputSchema: 'single-label',
              source: 'custom',
              enabled: true,
              labels: ['bug', 'praise', 'billing'],
              order: 6,
            },
          ],
        },
      });
    }
    if (pathname.match(/^\/api\/pipelines\/[^/]+\/order$/) && method === 'PATCH') {
      return route.fulfill({ json: { ok: true } });
    }
    // Tags distribution
    if (pathname === '/api/tags/distribution' && method === 'GET') {
      return route.fulfill({
        json: { pipelineId: url.searchParams.get('pipelineId') ?? '', distribution: [] },
      });
    }
    // Tags posts
    if (pathname === '/api/tags/posts' && method === 'GET') {
      return route.fulfill({
        json: {
          pipelineId: url.searchParams.get('pipelineId') ?? '',
          value: url.searchParams.get('value') ?? '',
          count: 0,
          posts: [],
        },
      });
    }

    // Custom pipelines list
    if (pathname === '/api/pipelines/custom' && method === 'GET') {
      return route.fulfill({ json: fixture('pipeline-custom-list') });
    }
    // Custom pipeline create
    if (pathname === '/api/pipelines/custom' && method === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        json: {
          pipeline: {
            id: 'cp_test001',
            ...(body as object),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      });
    }
    // Custom pipeline delete
    if (pathname.match(/^\/api\/pipelines\/custom\/[^/]+$/) && method === 'DELETE') {
      return route.fulfill({ json: { ok: true } });
    }
    // Custom pipeline test
    if (pathname.match(/^\/api\/pipelines\/custom\/[^/]+\/test$/) && method === 'POST') {
      return route.fulfill({
        json: {
          id: 'cp_test001',
          output: { output: 'true' },
          tokensIn: 30,
          tokensOut: 5,
          costCents: 0.0005,
        },
      });
    }

    // Taxonomy templates list
    if (pathname === '/api/taxonomy/templates' && method === 'GET') {
      return route.fulfill({
        json: {
          templates: [
            {
              id: 'ecommerce',
              name: 'E-Commerce',
              description:
                'Orders, returns, products, account, pricing, and feedback for online retail brands.',
              driverCount: 23,
              deepestDepth: 2,
            },
            {
              id: 'saas',
              name: 'SaaS / Software',
              description:
                'Bugs, feature requests, billing, integrations, and onboarding for software products.',
              driverCount: 19,
              deepestDepth: 2,
            },
            {
              id: 'hardware',
              name: 'Hardware / Devices',
              description:
                'Defects, setup, compatibility, warranty, and repair for physical products.',
              driverCount: 16,
              deepestDepth: 2,
            },
            {
              id: 'gaming',
              name: 'Gaming',
              description:
                'Bugs, balance, cheating, account issues, and feature requests for games.',
              driverCount: 15,
              deepestDepth: 2,
            },
            {
              id: 'finance',
              name: 'Finance / FinTech',
              description:
                'Transactions, security, fees, withdrawals, and compliance for financial services.',
              driverCount: 16,
              deepestDepth: 2,
            },
            {
              id: 'media',
              name: 'Media & Streaming',
              description:
                'Content, subscriptions, streaming issues, recommendations, and moderation for media platforms.',
              driverCount: 15,
              deepestDepth: 2,
            },
          ],
        },
      });
    }

    // Taxonomy apply-template
    if (pathname === '/api/taxonomy/apply-template' && method === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        templateId?: string;
        mode?: string;
      };
      // Return a small stub taxonomy representing the applied template
      const ecommerceTaxonomy = [
        {
          id: 'ec.order',
          label: 'Order Issue',
          color: '#ef4444',
          description: 'Problems with orders',
          keywords: ['order'],
          parentId: null,
        },
        {
          id: 'ec.order.shipping-delay',
          label: 'Shipping Delay',
          color: '#f87171',
          description: 'Late delivery',
          keywords: ['delayed'],
          parentId: 'ec.order',
        },
        {
          id: 'ec.returns',
          label: 'Returns',
          color: '#f97316',
          description: 'Return and refund requests',
          keywords: ['return'],
          parentId: null,
        },
        {
          id: 'ec.feedback',
          label: 'Feedback',
          color: '#0ea5e9',
          description: 'Customer feedback',
          keywords: ['feedback'],
          parentId: null,
        },
      ];
      return route.fulfill({
        json: {
          taxonomy: ecommerceTaxonomy,
          driverCount: ecommerceTaxonomy.length,
          templateId: body.templateId,
          mode: body.mode,
        },
      });
    }

    // ---------------------------------------------------------------------------
    // Data Lab
    // ---------------------------------------------------------------------------

    if (pathname === '/api/lab/simulate-post' && method === 'POST') {
      return route.fulfill({
        json: { postId: `t3_lab_${Date.now()}_00001` },
      });
    }

    if (pathname === '/api/lab/simulate-comment' && method === 'POST') {
      return route.fulfill({
        json: { commentId: `t1_lab_${Date.now()}_00001` },
      });
    }

    if (pathname === '/api/lab/import-json' && method === 'POST') {
      return route.fulfill({
        json: { imported: 1, results: [{ postId: `t3_lab_${Date.now()}`, commentIds: [] }] },
      });
    }

    const scenarioRunMatch = pathname.match(/^\/api\/lab\/scenario\/([^/]+)$/);
    if (scenarioRunMatch && method === 'POST') {
      return route.fulfill({ json: { status: 'started', name: scenarioRunMatch[1] } });
    }

    const scenarioStatusMatch = pathname.match(/^\/api\/lab\/scenario\/status\/([^/]+)$/);
    if (scenarioStatusMatch && method === 'GET') {
      return route.fulfill({
        json: { name: scenarioStatusMatch[1], state: 'done', lastRunAt: Date.now() },
      });
    }

    if (pathname === '/api/lab/scenarios' && method === 'GET') {
      return route.fulfill({
        json: {
          scenarios: [
            {
              name: 'crisis-cluster',
              description: '8 negative bug posts in 30 min window, 20 angry comments.',
              status: { state: 'idle', lastRunAt: null },
            },
            {
              name: 'happy-weekend',
              description: '12 positive praise posts simulating a good weekend.',
              status: { state: 'idle', lastRunAt: null },
            },
            {
              name: 'sla-breach',
              description: '5 posts that arrive unanswered.',
              status: { state: 'idle', lastRunAt: null },
            },
            {
              name: 'mixed-brand-mentions',
              description: '15 posts mixing brand + 3 competitor names.',
              status: { state: 'idle', lastRunAt: null },
            },
            {
              name: 'root-cause-test',
              description: '5 resolved posts each with an agent reply.',
              status: { state: 'idle', lastRunAt: null },
            },
          ],
        },
      });
    }

    if (pathname === '/api/lab/recent-posts-full' && method === 'GET') {
      return route.fulfill({
        json: {
          posts: [
            { postId: 't3_lab_111', title: 'App crashes on startup' },
            { postId: 't3_lab_222', title: 'Billing error on my invoice' },
          ],
        },
      });
    }

    if (pathname === '/api/lab/clear' && method === 'DELETE') {
      return route.fulfill({ json: { deleted: 3 } });
    }

    // Content search — respects tag_* pipeline filter params for e2e test assertions
    if (pathname === '/api/content/search') {
      const allItems = (
        fixture('content-search') as {
          items: unknown[];
          total: number;
          offset: number;
          limit: number;
        }
      ).items;
      // Collect any tag_* filters from the query string
      const tagFilters: Record<string, string[]> = {};
      for (const [key, val] of url.searchParams.entries()) {
        if (key.startsWith('tag_')) {
          tagFilters[key.slice(4)] = val.split(',').filter(Boolean);
        }
      }
      if (Object.keys(tagFilters).length === 0) {
        return route.fulfill({ json: fixture('content-search') });
      }
      // Simple mock filtering: keep only items whose driverId matches intent filter values
      // (This mirrors what the real server does for the intent pipeline in the test scenario.)
      let filtered = allItems as Array<{ driverId: string | null }>;
      const intentValues = tagFilters.intent;
      if (intentValues && intentValues.length > 0) {
        filtered = filtered.filter(
          (item) => item.driverId !== null && intentValues.includes(item.driverId),
        );
      }
      return route.fulfill({
        json: { items: filtered, total: filtered.length, offset: 0, limit: 50 },
      });
    }

    // Mod actions (Content Browser)
    if (pathname.match(/^\/api\/posts\/[^/]+\/approve$/) && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.match(/^\/api\/posts\/[^/]+\/remove$/) && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.match(/^\/api\/posts\/[^/]+\/lock$/) && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.match(/^\/api\/posts\/[^/]+\/reply$/) && method === 'POST') {
      return route.fulfill({ json: { commentId: 'mock_comment_001' } });
    }
    if (pathname.match(/^\/api\/comments\/[^/]+\/approve$/) && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.match(/^\/api\/comments\/[^/]+\/remove$/) && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname.match(/^\/api\/comments\/[^/]+\/distinguish$/) && method === 'POST') {
      return route.fulfill({ json: { ok: true } });
    }

    // Content browser (bulk-tag already handled above via /api/posts/bulk-tag)

    // Fallback: abort unknown API paths so tests get a clear failure signal
    console.warn(`[mock-api] Unhandled request: ${method} ${pathname}`);
    return route.fulfill({ status: 404, json: { error: `mock: no handler for ${pathname}` } });
  });
}
