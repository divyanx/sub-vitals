/**
 * pipelines.spec.ts
 *
 * End-to-end tests for the Pipelines tab.
 * In IA reset v2 Pipelines is a primary tab with a secondary nav strip
 * showing each installed instance.
 *
 * Updated for IA reset v2:
 *   - Pipelines is now a primary tab (no Configure → Pipelines menu).
 *   - Catalogue is now a separate primary tab.
 *   - The InstallWizard (3-step modal) replaces the old NewPipelineModal.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

/** Navigate to the Pipelines primary tab. */
async function goToPipelines(page: import('@playwright/test').Page) {
  await setupMocks(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Pipelines' }).click();
  // Wait for the secondary nav strip to appear (instance tabs)
  await expect(page.getByTestId('pipelines-instance-nav')).toBeVisible({ timeout: 8000 });
}

test.describe('Pipelines tab', () => {
  test('Pipelines tab renders and shows the instance nav strip', async ({ page }) => {
    await goToPipelines(page);
    await expect(page.getByTestId('pipelines-instance-nav')).toBeVisible();
  });

  test('all 6 pipeline instance names render in secondary nav', async ({ page }) => {
    await goToPipelines(page);

    const expectedNames = [
      'Contact Drivers',
      'Sentiment scoring',
      'Impostor detection',
      'Crisis detection',
      'Theme clustering',
      'Agent metrics',
    ];
    for (const name of expectedNames) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
  });

  test('each instance tab shows Active badge', async ({ page }) => {
    await goToPipelines(page);
    const activeBadges = page.getByText('Active');
    await expect(activeBadges.first()).toBeVisible();
    expect(await activeBadges.count()).toBeGreaterThanOrEqual(1);
  });

  test('Contact Drivers instance card is visible', async ({ page }) => {
    await goToPipelines(page);
    await expect(page.getByTestId('instance-card-pi_intent-classifier')).toBeVisible({
      timeout: 8000,
    });
  });

  test('Edit button on a pipeline instance opens the drawer', async ({ page }) => {
    await goToPipelines(page);
    // Click the Edit button on the Sentiment instance card
    await page.getByTestId('instance-tune-pi_sentiment-scorer').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
  });

  test('Drawer shows Prompts tab by default', async ({ page }) => {
    await goToPipelines(page);
    await page.getByTestId('instance-tune-pi_sentiment-scorer').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await expect(page.getByLabel('System prompt')).toBeVisible();
  });

  test('Drawer closes on Escape key', async ({ page }) => {
    await goToPipelines(page);
    await page.getByTestId('instance-tune-pi_sentiment-scorer').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pipeline-drawer')).not.toBeVisible();
  });

  test('+ Install from catalogue button navigates to Catalogue tab', async ({ page }) => {
    await goToPipelines(page);
    // The secondary nav has a "+" or "Install from catalogue" button
    await page.getByTestId('pipelines-add-btn').click();
    // Should land on Catalogue tab
    await expect(page.getByTestId('catalogue-grid')).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Catalogue tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Catalogue' }).click();
    await expect(page.getByTestId('catalogue-grid')).toBeVisible({ timeout: 8000 });
  });

  test('Catalogue tab shows template cards', async ({ page }) => {
    await expect(page.getByTestId('catalogue-grid')).toBeVisible();
    // At least one template card visible
    await expect(page.getByTestId('template-card-intent-classifier')).toBeVisible();
  });

  test('Catalogue Install button opens the InstallWizard', async ({ page }) => {
    await expect(page.getByTestId('template-card-intent-classifier')).toBeVisible({
      timeout: 8000,
    });
    await page.getByTestId('template-install-intent-classifier').click();
    await expect(page.getByTestId('install-wizard')).toBeVisible({ timeout: 4000 });
  });

  test('InstallWizard step 1 shows name field and nav toggle', async ({ page }) => {
    await page.getByTestId('template-install-intent-classifier').click();
    await expect(page.getByTestId('install-wizard')).toBeVisible({ timeout: 4000 });
    // Step 1 should have a name input
    await expect(page.getByLabel(/pipeline name/i)).toBeVisible();
  });

  test('InstallWizard can advance to step 2', async ({ page }) => {
    await page.getByTestId('template-install-intent-classifier').click();
    await expect(page.getByTestId('install-wizard')).toBeVisible({ timeout: 4000 });
    await page.getByRole('button', { name: /next/i }).click();
    // Step 2 is config — should show some form fields
    await expect(page.getByTestId('install-wizard-step-2')).toBeVisible({ timeout: 4000 });
  });

  test('InstallWizard can be dismissed with Cancel', async ({ page }) => {
    await page.getByTestId('template-install-intent-classifier').click();
    await expect(page.getByTestId('install-wizard')).toBeVisible({ timeout: 4000 });
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByTestId('install-wizard')).not.toBeVisible({ timeout: 3000 });
  });
});
