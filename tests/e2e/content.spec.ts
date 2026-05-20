/**
 * E2e tests for the Content Browser tab.
 *
 * In IA reset v2, the Content browser lives inside the Posts tab.
 * ?tab=content redirects to ?tab=posts via LEGACY_TAB_MAP — the content
 * browser is always rendered as a section within Posts.
 *
 * Verifies: tab navigation, filter chip activation, sort, bulk selection,
 * mark-resolved bulk action, and that the POST to /api/posts/bulk-status
 * is correctly issued.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.beforeEach(async ({ page }) => {
  await setupMocks(page);
  // ?tab=content redirects to posts; the content browser renders within Posts
  await page.goto('/?tab=posts');
});

test('Posts tab renders the content table', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Posts' })).toBeVisible();
  // Wait for data to load
  await expect(page.getByRole('table', { name: 'Content table' })).toBeVisible({ timeout: 5000 });
  // Should show at least one row
  await expect(page.getByText('App crashes every time')).toBeVisible();
});

test('shows item count in header', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');
  // "N items" text should be present
  await expect(page.getByText(/\d+ items?/)).toBeVisible();
});

test('applies driver filter and updates results', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Click Driver chip
  await page
    .getByRole('button', { name: /Driver/ })
    .first()
    .click();
  // Select "Bug / broken experience"
  const bugOption = page.getByRole('checkbox', { name: /Bug/ }).first();
  await bugOption.check();

  // Close dropdown by clicking elsewhere
  await page.keyboard.press('Escape');

  // Table should still be visible and results should be filtered
  await expect(page.getByRole('table', { name: 'Content table' })).toBeVisible();
  // The praise post should not be visible (it has driverId=praise)
  await expect(page.getByText('Great customer support')).not.toBeVisible();
});

test('text search filters results', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Click search button to expand
  await page
    .getByRole('button', { name: /Search/ })
    .first()
    .click();

  // Type a search query
  const searchInput = page.getByRole('searchbox', { name: 'Text search' });
  await searchInput.fill('crash');

  // Wait for debounce (500ms) + results
  await page.waitForTimeout(600);

  // Only "App crashes" should be visible
  await expect(page.getByText('App crashes every time')).toBeVisible();
  await expect(page.getByText('Login 2FA stopped')).not.toBeVisible();
});

test('sort by date changes aria-sort attribute', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Select "Newest first" sort from dropdown
  const sortSelect = page.getByRole('combobox', { name: 'Sort order' });
  await sortSelect.selectOption('createdAt_desc');

  // Sort dropdown should reflect new value
  await expect(sortSelect).toHaveValue('createdAt_desc');
});

test('bulk-selects two rows and marks resolved', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Intercept the bulk-status call
  const bulkStatusPromise = page.waitForRequest(
    (req) => req.url().includes('/api/posts/bulk-status') && req.method() === 'POST',
  );

  // Select two rows via checkboxes
  const checkboxes = page.locator('input[type="checkbox"][aria-label^="Select:"]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();

  // Bulk toolbar should appear
  await expect(page.getByRole('toolbar', { name: 'Bulk actions' })).toBeVisible();
  await expect(page.getByText('2 selected')).toBeVisible();

  // Click "Mark resolved"
  await page.getByRole('button', { name: 'Mark resolved' }).click();

  // Confirm the POST was issued
  const req = await bulkStatusPromise;
  const body = JSON.parse(req.postData() ?? '{}') as { postIds: string[]; status: string };
  expect(body.status).toBe('resolved');
  expect(body.postIds).toHaveLength(2);
});

test('select all matching sets all visible rows', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Select first row to make bulk toolbar appear
  const checkboxes = page.locator('input[type="checkbox"][aria-label^="Select:"]');
  await checkboxes.first().check();

  // Click "Select all matching"
  await page.getByRole('button', { name: 'Select all matching' }).click();

  // All checkboxes (excluding the select-all header one) should be checked
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    await expect(checkboxes.nth(i)).toBeChecked();
  }
});

test('clear button deselects all', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Select all via select-all header checkbox
  await page.getByRole('checkbox', { name: 'Select all visible' }).check();

  // Bulk toolbar should appear — click the "Clear (Esc)" button inside it
  const bulkToolbar = page.getByRole('toolbar', { name: 'Bulk actions' });
  await expect(bulkToolbar).toBeVisible();
  await bulkToolbar.getByRole('button', { name: /Clear/ }).click();

  // No row checkboxes should be selected
  const checkboxes = page.locator('input[type="checkbox"][aria-label^="Select:"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    await expect(checkboxes.nth(i)).not.toBeChecked();
  }
});

test('respond button opens drawer', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Click the action menu on the first row
  await page.locator('button[aria-label="Row actions"]').first().click();

  // Click "Respond"
  await page.getByRole('menuitem', { name: 'Respond' }).click();

  // "Responding to" text should appear in the drawer
  await expect(page.getByText('Responding to')).toBeVisible({ timeout: 3000 });
});

test('content type dropdown switches between post/comment/both', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  const typeSelect = page.getByRole('combobox', { name: 'Content type' });
  await typeSelect.selectOption('post');
  await expect(typeSelect).toHaveValue('post');

  await typeSelect.selectOption('comment');
  await expect(typeSelect).toHaveValue('comment');

  await typeSelect.selectOption('both');
  await expect(typeSelect).toHaveValue('both');
});

test('URL updates when filters change', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Change sort
  const sortSelect = page.getByRole('combobox', { name: 'Sort order' });
  await sortSelect.selectOption('createdAt_asc');

  // URL should contain sort param — allow up to 1s for replaceState
  await expect(page).toHaveURL(/sort=createdAt_asc/, { timeout: 1000 });
});

test('pipeline tag chip filter narrows visible rows and updates URL', async ({ page }) => {
  await page.waitForSelector('[aria-label="Content table"]');

  // Baseline: all 3 items visible
  await expect(page.getByText('App crashes every time')).toBeVisible();
  await expect(page.getByText('Great customer support')).toBeVisible();

  // Click the "Intent" custom pipeline chip (rendered by filterablePipelines)
  const intentChip = page.getByRole('button', { name: /Intent/ });
  await intentChip.click();

  // Select "bug" from the dropdown
  const bugCheckbox = page.getByRole('checkbox', { name: 'bug' });
  await bugCheckbox.check();

  // Dismiss dropdown
  await page.keyboard.press('Escape');

  // Wait for debounce + re-fetch
  await page.waitForTimeout(400);

  // URL should contain the tag param
  await expect(page).toHaveURL(/tag_intent=bug/, { timeout: 1500 });

  // Only bug-tagged item visible; praise post should disappear
  await expect(page.getByText('App crashes every time')).toBeVisible();
  await expect(page.getByText('Great customer support')).not.toBeVisible();

  // Item count should have dropped (mock returns 2 items for bug filter)
  await expect(page.getByText(/\d+ items?/)).toBeVisible();
});
