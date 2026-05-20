/**
 * drivers.spec.ts
 *
 * Tests the Contact Drivers section — bar list, click-through to per-driver post
 * list, status filter, "Mark resolved" mutation, and the ?driver= deep-link.
 *
 * In IA reset v2, Drivers is an inline section within the Posts tab.
 * The Watch tab no longer exists; navigation goes to Posts directly.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

/** Navigate to the Posts tab and scroll to the Drivers inline section. */
async function goToDrivers(page: import('@playwright/test').Page) {
  await page.goto('/');
  // Posts tab is default; drivers inline section is already in view
  await expect(page.getByRole('tab', { name: 'Posts' })).toBeVisible({ timeout: 5000 });
}

test.describe('Drivers tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
  });

  test('bar list renders all 6 drivers from taxonomy fixture', async ({ page }) => {
    await goToDrivers(page);

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
    await goToDrivers(page);

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
    await goToDrivers(page);

    await expect(page.getByText('Praise / positive feedback')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Praise \/ positive feedback/i }).click();

    // Filter chips render inside the expanded panel.
    // "Responded" only appears in the driver post panel (not inbox filter bar).
    await expect(page.getByRole('button', { name: 'Responded' })).toBeVisible({ timeout: 6000 });
    // Use exact match to avoid matching "Mark resolved" action buttons that also appear in the list
    await expect(page.getByRole('button', { name: 'Resolved', exact: true })).toBeVisible();
  });

  test('"Show thread" in driver post list expands ThreadPanel', async ({ page }) => {
    await goToDrivers(page);

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

    await goToDrivers(page);
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
    await goToDrivers(page);

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
    // In IA v2 the drivers-config-toggle lives in the Posts tab inline section
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(/contact driver taxonomy/i)).toBeVisible();
  });

  test('child driver row is indented relative to parent', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 5000 });

    // bug.crash should be indented — it has a "child of bug" badge visible
    await expect(page.getByText('child of')).toBeVisible({ timeout: 4000 });
  });

  test('+ Add sub-driver button creates a new child row', async ({ page }) => {
    await page.goto('/');
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
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 6000 });

    // Click the first "Move to…" button
    await page.getByText('Move to…').first().click();
    // The dropdown should show "Move to top level" as first action
    await expect(page.getByText('Move to top level')).toBeVisible({ timeout: 3000 });
  });

  test('"Include sub-drivers" toggle appears for driver with children', async ({ page }) => {
    await page.goto('/');

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

    // The taxonomy fixture now has bug.crash — its bar entry should show breadcrumb
    await expect(
      page.getByRole('button', { name: /Bug \/ broken experience/i }).first(),
    ).toBeVisible({ timeout: 10000 });
    // bug.crash breadcrumb: "Bug / broken experience › Crash"
    await expect(page.getByText(/Crash/)).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Sprint 13 — new e2e tests for polished hierarchical drivers view
// ---------------------------------------------------------------------------

test.describe('Drivers taxonomy config — Sprint 13 polish', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByTestId('drivers-config-toggle').click();
    await expect(page.getByTestId('drivers-config-panel')).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId('taxonomy-driver-list')).toBeVisible({ timeout: 5000 });
  });

  test('chevron collapse hides children of that parent only', async ({ page }) => {
    // The fixture has bug.crash as a child of bug — find the bug row chevron
    // First count visible rows
    const listBefore = page.getByTestId('taxonomy-driver-list').locator('> div:visible');
    const countBefore = await listBefore.count();
    expect(countBefore).toBeGreaterThan(1);

    // Find the first chevron button (▼) belonging to a row that has children
    const chevrons = page.getByRole('button', { name: 'Collapse children' });
    await expect(chevrons.first()).toBeVisible({ timeout: 4000 });

    // Click to collapse
    await chevrons.first().click();

    // After collapse, fewer rows should be visible
    const countAfter = await page
      .getByTestId('taxonomy-driver-list')
      .locator('> div:visible')
      .count();
    expect(countAfter).toBeLessThan(countBefore);

    // Clicking again (now "Expand children") should restore the count
    await page.getByRole('button', { name: 'Expand children' }).first().click();
    const countRestored = await page
      .getByTestId('taxonomy-driver-list')
      .locator('> div:visible')
      .count();
    expect(countRestored).toBe(countBefore);
  });

  test('compact mode toggle switches all rows to compact summary view', async ({ page }) => {
    const toggle = page.getByTestId('compact-mode-toggle');
    await expect(toggle).toBeVisible({ timeout: 4000 });

    // Default: full editor rows are visible (no compact-row test ids)
    const compactRowsBefore = await page.getByTestId(/driver-compact-row-/).count();
    // In expanded mode there should be no compact rows
    expect(compactRowsBefore).toBe(0);

    // Enable compact mode
    await toggle.click();

    // Now compact rows should appear
    const compactRowsAfter = await page.getByTestId(/driver-compact-row-/).count();
    expect(compactRowsAfter).toBeGreaterThan(0);

    // Toggle back — compact rows should disappear
    await toggle.click();
    const compactRowsFinal = await page.getByTestId(/driver-compact-row-/).count();
    expect(compactRowsFinal).toBe(0);
  });

  test('color preset click in popover updates the swatch color', async ({ page }) => {
    // Open first color swatch popover
    const swatchBtn = page.getByTestId('color-swatch-btn').first();
    await expect(swatchBtn).toBeVisible({ timeout: 4000 });
    await swatchBtn.click();

    // Popover should be visible
    await expect(page.getByTestId('color-picker-popover')).toBeVisible({ timeout: 3000 });

    // Click the sky-500 preset (#0ea5e9)
    await page.getByTestId('color-preset-sky-500').click();

    // Popover should close
    await expect(page.getByTestId('color-picker-popover')).not.toBeVisible({ timeout: 2000 });

    // The swatch button should now have the sky-500 background color
    const bgColor = await swatchBtn.evaluate((el) => (el as HTMLElement).style.backgroundColor);
    // bg color is rendered as rgb(14, 165, 233) for #0ea5e9
    expect(bgColor).toContain('14');
  });

  test('sticky breadcrumb appears when a row receives focus', async ({ page }) => {
    // Breadcrumb should not be visible before any row is focused
    await expect(page.getByTestId('sticky-breadcrumb')).not.toBeVisible();

    // Focus an input inside the first driver row
    const firstInput = page
      .getByTestId('taxonomy-driver-list')
      .locator('input[placeholder="bug"]')
      .first();
    await firstInput.focus();

    // Sticky breadcrumb should now appear
    await expect(page.getByTestId('sticky-breadcrumb')).toBeVisible({ timeout: 3000 });
  });
});
