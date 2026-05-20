/**
 * a11y.spec.ts — Automated accessibility audit for each major dashboard tab.
 *
 * Uses @axe-core/playwright to run axe-core against the live DOM and assert
 * zero serious/critical violations. Failures here mean a real user with
 * assistive technology is blocked — treat as P0.
 *
 * Only serious + critical impact violations are asserted; moderate/minor
 * violations are logged for awareness but do not fail the suite.
 *
 * Updated for IA reset v2: primary tabs are Posts, Pipelines, Catalogue,
 * Rules, Settings. Legacy URL params redirect automatically.
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
// Tab: Posts (default)
// ---------------------------------------------------------------------------

test.describe('a11y — Posts tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    // Wait for content to fully render before axe runs
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Posts tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Pipelines
// ---------------------------------------------------------------------------

test.describe('a11y — Pipelines tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=pipelines');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Pipelines tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Catalogue
// ---------------------------------------------------------------------------

test.describe('a11y — Catalogue tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=catalogue');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Catalogue tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Rules
// ---------------------------------------------------------------------------

test.describe('a11y — Rules tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=rules');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Rules tab');
  });
});

// ---------------------------------------------------------------------------
// Tab: Settings (default section = brand)
// ---------------------------------------------------------------------------

test.describe('a11y — Settings tab', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/?tab=settings');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Settings tab');
  });
});

// ---------------------------------------------------------------------------
// Settings — Team section (includes Agents)
// ---------------------------------------------------------------------------

test.describe('a11y — Settings Team section', () => {
  test('no serious/critical a11y violations', async ({ page }) => {
    await setupMocks(page);
    // Legacy ?tab=team redirects to settings&section=team
    await page.goto('/?tab=settings&section=team');
    await page.waitForTimeout(1500);
    await assertNoSeriousViolations(page, 'Settings Team section');
  });
});
