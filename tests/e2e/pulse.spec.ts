/**
 * pulse.spec.ts
 *
 * Tests the Pulse view (?view=pulse) — the Daily Pulse pinned-post widget.
 * 4 stat cards should render with values sourced from the pulse-stats fixture.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Pulse view', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('four stat cards render with fixture values', async ({ page }) => {
    await page.goto('/?view=pulse');

    // Wait for skeleton to disappear (data is loaded)
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 8000 });

    // All 4 stat cards should exist (Posts today / Top driver / Negative share / Active incidents)
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(4);

    // "Top driver" card — fixture has label "Bug / broken experience"
    await expect(page.getByText('Bug / broken experience')).toBeVisible();

    // "Posts today" card — fixture has postsToday = 14
    await expect(page.getByText('14').first()).toBeVisible();

    // "Negative share" card — fixture has 0.36 → "36%"
    await expect(page.getByText('36%').first()).toBeVisible();

    // "Active incidents" card — fixture has 1 incident
    await expect(page.getByText('needs attention')).toBeVisible();
  });

  test('"Open full dashboard" CTA is visible and clickable', async ({ page }) => {
    await page.goto('/?view=pulse');

    const cta = page.getByRole('button', { name: /open full dashboard/i });
    await expect(cta).toBeVisible({ timeout: 8000 });
    await cta.click();

    // After clicking, the dashboard nav should appear — Posts is the default tab
    await expect(page.getByRole('tab', { name: 'Posts' })).toBeVisible({ timeout: 5000 });
  });

  test('header shows SubVitals brand name', async ({ page }) => {
    await page.goto('/?view=pulse');
    await expect(page.getByRole('heading', { name: /SubVitals/i })).toBeVisible({ timeout: 8000 });
  });
});
