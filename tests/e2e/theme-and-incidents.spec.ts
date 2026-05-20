/**
 * theme-and-incidents.spec.ts
 *
 * End-to-end tests for the Themes and Incidents sections.
 * Both features are inline sections within the Posts tab in IA reset v2.
 * The Watch tab no longer exists as a primary tab.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Themes tab', () => {
  test('themes/latest data renders in the Themes section', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Themes is an inline section within Posts tab
    await expect(page.getByRole('tab', { name: 'Posts' })).toBeVisible({ timeout: 5000 });
    // The fixture has a theme named "Checkout crash wave"
    await expect(page.getByText('Checkout crash wave')).toBeVisible({ timeout: 8000 });
  });

  test('Regenerate button is visible in the Themes section', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: /regenerate/i })).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Incidents tab', () => {
  test('incidents UI section renders with filter chips', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Incidents section renders inside Posts tab
    // Filter chips should be visible
    await expect(page.getByRole('button', { name: 'active' })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'resolved' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'all' })).toBeVisible();
  });

  test('filter chips have aria-pressed attribute', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.waitForTimeout(500);
    // 'active' chip should be pressed by default
    const activeChip = page.getByRole('button', { name: 'active' });
    await expect(activeChip).toHaveAttribute('aria-pressed', 'true');
    const resolvedChip = page.getByRole('button', { name: 'resolved' });
    await expect(resolvedChip).toHaveAttribute('aria-pressed', 'false');
  });
});
