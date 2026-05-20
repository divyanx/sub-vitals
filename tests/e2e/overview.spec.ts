/**
 * overview.spec.ts
 *
 * Tests the KPI strip on the Posts tab (default dashboard view).
 * The Posts tab is the at-a-glance home: KPI strip, pipeline summary widgets,
 * rule firings, and priority queue.
 *
 * In IA reset v2 these KPIs live inside the Posts tab (default view).
 * The ?tab=overview URL redirects to posts via LEGACY_TAB_MAP.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Overview (Pulse) tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Posts tab is the default — KPI strip should render immediately.
    // Use .first() because "Posts today" also appears in tooltip content.
    await expect(page.getByText('Posts today').first()).toBeVisible({ timeout: 10000 });
  });

  test('all 6 KPI tiles are present', async ({ page }) => {
    const articles = page.getByRole('article');
    // At least 6 KPI tiles — there may be more articles from sparkline cards etc.
    await expect(articles).toHaveCount(6, { timeout: 8000 });
  });

  test('KPI labels are present', async ({ page }) => {
    await expect(page.getByText('Posts today').first()).toBeVisible();
    await expect(page.getByText('Negative share').first()).toBeVisible();
    await expect(page.getByText('Top driver').first()).toBeVisible();
    await expect(page.getByText('Active incidents').first()).toBeVisible();
    await expect(page.getByText('Avg first-response').first()).toBeVisible();
    await expect(page.getByText('AI spend (MTD)').first()).toBeVisible();
  });

  test('"Posts today" KPI shows fixture count (14)', async ({ page }) => {
    const articles = page.getByRole('article');
    const texts = await articles.allTextContents();
    expect(texts.some((t) => t.includes('14'))).toBe(true);
  });

  test('"Top driver" KPI shows fixture value', async ({ page }) => {
    // Fixture: topDriverLabel = "Bug / broken experience"
    // Appears in both KPI tile and sparkline — use .first()
    await expect(page.getByText('Bug / broken experience').first()).toBeVisible();
  });

  test('"AI spend" KPI shows dollar value', async ({ page }) => {
    // Fixture: monthCents = 42 → $0.420
    await expect(page.getByText(/\$0\.4[0-9]+/).first()).toBeVisible();
  });

  test('driver sparklines section renders', async ({ page }) => {
    await expect(page.getByText('Drivers · 14-day trend').first()).toBeVisible({ timeout: 8000 });
    // Fixture taxonomy has multiple drivers — at least 1 sparkline button rendered
    const sparklineButtons = page.getByRole('button', {
      name: /posts today\. Click to view driver/,
    });
    expect(await sparklineButtons.count()).toBeGreaterThanOrEqual(5);
  });

  test('heatmap section renders with day labels', async ({ page }) => {
    await expect(page.getByText('Activity heatmap · day × hour').first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Mon').first()).toBeVisible();
    await expect(page.getByText('Sun').first()).toBeVisible();
  });

  test('pipeline summaries section renders', async ({ page }) => {
    // The new Posts dashboard always renders the "Installed pipelines" section heading
    await expect(page.getByText('Installed pipelines').first()).toBeVisible({ timeout: 8000 });
  });

  test('recent activity ticker renders with fixture posts', async ({ page }) => {
    await expect(page.getByText('Recent activity').first()).toBeVisible();
    await expect(page.getByText('App crashes every time I try to checkout').first()).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Love the new redesign, UI feels so clean').first()).toBeVisible();
  });

  test('sentiment and driver badges appear in the activity ticker', async ({ page }) => {
    // At least one "negative" sentiment badge in the ticker
    await expect(page.getByText('negative').first()).toBeVisible();
    // Driver badge now renders the breadcrumb label + "(ai)" — match the
    // taggedBy parens that always appear when a driver is AI-tagged.
    await expect(page.getByText(/\(ai\)/).first()).toBeVisible();
  });
});
