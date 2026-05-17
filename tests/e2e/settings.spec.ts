/**
 * settings.spec.ts
 *
 * End-to-end tests for the Settings tab.
 * Settings.tsx is implemented and renders under the Settings nav tab.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Settings tab', () => {
  test('settings sections load', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    // The Settings H2 heading should be visible
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({ timeout: 8000 });
    // Brand identity section should render
    await expect(page.getByText(/brand identity/i)).toBeVisible({ timeout: 8000 });
  });

  test('Save button triggers PUT request', async ({ page }) => {
    await setupMocks(page);
    let putFired = false;
    page.on('request', (req) => {
      if (req.method() === 'PUT') putFired = true;
    });

    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    // Click the first Save button (Brand identity section)
    await page
      .getByRole('button', { name: /^save$/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    expect(putFired).toBe(true);
  });
});
