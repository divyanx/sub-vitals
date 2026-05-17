/**
 * overview.spec.ts
 *
 * Tests the "Pulse" (Overview) tab inside the Dashboard — 4 summary cards and
 * the recent activity feed.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Overview (Pulse) tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Navigate to the Pulse tab via nav
    await page.getByRole('button', { name: 'Pulse' }).click();
    // Wait for summary cards
    await expect(page.getByText('Top driver today')).toBeVisible({ timeout: 10000 });
  });

  test('all 4 overview cards are present', async ({ page }) => {
    await expect(page.getByText('Top driver today')).toBeVisible();
    await expect(page.getByText('Posts today')).toBeVisible();
    await expect(page.getByText('Avg sentiment')).toBeVisible();
    await expect(page.getByText('AI spend this month')).toBeVisible();
  });

  test('"Top driver today" card shows fixture value', async ({ page }) => {
    // Fixture: topDriverLabel = "Bug / broken experience"
    await expect(page.getByText('Bug / broken experience')).toBeVisible();
  });

  test('"Posts today" card shows fixture count (14)', async ({ page }) => {
    // Fixture: totalPosts = 14
    const cards = page.getByRole('article');
    const texts = await cards.allTextContents();
    expect(texts.some((t) => t.includes('14'))).toBe(true);
  });

  test('"Avg sentiment" card shows -0.18 in negative tone', async ({ page }) => {
    await expect(page.getByText('-0.18')).toBeVisible();
  });

  test('"AI spend this month" card shows dollar value', async ({ page }) => {
    // Fixture: monthCents = 42  → $0.420
    await expect(page.getByText(/\$0\.4[0-9]+/)).toBeVisible();
  });

  test('recent activity feed renders with fixture posts', async ({ page }) => {
    // Fixture has 5 recent posts
    await expect(page.getByText('Recent activity')).toBeVisible();
    await expect(page.getByText('App crashes every time I try to checkout')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Love the new redesign, UI feels so clean')).toBeVisible();
  });

  test('sentiment and driver badges appear on recent posts', async ({ page }) => {
    // At least one "negative" sentiment badge
    await expect(page.getByText('negative').first()).toBeVisible();
    // At least one driver badge with "bug · ai" text — use .first() since multiple posts have it
    await expect(page.getByText(/bug · ai/).first()).toBeVisible();
  });
});
