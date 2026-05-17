/**
 * a11y.spec.ts — Automated accessibility audit for each major dashboard tab.
 *
 * Uses @axe-core/playwright to run axe-core against the live DOM and assert
 * zero serious/critical violations. Failures here mean a real user with
 * assistive technology is blocked — treat as P0.
 *
 * Only serious + critical impact violations are asserted; moderate/minor
 * violations are logged for awareness but do not fail the suite.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Run axe against the current page, assert no serious/critical violations.
 * Returns the full result set so tests can add extra assertions if needed.
 */
async function assertNoSeriousViolations(page: import('@playwright/test').Page, context = 'page') {
  const results = await new AxeBuilder({ page })
    // Exclude known third-party iframes that we don't control
    .exclude('iframe')
    .analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );

  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `  [${v.impact}] ${v.id}: ${v.description}\n    ${v.helpUrl}`)
      .join('\n');
    console.error(`[a11y] ${blocking.length} blocking violation(s) on ${context}:\n${summary}`);
  }

  // Log moderate/minor so devs can address them proactively
  const advisory = results.violations.filter(
    (v) => v.impact === 'moderate' || v.impact === 'minor',
  );
  if (advisory.length > 0) {
    console.warn(
      `[a11y] ${advisory.length} advisory violation(s) on ${context} (not blocking):`,
      advisory.map((v) => `${v.id}: ${v.description}`),
    );
  }

  expect(
    blocking,
    `Expected zero serious/critical a11y violations on ${context} but found ${blocking.length}`,
  ).toEqual([]);

  return results;
}

// ---------------------------------------------------------------------------
// Tab: Inbox (default)
// ---------------------------------------------------------------------------

test.describe('a11y — Inbox tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Wait for content to fully render before axe runs
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Inbox tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Overview / Pulse
// ---------------------------------------------------------------------------

test.describe('a11y — Overview tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=overview');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Overview tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Contact Drivers
// ---------------------------------------------------------------------------

test.describe('a11y — Contact Drivers tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=drivers');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Drivers tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Sentiment
// ---------------------------------------------------------------------------

test.describe('a11y — Sentiment tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=sentiment');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Sentiment tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Agents
// ---------------------------------------------------------------------------

test.describe('a11y — Agents tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=agents');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Agents tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Settings
// ---------------------------------------------------------------------------

test.describe('a11y — Settings tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=settings');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Settings tab');
  });
});
