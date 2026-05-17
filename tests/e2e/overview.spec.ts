/**
 * overview.spec.ts
 *
 * Tests the redesigned "Pulse" (Overview) tab — 6 KPI tiles, per-driver
 * sparklines, hour-of-day heatmap, top themes section, and activity ticker.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Overview (Pulse) tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Navigate to the Pulse tab via nav
    await page.getByRole('tab', { name: 'Pulse' }).click();
    // Wait for KPI strip to appear (using a label unique to the KPI strip)
    await expect(page.getByText('Posts today')).toBeVisible({ timeout: 10000 });
  });

  test('all 6 KPI tiles are present', async ({ page }) => {
    const articles = page.getByRole('article');
    // At least 6 KPI tiles — there may be more articles from sparkline cards etc.
    await expect(articles).toHaveCount(6, { timeout: 8000 });
  });

  test('KPI labels are present', async ({ page }) => {
    await expect(page.getByText('Posts today')).toBeVisible();
    await expect(page.getByText('Negative share')).toBeVisible();
    await expect(page.getByText('Top driver')).toBeVisible();
    await expect(page.getByText('Active incidents')).toBeVisible();
    await expect(page.getByText('Avg first-response')).toBeVisible();
    await expect(page.getByText('LLM spend (MTD)')).toBeVisible();
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

  test('"LLM spend" KPI shows dollar value', async ({ page }) => {
    // Fixture: monthCents = 42 → $0.420
    await expect(page.getByText(/\$0\.4[0-9]+/)).toBeVisible();
  });

  test('driver sparklines section renders', async ({ page }) => {
    await expect(page.getByText('Contact drivers · 14-day trend')).toBeVisible({ timeout: 8000 });
    // Fixture taxonomy has 5 drivers — each rendered as a button
    const sparklineButtons = page.getByRole('button', {
      name: /posts today\. Click to view driver/,
    });
    await expect(sparklineButtons).toHaveCount(5, { timeout: 8000 });
  });

  test('heatmap section renders with day labels', async ({ page }) => {
    await expect(page.getByText('Activity heatmap · day × hour')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Mon')).toBeVisible();
    await expect(page.getByText('Sun')).toBeVisible();
  });

  test('themes section renders', async ({ page }) => {
    await expect(page.getByText('Emerging themes')).toBeVisible({ timeout: 8000 });
    // Mock returns themes fixture — show a theme name or the section heading
    await expect(page.getByText('Emerging themes')).toBeVisible();
  });

  test('recent activity ticker renders with fixture posts', async ({ page }) => {
    await expect(page.getByText('Recent activity')).toBeVisible();
    await expect(page.getByText('App crashes every time I try to checkout')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Love the new redesign, UI feels so clean')).toBeVisible();
  });

  test('sentiment and driver badges appear in the activity ticker', async ({ page }) => {
    // At least one "negative" sentiment badge in the ticker
    await expect(page.getByText('negative').first()).toBeVisible();
    // At least one driver badge with "bug · ai" text
    await expect(page.getByText(/bug · ai/).first()).toBeVisible();
  });
});
