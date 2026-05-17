/**
 * pulse.spec.ts
 *
 * Tests the Pulse view (?view=pulse) — the Daily Pulse pinned-post widget.
 * 3 stat cards should render with values sourced from the summary fixture.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Pulse view', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('three stat cards render with fixture values', async ({ page }) => {
    await page.goto('/?view=pulse');

    // Wait for skeleton to disappear (data is loaded)
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 8000 });

    // All 3 stat cards should exist
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(3);

    // "Top contact driver" card — fixture has topDriverLabel = "Bug / broken experience"
    const topDriverCard = page.getByText('Bug / broken experience');
    await expect(topDriverCard).toBeVisible();

    // "Today's posts" card — fixture has totalPosts = 14
    // Use .first() since "14" may appear in multiple contexts
    const postCount = page.getByText('14').first();
    await expect(postCount).toBeVisible();

    // "Sentiment" card — fixture averageScore = -0.18
    const sentimentScore = page.getByText('-0.18').first();
    await expect(sentimentScore).toBeVisible();
  });

  test('"Open full dashboard" CTA is visible and clickable', async ({ page }) => {
    await page.goto('/?view=pulse');

    const cta = page.getByRole('button', { name: /open full dashboard/i });
    await expect(cta).toBeVisible({ timeout: 8000 });
    await cta.click();

    // After clicking, the dashboard nav should appear (Inbox tab is default)
    await expect(page.getByRole('button', { name: 'Inbox' })).toBeVisible({ timeout: 5000 });
  });

  test('header shows RedLattice brand name', async ({ page }) => {
    await page.goto('/?view=pulse');
    await expect(page.getByRole('heading', { name: /RedLattice/i })).toBeVisible({ timeout: 8000 });
  });
});
