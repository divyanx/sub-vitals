/**
 * export.spec.ts
 *
 * Tests the Export tab — section headings, download link buttons with correct
 * hrefs, REST endpoint documentation list.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Export tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Export is now under Settings ▾ → Export
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Export' }).click();
    // Wait for section heading
    await expect(page.getByText('Data export')).toBeVisible({ timeout: 8000 });
  });

  test('"Data export" section heading is visible', async ({ page }) => {
    await expect(page.getByText('Data export')).toBeVisible();
  });

  test('"REST endpoints" section heading is visible', async ({ page }) => {
    await expect(page.getByText('REST endpoints')).toBeVisible();
  });

  test('"Download recent 500 posts" link has correct href', async ({ page }) => {
    const link500 = page.getByRole('link', { name: /500 posts/i });
    await expect(link500).toBeVisible();
    const href = await link500.getAttribute('href');
    expect(href).toBe('/api/export/posts.csv?limit=500');
  });

  test('"Download recent 1000 posts" link has correct href', async ({ page }) => {
    const link1000 = page.getByRole('link', { name: /1000 posts/i });
    await expect(link1000).toBeVisible();
    const href = await link1000.getAttribute('href');
    expect(href).toBe('/api/export/posts.csv?limit=1000');
  });

  test('REST endpoints documentation lists key routes', async ({ page }) => {
    await expect(page.getByText('/api/dashboard/summary')).toBeVisible();
    await expect(page.getByText('/api/drivers/taxonomy')).toBeVisible();
    await expect(page.getByText('/api/agents')).toBeVisible();
    await expect(page.getByText('/api/export/posts.csv?limit=N')).toBeVisible();
  });

  test('both download links have target="_top" for Reddit iframe navigation', async ({ page }) => {
    const links = page.locator('a[href*="/api/export/posts.csv"]');
    const count = await links.count();
    expect(count).toBe(2);

    for (let i = 0; i < count; i++) {
      const target = await links.nth(i).getAttribute('target');
      expect(target).toBe('_top');
    }
  });
});
