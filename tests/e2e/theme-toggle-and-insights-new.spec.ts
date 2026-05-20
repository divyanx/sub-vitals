/**
 * theme-toggle-and-insights-new.spec.ts
 *
 * 1. Theme toggle is present exactly once (in the header) on every primary tab.
 * 2. The "+ New" button in the Pipelines tab navigates to the Catalogue tab.
 *
 * Updated for IA reset v2:
 *   - Primary tabs are: Posts, Pipelines, Catalogue, Rules, Settings
 *   - Old tab names (Inbox, Overview, Insights, Incidents) redirect to Posts
 *   - There is no standalone "Insights" sub-tab strip with a "+New" button;
 *     instead the Pipelines tab has a "Install from catalogue" button.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

// ── Bug 1: exactly one theme toggle across all tabs ─────────────────────────

const TABS = [
  { name: 'Posts (default)', url: '/' },
  { name: 'Posts', url: '/?tab=posts' },
  { name: 'Pipelines', url: '/?tab=pipelines' },
  { name: 'Catalogue', url: '/?tab=catalogue' },
  { name: 'Rules', url: '/?tab=rules' },
  { name: 'Settings', url: '/?tab=settings' },
];

for (const { name, url } of TABS) {
  test(`theme toggle appears exactly once on the ${name} tab`, async ({ page }) => {
    await setupMocks(page);
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    // The toggle button has aria-label that starts with "Theme:"
    const toggles = page.getByRole('button', { name: /^Theme:/i });
    await expect(toggles).toHaveCount(1);
  });
}

// ── Pipelines "Install" button navigates to Catalogue tab ──────────────────

test('Pipelines "Install from catalogue" button navigates to Catalogue tab', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/?tab=pipelines');
  await page.waitForLoadState('networkidle');

  // Wait for the secondary nav strip to appear
  await page.waitForSelector('[data-testid="pipelines-instance-nav"]', { timeout: 8000 });

  // Click the add / install button in the secondary nav
  await page.click('[data-testid="pipelines-add-btn"]');

  // Should land on Catalogue tab
  await expect(page.getByTestId('catalogue-grid')).toBeVisible({ timeout: 8000 });
});

test('Pipelines add button is visible in the instance nav strip', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/?tab=pipelines');
  await page.waitForLoadState('networkidle');

  const btn = page.getByTestId('pipelines-add-btn');
  await expect(btn).toBeVisible({ timeout: 8000 });
});
