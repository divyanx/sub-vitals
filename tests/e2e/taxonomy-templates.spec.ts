/**
 * taxonomy-templates.spec.ts
 *
 * E2E test for the taxonomy template marketplace:
 *   - Templates section renders inside the "Configure taxonomy" accordion on the Drivers tab
 *   - Cards show name and Apply button
 *   - Clicking Apply on ecommerce opens the confirmation dialog
 *   - Confirming with "Replace" calls the server and shows a toast
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

/** Navigate to the Drivers tab and open the Configure taxonomy accordion. */
async function openTaxonomyConfig(page: Parameters<typeof setupMocks>[0]) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Watch' }).click();
  await page.getByRole('tab', { name: 'Drivers' }).click();

  // Open the "Configure taxonomy" accordion
  const configToggle = page.getByTestId('drivers-config-toggle');
  await expect(configToggle).toBeVisible({ timeout: 10000 });
  const isExpanded = await configToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await configToggle.click();
  }

  // Wait for the config panel
  await expect(page.getByTestId('drivers-config-panel')).toBeVisible({
    timeout: 8000,
  });
}

test.describe('Taxonomy templates marketplace', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('Templates section toggle is visible inside taxonomy config', async ({ page }) => {
    await openTaxonomyConfig(page);

    // The collapsible templates section should be present
    await expect(page.getByTestId('templates-section-toggle')).toBeVisible({
      timeout: 8000,
    });
  });

  test('template cards render when section is open', async ({ page }) => {
    await openTaxonomyConfig(page);

    const toggle = page.getByTestId('templates-section-toggle');
    await expect(toggle).toBeVisible({ timeout: 8000 });

    // If the templates section is closed (there's existing taxonomy), open it
    const isExpanded = await toggle.getAttribute('aria-expanded');
    if (isExpanded === 'false') {
      await toggle.click();
    }

    // Grid of template cards should appear
    await expect(page.getByTestId('templates-grid')).toBeVisible({
      timeout: 6000,
    });
    await expect(page.getByTestId('template-card-ecommerce')).toBeVisible();
    await expect(page.getByTestId('template-card-saas')).toBeVisible();
    await expect(page.getByTestId('template-card-gaming')).toBeVisible();
    await expect(page.getByTestId('apply-template-btn-ecommerce')).toBeVisible();
  });

  test('Apply on ecommerce → confirm Replace → toast success', async ({ page }) => {
    await openTaxonomyConfig(page);

    const toggle = page.getByTestId('templates-section-toggle');
    await expect(toggle).toBeVisible({ timeout: 8000 });

    const isExpanded = await toggle.getAttribute('aria-expanded');
    if (isExpanded === 'false') {
      await toggle.click();
    }

    // Click Apply on ecommerce template
    const applyBtn = page.getByTestId('apply-template-btn-ecommerce');
    await expect(applyBtn).toBeVisible({ timeout: 6000 });
    await applyBtn.click();

    // Confirmation dialog appears
    const confirmBtn = page.getByTestId('apply-template-confirm-btn');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });

    // "Replace" is selected by default — confirm
    await confirmBtn.click();

    // Toast should show success — scope to the aria-live toast container
    const toastContainer = page.locator('[aria-live="polite"]');
    await expect(toastContainer).toContainText(/Applied.*E-Commerce.*template/i, {
      timeout: 8000,
    });
  });
});
