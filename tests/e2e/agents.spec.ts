/**
 * agents.spec.ts
 *
 * Tests the Team roster — verified rep list renders with username, role, date.
 * In IA reset v2 the team roster lives under Settings ▾ → Team.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Team tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Team is now under Settings ▾ → Team roster
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'Team roster' }).click();
    // Wait for agent list
    await expect(page.getByText('u/brand_agent_alice')).toBeVisible({ timeout: 10000 });
  });

  test('all 3 reps from fixture are listed', async ({ page }) => {
    await expect(page.getByText('u/brand_agent_alice')).toBeVisible();
    await expect(page.getByText('u/support_bot_beta')).toBeVisible();
    await expect(page.getByText('u/community_manager_charlie')).toBeVisible();
  });

  test('rep roles are displayed', async ({ page }) => {
    // Fixture: alice=lead, beta=verified, charlie=verified
    // Scope to the roster list to avoid the leaderboard section header "Verified roster"
    const roster = page.locator('ul.divide-y').last();
    await expect(roster.getByText('lead')).toBeVisible();
    await expect(roster.getByText('verified')).toHaveCount(2);
  });

  test('verified dates are displayed for reps', async ({ page }) => {
    // Dates are rendered as relative time — check a <time> element is present
    const roster = page.locator('ul.divide-y').last();
    const listItems = roster.locator('li');
    await expect(listItems).toHaveCount(3);
    // Each list item should have a <time> element
    await expect(listItems.first().locator('time')).toBeVisible();
  });

  test('rep list is inside a bordered container', async ({ page }) => {
    const list = page.locator('ul.divide-y');
    await expect(list).toBeVisible();
  });
});
