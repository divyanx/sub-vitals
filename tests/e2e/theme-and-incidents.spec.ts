/**
 * theme-and-incidents.spec.ts
 *
 * End-to-end tests for the Themes and Incidents tabs.
 * Both features are implemented in Dashboard.tsx and served via mock-api.ts.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Themes tab', () => {
  test('themes/latest data renders in the Themes tab', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Insights' }).click();
    await page.getByRole('tab', { name: 'Themes' }).click();
    // The fixture has a theme named "Checkout crash wave"
    await expect(page.getByText('Checkout crash wave')).toBeVisible({ timeout: 8000 });
  });

  test('Regenerate button is visible on the Themes tab', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Insights' }).click();
    await page.getByRole('tab', { name: 'Themes' }).click();
    await expect(page.getByRole('button', { name: /regenerate/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Incidents tab', () => {
  test('incidents UI section renders with filter chips', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Incidents' }).click();
    // Filter chips should be visible
    await expect(page.getByRole('button', { name: 'active' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'resolved' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'all' })).toBeVisible();
  });

  test('filter chips have aria-pressed attribute', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Incidents' }).click();
    await page.waitForTimeout(500);
    // 'active' chip should be pressed by default
    const activeChip = page.getByRole('button', { name: 'active' });
    await expect(activeChip).toHaveAttribute('aria-pressed', 'true');
    const resolvedChip = page.getByRole('button', { name: 'resolved' });
    await expect(resolvedChip).toHaveAttribute('aria-pressed', 'false');
  });
});
