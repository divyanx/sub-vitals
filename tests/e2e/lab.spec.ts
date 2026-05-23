/**
 * Data Lab tab e2e tests.
 *
 * Tests:
 *  1. Lab tab renders with all 4 sections
 *  2. Simulate-a-post form renders and can submit
 *  3. Simulate-a-comment quick-pick chip selects the post id
 *  4. Scenario run button triggers toast
 *  5. Clear lab data confirmation flow
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

async function openLabTab(page: import('@playwright/test').Page) {
  await setupMocks(page);
  await page.goto('/');
  // Lab is now under Settings ▾ → Lab
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Lab' }).click();
  await expect(page.getByTestId('lab-tab')).toBeVisible({ timeout: 8000 });
}

test.describe('Lab tab', () => {
  test('renders with all 4 sections', async ({ page }) => {
    await openLabTab(page);

    await expect(page.getByText('Simulate a post')).toBeVisible();
    await expect(page.getByText('Simulate a comment')).toBeVisible();
    await expect(page.getByText('Run a scenario')).toBeVisible();
    await expect(page.getByText('Clear lab data')).toBeVisible();
  });

  test('simulate-a-post renders form elements', async ({ page }) => {
    await openLabTab(page);

    await expect(page.getByLabel('Title')).toBeVisible();
    // Use first() because both simulate-post and simulate-comment sections have a Body label
    await expect(page.getByLabel('Body').first()).toBeVisible();
    await expect(page.getByLabel('Author').first()).toBeVisible();
    await expect(page.getByTestId('lab-simulate-post-btn')).toBeVisible();
  });

  test('simulate-a-post submit shows toast with postId', async ({ page }) => {
    await openLabTab(page);

    // Fill the title field
    await page.getByLabel('Title').fill('Test crash report');

    // Submit
    await page.getByTestId('lab-simulate-post-btn').click();

    // Expect toast with the post id
    await expect(page.getByText(/Post created/)).toBeVisible({ timeout: 6000 });
  });

  test('simulate-a-comment quick-pick chip sets post id', async ({ page }) => {
    await openLabTab(page);

    // Wait for recent posts chips to appear
    const chip = page.getByTestId('lab-recent-post-chip-t3_lab_111');
    await expect(chip).toBeVisible({ timeout: 6000 });

    // Click chip and verify the post id input is updated
    await chip.click();
    await expect(page.locator('#lab-cmt-postid')).toHaveValue('t3_lab_111');
  });

  test('run scenario triggers toast', async ({ page }) => {
    await openLabTab(page);

    // Wait for scenarios to load
    await expect(page.getByTestId('lab-scenario-run-crisis-cluster')).toBeVisible({
      timeout: 6000,
    });
    await page.getByTestId('lab-scenario-run-crisis-cluster').click();

    await expect(page.getByText(/scenario.*started/i)).toBeVisible({ timeout: 6000 });
  });

  test('clear lab data: danger button opens confirmation modal', async ({ page }) => {
    await openLabTab(page);

    await page.getByRole('button', { name: /delete all simulated posts/i }).click();
    await expect(page.getByPlaceholder('DELETE')).toBeVisible({ timeout: 4000 });
    await expect(page.getByTestId('lab-clear-confirm-btn')).toBeDisabled();
  });

  test('clear lab data: typing DELETE enables the confirm button', async ({ page }) => {
    await openLabTab(page);

    await page.getByRole('button', { name: /delete all simulated posts/i }).click();
    await page.getByPlaceholder('DELETE').fill('DELETE');
    await expect(page.getByTestId('lab-clear-confirm-btn')).not.toBeDisabled();
  });

  // Regression — typing text in the Lab post form must not trigger the
  // global `g p` / `g i` / `g r` / `g ,` navigation chord shortcuts.
  // Before the fix, "gig" mid-sentence would jump to Pipelines.
  test('typing chord bigrams in post title does NOT navigate away', async ({ page }) => {
    await openLabTab(page);
    const title = page.getByLabel('Title');
    await title.click();
    await title.pressSequentially('the gig is up, going to ship rules', { delay: 30 });
    // Still on Lab — URL section param sticks, lab-tab still mounted.
    await expect(page.getByTestId('lab-tab')).toBeVisible();
    await expect(title).toHaveValue('the gig is up, going to ship rules');
  });
});
