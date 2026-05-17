/**
 * agents.spec.ts
 *
 * Tests the Agents tab — verified agent list renders with username, role, date.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Agents tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Agents' }).click();
    // Wait for agent list
    await expect(page.getByText('u/brand_agent_alice')).toBeVisible({ timeout: 10000 });
  });

  test('all 3 agents from fixture are listed', async ({ page }) => {
    await expect(page.getByText('u/brand_agent_alice')).toBeVisible();
    await expect(page.getByText('u/support_bot_beta')).toBeVisible();
    await expect(page.getByText('u/community_manager_charlie')).toBeVisible();
  });

  test('agent roles are displayed', async ({ page }) => {
    // Fixture: alice=lead, beta=verified, charlie=verified
    // Scope to the roster list to avoid the leaderboard section header "Verified roster"
    const roster = page.locator('ul.divide-y').last();
    await expect(roster.getByText('lead')).toBeVisible();
    await expect(roster.getByText('verified')).toHaveCount(2);
  });

  test('verified dates are displayed', async ({ page }) => {
    // Dates are rendered by toLocaleDateString — just check dates are present somewhere
    const listItems = page.locator('ul > li');
    await expect(listItems).toHaveCount(3);

    // Each list item should have some date-like text
    const firstItem = listItems.first();
    const text = await firstItem.textContent();
    expect(text).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
  });

  test('agent list is inside a bordered container', async ({ page }) => {
    const list = page.locator('ul.divide-y');
    await expect(list).toBeVisible();
  });
});
