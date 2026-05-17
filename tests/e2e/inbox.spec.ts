/**
 * inbox.spec.ts
 *
 * Tests the Inbox (Triage) tab — the default view of the dashboard.
 * Covers: queue rendering, status filter chips, thread expand, draft reply panel.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Inbox tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Wait for the triage queue to load — first post title should appear
    await expect(page.getByText('App crashes every time I try to checkout')).toBeVisible({
      timeout: 10000,
    });
  });

  test('queue renders all items from fixture', async ({ page }) => {
    // Fixture has 3 items
    const items = page.locator('ol > li');
    await expect(items).toHaveCount(3);
  });

  test('priority rank numbers are displayed (#1, #2, #3)', async ({ page }) => {
    await expect(page.getByText('#1')).toBeVisible();
    await expect(page.getByText('#2')).toBeVisible();
    await expect(page.getByText('#3')).toBeVisible();
  });

  test('status filter chips are visible (Open, In progress, All)', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'In progress' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
  });

  test('clicking "View thread" on first post expands ThreadPanel with comments', async ({
    page,
  }) => {
    const firstViewThread = page.getByRole('button', { name: 'View thread' }).first();
    await firstViewThread.click();

    // ThreadPanel should show processed comments count
    await expect(page.getByText(/comments processed/i)).toBeVisible({ timeout: 8000 });

    // Fixture has a hot thread — expect the heat badge
    await expect(page.getByText(/thread heating up/i)).toBeVisible();

    // The comment by brand_agent_alice — there's only one agent comment so this is unambiguous
    await expect(page.getByText('u/brand_agent_alice')).toBeVisible();
  });

  test('"Hide thread" toggle collapses the panel', async ({ page }) => {
    const firstViewThread = page.getByRole('button', { name: 'View thread' }).first();
    await firstViewThread.click();
    await expect(page.getByText(/comments processed/i)).toBeVisible({ timeout: 6000 });

    const hideThread = page.getByRole('button', { name: 'Hide thread' }).first();
    await hideThread.click();
    await expect(page.getByText(/comments processed/i)).not.toBeVisible();
  });

  test('"✨ Draft reply" button opens DraftReplyPanel with candidates', async ({ page }) => {
    const draftBtn = page.getByRole('button', { name: /draft reply/i }).first();
    await draftBtn.click();

    // Panel should show "AI draft replies" header
    await expect(page.getByText(/AI draft replies/i)).toBeVisible({ timeout: 10000 });

    // Fixture has 3 candidates; each has a tone badge rendered as a <span>
    // Use locator scoping to the tone badge spans (they have rounded-full border styling)
    // "empathetic" and "investigative" are unique; "direct" may match text in rationales
    await expect(page.getByText('empathetic').first()).toBeVisible();
    await expect(page.getByText('investigative').first()).toBeVisible();

    // Each candidate should have a Copy button
    const copyButtons = page.getByRole('button', { name: /^Copy$/ });
    await expect(copyButtons).toHaveCount(3);
  });

  test('"✓ Resolve" button fires status mutation request', async ({ page }) => {
    let mutationFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/status') && req.method() === 'POST') {
        mutationFired = true;
      }
    });

    const resolveBtn = page.getByRole('button', { name: /Resolve/i }).first();
    await resolveBtn.click();

    // Give the async mutation a moment
    await page.waitForTimeout(500);
    expect(mutationFired).toBe(true);
  });

  test('"Take ownership" button fires in-progress mutation', async ({ page }) => {
    let mutationFired = false;
    page.on('request', (req) => {
      if (req.url().includes('/status') && req.method() === 'POST') {
        mutationFired = true;
      }
    });

    const takeBtn = page.getByRole('button', { name: /take ownership/i }).first();
    await takeBtn.click();
    await page.waitForTimeout(500);
    expect(mutationFired).toBe(true);
  });
});
