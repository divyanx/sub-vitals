/**
 * inbox.spec.ts
 *
 * Tests the Posts tab home dashboard.
 * The Posts tab now renders: Today header, KPI strip, pipeline summary widgets,
 * a "Recent rule firings" panel, and a "Priority queue" panel (top 5 open posts).
 *
 * Full triage functionality (thread expand, bulk ops, draft reply) is accessible
 * via the "Browse all posts" button which opens a full-screen drawer with the
 * ContentBrowser — those interactions are covered in content.spec.ts.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Posts dashboard tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Posts tab is the default — "Today" header should render immediately
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
      timeout: 10000,
    });
  });

  test('renders the "Today" header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('"Browse all posts" button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Browse all posts' })).toBeVisible();
  });

  test('KPI strip is present with Posts today tile', async ({ page }) => {
    // KPI strip renders the Overview component — "Posts today" tile
    await expect(page.getByText('Posts today').first()).toBeVisible({ timeout: 8000 });
  });

  test('"Installed pipelines" section renders', async ({ page }) => {
    // Section heading is always rendered, even when no pipelines are installed
    await expect(page.getByText('Installed pipelines').first()).toBeVisible({ timeout: 8000 });
  });

  test('"Recent rule firings" panel is visible', async ({ page }) => {
    await expect(page.getByText('Recent rule firings').first()).toBeVisible({ timeout: 8000 });
  });

  test('"Priority queue" panel is visible', async ({ page }) => {
    await expect(page.getByText('Priority queue').first()).toBeVisible({ timeout: 8000 });
  });

  test('priority queue shows top open posts from fixture', async ({ page }) => {
    // The triage queue fixture has 3 open items; limit=5 returns all 3
    // The post title should appear in the priority queue panel
    await expect(page.getByText('App crashes every time I try to checkout').first()).toBeVisible({
      timeout: 8000,
    });
  });

  test('"Browse all posts" opens the content browser drawer', async ({ page }) => {
    await page.getByRole('button', { name: 'Browse all posts' }).click();
    // Drawer appears with "All posts" heading
    await expect(page.getByRole('heading', { name: 'All posts' })).toBeVisible({ timeout: 8000 });
    // Close button should be present
    await expect(page.getByRole('button', { name: 'Close browse posts' })).toBeVisible();
  });

  test('closing the drawer restores the dashboard view', async ({ page }) => {
    await page.getByRole('button', { name: 'Browse all posts' }).click();
    await expect(page.getByRole('heading', { name: 'All posts' })).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Close browse posts' }).click();
    await expect(page.getByRole('heading', { name: 'All posts' })).not.toBeVisible({
      timeout: 3000,
    });
    // Dashboard heading is still there
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('"No pipelines" empty state shows catalogue CTA when no pipelines installed', async ({
    page,
  }) => {
    // Mock returns empty instances
    await page.route('**/api/pipelines/instances', async (route) => {
      await route.fulfill({ json: { count: 0, instances: [] } });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: 'Browse catalogue' })).toBeVisible({
      timeout: 8000,
    });
  });

  test('no rules message when rules list is empty', async ({ page }) => {
    // Default mock already returns empty rules — so "No automation rules yet" or
    // "No rules have fired yet" should appear in the panel
    // Expand the panel (it starts open by default)
    const noRuleMsg = page.getByText(/No automation rules yet|No rules have fired yet/).first();
    await expect(noRuleMsg).toBeVisible({ timeout: 8000 });
  });

  test('"Inbox clear" state when priority queue is empty', async ({ page }) => {
    await page.route('**/api/triage/queue*', async (route) => {
      await route.fulfill({ json: { items: [], count: 0, generatedAt: Date.now() } });
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/Inbox clear/i)).toBeVisible({ timeout: 8000 });
  });
});
