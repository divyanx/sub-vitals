/**
 * settings.spec.ts
 *
 * End-to-end tests for the Settings tab.
 * In IA reset v2 Settings is a primary tab with a dropdown.
 * Taxonomy editor tests navigate to the Posts tab where Drivers inline panel lives.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Settings tab', () => {
  test('settings sections load', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Settings/Brand is now under Settings ▾ → Brand
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Brand' }).click();
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
    // Settings/Brand is now under Settings ▾ → Brand
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Brand' }).click();
    // Click the first Save button (Brand identity section)
    await page
      .getByRole('button', { name: /^save$/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    expect(putFired).toBe(true);
  });
});

// Helper: navigate to Posts tab and open the Drivers config panel
async function openDriversConfigPanel(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Posts' }).click();
  await page.getByTestId('drivers-config-toggle').click();
  await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
}

test.describe('Taxonomy editor', () => {
  test('taxonomy section renders in visual mode by default', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible({ timeout: 4000 });
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible();
  });

  test('can switch to JSON mode', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('taxonomy-json-toggle').click();
    await expect(page.getByTestId('taxonomy-json-editor')).toBeVisible();
    await expect(page.getByTestId('taxonomy-driver-list')).not.toBeVisible();
  });

  test('can add a new driver in visual mode', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });

    const cardsBefore = await page.getByTestId('taxonomy-driver-list').locator('> div').count();

    await page.getByTestId('taxonomy-add-driver').click();
    const cardsAfter = await page.getByTestId('taxonomy-driver-list').locator('> div').count();
    expect(cardsAfter).toBe(cardsBefore + 1);
  });

  test('delete button shows confirmation modal', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });

    // Click the first delete button (trash icon)
    await page
      .getByRole('button', { name: /delete driver/i })
      .first()
      .click();
    // Confirmation modal should appear
    await expect(page.getByText(/delete driver\?/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /delete$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
  });

  test('confirming delete removes the driver card', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });

    const cardsBefore = await page.getByTestId('taxonomy-driver-list').locator('> div').count();

    await page
      .getByRole('button', { name: /delete driver/i })
      .first()
      .click();
    await expect(page.getByText(/delete driver\?/i)).toBeVisible();
    await page.getByRole('button', { name: /delete$/i }).click();

    // Modal dismissed
    await expect(page.getByText(/delete driver\?/i)).not.toBeVisible();
    const cardsAfter = await page.getByTestId('taxonomy-driver-list').locator('> div').count();
    expect(cardsAfter).toBe(cardsBefore - 1);
  });

  test('cancelling delete keeps the driver card', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });

    const cardsBefore = await page.getByTestId('taxonomy-driver-list').locator('> div').count();

    await page
      .getByRole('button', { name: /delete driver/i })
      .first()
      .click();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/delete driver\?/i)).not.toBeVisible();

    const cardsAfter = await page.getByTestId('taxonomy-driver-list').locator('> div').count();
    expect(cardsAfter).toBe(cardsBefore);
  });

  test('live preview shows colored chips for each driver', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });
    // The preview section should contain "Current drivers:"
    await expect(page.getByText(/current drivers:/i)).toBeVisible();
  });

  test('JSON mode textarea contains valid JSON', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('taxonomy-json-toggle').click();
    await expect(page.getByTestId('taxonomy-json-editor')).toBeVisible();

    const content = await page.getByTestId('taxonomy-json-editor').inputValue();
    // Should be valid JSON
    expect(() => JSON.parse(content)).not.toThrow();
    const parsed = JSON.parse(content) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
  });

  test('taxonomy save button fires PUT with taxonomy-json key', async ({ page }) => {
    await setupMocks(page);
    let taxonomyPutFired = false;
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/api/settings')) {
        const body = req.postData() ?? '';
        if (body.includes('taxonomy-json')) {
          taxonomyPutFired = true;
        }
      }
    });

    await page.goto('/');
    await openDriversConfigPanel(page);
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 8000 });

    // Find the Save button inside the taxonomy section
    const taxonomySection = page
      .locator('section')
      .filter({ hasText: /contact driver taxonomy/i })
      .first();
    await taxonomySection
      .getByRole('button', { name: /^save$/i })
      .first()
      .click();
    await page.waitForTimeout(500);

    expect(taxonomyPutFired).toBe(true);
  });
});
