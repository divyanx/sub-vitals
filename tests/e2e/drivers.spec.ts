/**
 * drivers.spec.ts
 *
 * Tests the Contact Drivers tab — bar list, click-through to per-driver post
 * list, status filter, "Mark resolved" mutation, and the ?driver= deep-link.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Drivers tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('bar list renders all 6 drivers from taxonomy fixture', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    // Wait for data — use role button to avoid strict mode when breadcrumb has same text
    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });

    // All taxonomy labels should be present (use first() to avoid strict mode on breadcrumbs)
    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible();
    await expect(page.getByText('Praise / positive feedback')).toBeVisible();
    await expect(page.getByText('Feature request')).toBeVisible();
    await expect(page.getByText('Billing / pricing')).toBeVisible();
    await expect(page.getByText('Onboarding / setup')).toBeVisible();
    // Crash (child of bug) should also appear as its own bar entry
    await expect(page.getByRole('button', { name: /Crash/i }).first()).toBeVisible();
  });

  test('clicking "praise" bar expands post list with correct posts', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    await expect(page.getByText('Praise / positive feedback')).toBeVisible({ timeout: 10000 });

    // Click praise bar button
    await page.getByRole('button', { name: /Praise \/ positive feedback/i }).click();

    // Fixture has "responded" post for praise driver — but default filter is "open"
    // Praise fixture has 1 open post: "Customer support team is absolutely top notch"
    await expect(page.getByText('Customer support team is absolutely top notch')).toBeVisible({
      timeout: 8000,
    });
  });

  test('status filter chips appear in driver post panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    await expect(page.getByText('Praise / positive feedback')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Praise \/ positive feedback/i }).click();

    // Filter chips render inside the expanded panel.
    // "Responded" only appears in the driver post panel (not inbox filter bar).
    await expect(page.getByRole('button', { name: 'Responded' })).toBeVisible({ timeout: 6000 });
    // Use exact match to avoid matching "Mark resolved" action buttons that also appear in the list
    await expect(page.getByRole('button', { name: 'Resolved', exact: true })).toBeVisible();
  });

  test('"Show thread" in driver post list expands ThreadPanel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('button', { name: /Bug \/ broken experience/i })
      .first()
      .click();

    // Bug driver fixture has posts with "open" status — first post should appear
    await expect(page.getByText('App crashes every time I try to checkout')).toBeVisible({
      timeout: 8000,
    });

    // Click "Show thread" on first post
    const showThread = page.getByRole('button', { name: 'Show thread' }).first();
    await showThread.click();

    await expect(page.getByText(/comments processed/i)).toBeVisible({ timeout: 8000 });
  });

  test('"Mark resolved" button fires POST /status mutation', async ({ page }) => {
    let mutationBody = '';
    page.on('request', (req) => {
      if (req.url().includes('/status') && req.method() === 'POST') {
        mutationBody = req.postData() ?? '';
      }
    });

    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('button', { name: /Bug \/ broken experience/i })
      .first()
      .click();

    await expect(page.getByText('App crashes every time I try to checkout')).toBeVisible({
      timeout: 8000,
    });

    const markResolved = page.getByRole('button', { name: 'Mark resolved' }).first();
    await markResolved.click();
    await page.waitForTimeout(600);

    expect(mutationBody).toContain('"resolved"');
  });

  test('drivers are sorted by count (bug first with highest volume)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });

    // Get all driver bar buttons to check order
    const driverBtns = page.locator('ul > li > button');
    const firstDriverText = await driverBtns.first().textContent();
    // Bug has highest volume across 30 days — should be first
    expect(firstDriverText).toContain('Bug');
  });
});

test.describe('Drivers tab — taxonomy config panel', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('config toggle opens the taxonomy editor panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible();
  });

  test('child driver row is indented relative to parent', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 5000 });

    // bug.crash should be indented — it has a "child of bug" badge visible
    await expect(page.getByText('child of')).toBeVisible({ timeout: 4000 });
  });

  test('+ Add sub-driver button creates a new child row', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 6000 });

    const countBefore = await page.getByTestId('taxonomy-driver-list').locator('> div').count();

    // Click + Add sub-driver on the first visible add-sub-driver button
    await page.getByText('+ Add sub-driver').first().click();

    const countAfter = await page.getByTestId('taxonomy-driver-list').locator('> div').count();
    expect(countAfter).toBe(countBefore + 1);
  });

  test('Move to... dropdown appears and lists possible targets', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 6000 });

    // Click the first "Move to…" button
    await page.getByText('Move to…').first().click();
    // The dropdown should show "(Root — no parent)" option
    await expect(page.getByText('(Root')).toBeVisible({ timeout: 3000 });
  });

  test('"Include sub-drivers" toggle appears for driver with children', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    // Open the Bug driver (which has bug.crash as child in the fixture)
    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    await page
      .getByRole('button', { name: /Bug \/ broken experience/i })
      .first()
      .click();

    // The include-sub-drivers toggle should be visible in the post panel
    await expect(page.getByTestId('include-sub-drivers-toggle')).toBeVisible({ timeout: 6000 });
  });
});

test.describe('Drivers tab — breadcrumb labels', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('child driver label shows as breadcrumb in bar list', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Contact drivers' }).click();

    // The taxonomy fixture now has bug.crash — its bar entry should show breadcrumb
    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    // bug.crash breadcrumb: "Bug / broken experience › Crash"
    await expect(page.getByText(/Crash/)).toBeVisible({ timeout: 5000 });
  });
});
