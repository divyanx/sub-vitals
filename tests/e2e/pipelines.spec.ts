/**
 * pipelines.spec.ts
 *
 * End-to-end tests for the Pipelines tab.
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

  test('all 6 pipeline cards render', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });

    // Check each named pipeline card is visible
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

  test('each pipeline card shows Active badge', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });

    const activeBadges = page.getByText('Active');
    await expect(activeBadges.first()).toBeVisible();
    // At least 6 active badges (one per pipeline card)
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

  test('Contact Drivers card has Settings link', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipeline-card-contact-drivers')).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByTestId('pipeline-card-contact-drivers').getByRole('button', { name: /Settings/i }),
    ).toBeVisible();
  });

  test('Contact Drivers Settings → navigates to Settings tab', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipeline-card-contact-drivers')).toBeVisible({ timeout: 8000 });
    await page
      .getByTestId('pipeline-card-contact-drivers')
      .getByRole('button', { name: /Settings/i })
      .click();
    // Should navigate to Settings tab
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('Tune button on a pipeline card opens the drawer', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await expect(page.getByTestId('pipelines-grid')).toBeVisible({ timeout: 8000 });
    // Click the Tune button on the Sentiment pipeline card
    await page.getByTestId('pipeline-tune-sentiment').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await expect(
      page.getByRole('dialog', { name: /Sentiment scoring pipeline settings/i }),
    ).toBeVisible();
  });

  test('Drawer shows Prompts tab by default', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipeline-tune-sentiment').click();
    await expect(page.getByTestId('pipeline-drawer')).toBeVisible({ timeout: 6000 });
    await expect(page.getByLabel('System prompt')).toBeVisible();
  });

  test('Drawer closes on Escape key', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Pipelines' }).click();
    await page.getByTestId('pipeline-tune-sentiment').click();
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
});
