/**
 * audit.spec.ts
 *
 * Tests for the Audit tab — mod action log with filters.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

async function goToAuditTab(page: Page): Promise<void> {
  await setupMocks(page);
  await page.goto('/');
  // Wait for the app to be ready (inbox loads first)
  await expect(page.getByText('App crashes every time I try to checkout')).toBeVisible({
    timeout: 10000,
  });
  // Audit is now under Settings ▾ → Audit log
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'Audit log' }).click();
}

test.describe('Audit tab', () => {
  test('tab renders without error', async ({ page }) => {
    await goToAuditTab(page);
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible({ timeout: 6000 });
  });

  test('shows empty state when no entries exist', async ({ page }) => {
    await goToAuditTab(page);
    // The mock returns 0 entries — expect empty hint text
    await expect(page.getByText(/No audit entries yet/i)).toBeVisible({ timeout: 6000 });
  });

  test('action filter chips are rendered', async ({ page }) => {
    await goToAuditTab(page);
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'tag-issue' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'mark-resolved' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'settings-update' })).toBeVisible();
  });

  test('clicking an action filter chip fires a new /api/audit request with action param', async ({
    page,
  }) => {
    await goToAuditTab(page);
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible({ timeout: 6000 });

    let lastUrl = '';
    page.on('request', (req) => {
      if (req.url().includes('/api/audit')) lastUrl = req.url();
    });

    await page.getByRole('button', { name: 'mark-resolved' }).click();
    await page.waitForTimeout(400);

    expect(lastUrl).toContain('action=mark-resolved');
  });

  test('actor free-text filter sends actor param on Enter', async ({ page }) => {
    await goToAuditTab(page);
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible({ timeout: 6000 });

    let lastUrl = '';
    page.on('request', (req) => {
      if (req.url().includes('/api/audit')) lastUrl = req.url();
    });

    const actorInput = page.getByPlaceholder('username…');
    await actorInput.fill('mod_alice');
    await actorInput.press('Enter');
    await page.waitForTimeout(400);

    expect(lastUrl).toContain('actor=mod_alice');
  });
});
