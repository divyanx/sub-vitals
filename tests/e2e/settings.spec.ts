/**
 * settings.spec.ts
 *
 * Settings tab — skipped because Settings.tsx does not yet exist in the
 * Dashboard. When the feature lands, remove the test.skip calls and implement
 * assertions against the Settings tab sections and PUT request mutations.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Settings tab', () => {
  test.skip(
    true,
    'Settings tab not yet implemented in Dashboard.tsx. Re-enable when Settings.tsx is added.',
  );

  test('settings sections load', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText(/settings/i)).toBeVisible({ timeout: 8000 });
  });

  test('Save button triggers PUT request', async ({ page }) => {
    await setupMocks(page);
    let putFired = false;
    page.on('request', (req) => {
      if (req.method() === 'PUT') putFired = true;
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /save/i }).click();
    await page.waitForTimeout(500);
    expect(putFired).toBe(true);
  });
});
