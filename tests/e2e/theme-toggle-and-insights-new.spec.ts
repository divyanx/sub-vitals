/**
 * theme-toggle-and-insights-new.spec.ts
 *
 * 1. Theme toggle is present exactly once (in the header) on every primary tab.
 * 2. The "+ New" button in the Insights sub-tab strip opens the new pipeline modal.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

// ── Bug 1: exactly one theme toggle across all tabs ─────────────────────────

const TABS = [
  { name: 'Inbox', url: '/?tab=inbox' },
  { name: 'Overview (Pulse)', url: '/?tab=overview' },
  { name: 'Insights', url: '/?tab=insights' },
  { name: 'Incidents', url: '/?tab=incidents' },
  { name: 'Pipelines', url: '/?tab=pipelines' },
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

// ── Bug 3: "+ New" button in Insights opens the new pipeline modal ──────────

test('Insights "+ New" button navigates to Pipelines and opens new pipeline modal', async ({
  page,
}) => {
  await setupMocks(page);
  await page.goto('/?tab=insights');
  await page.waitForLoadState('networkidle');

  // Wait for the sub-tab strip to appear (pipelines-enabled loads)
  await page.waitForSelector('[data-testid="insights-new-pipeline-btn"]', { timeout: 8000 });

  // Click the "+ New" button
  await page.click('[data-testid="insights-new-pipeline-btn"]');

  // Should land on Pipelines tab and the new pipeline modal should be open
  await expect(page.getByRole('heading', { name: /new pipeline/i })).toBeVisible({
    timeout: 8000,
  });
});

test('Insights "+ New" button is visible in the sub-tab strip', async ({ page }) => {
  await setupMocks(page);
  await page.goto('/?tab=insights');
  await page.waitForLoadState('networkidle');

  const btn = page.getByTestId('insights-new-pipeline-btn');
  await expect(btn).toBeVisible({ timeout: 8000 });
  await expect(btn).toHaveAttribute('aria-label', 'Create new pipeline');
});
