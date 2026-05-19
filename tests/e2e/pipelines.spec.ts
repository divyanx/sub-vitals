/**
 * pipelines.spec.ts
 *
 * End-to-end tests for the Pipelines tab.
 * Updated for the Template/Instance model:
 *   - Installed tab shows instance cards (data-testid="instance-card-{id}")
 *   - Catalogue tab shows template cards (data-testid="template-card-{id}")
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Pipelines tab', () => {
  test('Pipelines tab renders and shows the pipeline grid', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });
  });

  test('all 6 pipeline instance names render', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });

    // Check each named instance card is visible (names from mock-api fixture)
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

  test('each instance card shows Active status', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });

    const activeBadges = page.getByText('Active');
    await expect(activeBadges.first()).toBeVisible();
    // At least 6 active badges (one per enabled instance card)
    expect(await activeBadges.count()).toBeGreaterThanOrEqual(6);
  });

  test('stub Studio card is visible and clickable', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipeline-card-studio-stub')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('pipeline-card-studio-stub').click();
    // Modal should open
    await expect(page.getByRole('dialog', { name: /RedLattice Studio/i })).toBeVisible();
  });

  test('Studio modal contains email input and waitlist CTA', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipeline-card-studio-stub').click();
    await expect(page.getByTestId('studio-email-input')).toBeVisible();
    await expect(page.getByTestId('studio-waitlist-submit')).toBeVisible();
  });

  test('Studio modal closes on × button', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipeline-card-studio-stub').click();
    await expect(page.getByRole('dialog', { name: /RedLattice Studio/i })).toBeVisible();
    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog', { name: /RedLattice Studio/i })).not.toBeVisible();
  });

  test('Contact Drivers instance card is visible', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });
    // Instance card for contact-drivers pre-installed instance
    await expect(
      page.getByTestId('instance-card-pi_intent-classifier'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('Edit button on a pipeline instance opens the drawer', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });
    // Click the Edit button on the Sentiment instance card
    await page.getByTestId('instance-tune-pi_sentiment-scorer').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
  });

  test('Drawer shows Prompts tab by default', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('instance-tune-pi_sentiment-scorer').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await expect(page.getByLabel('System prompt')).toBeVisible();
  });

  test('Drawer closes on Escape key', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('instance-tune-pi_sentiment-scorer').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pipeline-drawer')).not.toBeVisible();
  });

  test('+ New pipeline button opens the modal', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('new-pipeline-button').click();
    await expect(page.getByTestId('new-pipeline-modal')).toBeVisible({ timeout: 6000 });
  });

  test('Custom pipeline can be created from the modal', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('new-pipeline-button').click();
    await expect(page.getByTestId('new-pipeline-modal')).toBeVisible({ timeout: 6000 });
    // Fill form
    await page.getByTestId('new-pipeline-name').fill('Test pipeline');
    await page.getByTestId('new-pipeline-system-prompt').fill('You are a test classifier.');
    await page.getByTestId('new-pipeline-user-prompt').fill('Classify: {{post.title}}');
    // Save
    await page.getByTestId('new-pipeline-save').click();
    // Modal should close after successful create
    await expect(page.getByTestId('new-pipeline-modal')).not.toBeVisible({ timeout: 5000 });
  });

  test('Advanced option in new pipeline modal triggers Studio promotion', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('new-pipeline-button').click();
    await expect(page.getByTestId('new-pipeline-modal')).toBeVisible({ timeout: 6000 });
    // Click "Multiple steps / branching"
    await page.getByTestId('studio-advanced-multiple-steps-/-branching').click();
    // Should close modal and open Studio promotion modal
    await expect(page.getByTestId('new-pipeline-modal')).not.toBeVisible();
    await expect(page.getByRole('dialog', { name: /RedLattice Studio/i })).toBeVisible();
  });

  test('Catalogue tab shows template cards', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    // Switch to Catalogue tab
    await page.getByTestId('pipelines-tab-catalogue').click();
    await expect(page.getByTestId('pipelines-catalogue-grid')).toBeVisible({ timeout: 8000 });
    // At least one template card visible
    await expect(page.getByTestId('template-card-intent-classifier')).toBeVisible();
  });

  test('Catalogue Install button opens install dialog', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipelines-tab-catalogue').click();
    await expect(page.getByTestId('template-card-intent-classifier')).toBeVisible({ timeout: 8000 });
    await page.getByTestId('template-install-intent-classifier').click();
    await expect(page.getByTestId('install-instance-dialog')).toBeVisible({ timeout: 4000 });
  });

  test('Install dialog can be confirmed', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipelines-tab-catalogue').click();
    await page.getByTestId('template-install-intent-classifier').click();
    await expect(page.getByTestId('install-instance-dialog')).toBeVisible({ timeout: 4000 });
    await page.getByTestId('install-instance-confirm').click();
    await expect(page.getByTestId('install-instance-dialog')).not.toBeVisible({ timeout: 5000 });
  });
});
