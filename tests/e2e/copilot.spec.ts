/**
 * copilot.spec.ts — E2E for the Copilot floating panel.
 *
 * Mocks /api/copilot/* via mock-api.ts. Verifies:
 *   1. Floating ✨ button is always visible on the dashboard
 *   2. Clicking opens the side panel
 *   3. Sending a read-style query renders the assistant reply
 *   4. Sending an "install" command renders a confirmation card with Confirm/Cancel
 *   5. Clicking Confirm commits and switches the card to the success state
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Copilot panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Wait for the dashboard shell.
    await expect(page.getByTestId('copilot-fab')).toBeVisible({ timeout: 10000 });
  });

  test('floating button toggles the panel', async ({ page }) => {
    const fab = page.getByTestId('copilot-fab');
    await fab.click();
    await expect(page.getByTestId('copilot-panel')).toBeVisible();
    await page.getByTestId('copilot-close').click();
    await expect(page.getByTestId('copilot-panel')).not.toBeVisible();
  });

  test('read-style query renders an assistant reply', async ({ page }) => {
    await page.getByTestId('copilot-fab').click();
    await page.getByTestId('copilot-input').fill('show me bug-tagged posts');
    await page.getByTestId('copilot-send').click();
    await expect(page.getByTestId('copilot-msg-assistant')).toBeVisible();
    await expect(page.getByText('Here are the 3 most recent')).toBeVisible();
    // Read-tool call card renders inline.
    await expect(page.getByTestId('copilot-tool-read')).toBeVisible();
  });

  test('install command renders confirmation + Confirm commits', async ({ page }) => {
    await page.getByTestId('copilot-fab').click();
    await page.getByTestId('copilot-input').fill('install the spam detector');
    await page.getByTestId('copilot-send').click();

    const confirmCard = page.getByTestId('copilot-tool-confirm');
    await expect(confirmCard).toBeVisible();
    await expect(confirmCard.getByText('Install pipeline')).toBeVisible();

    await page.getByTestId('copilot-confirm').click();
    await expect(page.getByTestId('copilot-tool-committed')).toBeVisible();
  });

  test('Cancel dismisses the confirmation card', async ({ page }) => {
    await page.getByTestId('copilot-fab').click();
    await page.getByTestId('copilot-input').fill('install the spam detector');
    await page.getByTestId('copilot-send').click();
    await expect(page.getByTestId('copilot-tool-confirm')).toBeVisible();
    await page.getByTestId('copilot-cancel').click();
    await expect(page.getByTestId('copilot-tool-dismissed')).toBeVisible();
  });
});
