/**
 * sentiment.spec.ts
 *
 * Tests the Sentiment tab — 3 total cards and the recharts area chart.
 * Verifies totals computed from the 31-day rollup fixture are correct.
 */

import { expect, test } from '@playwright/test';
import sentimentFixture from './fixtures/sentiment-rollup.json' with { type: 'json' };
import { setupMocks } from './mock-api.ts';

// Pre-compute expected totals from fixture so the test is authoritative
const TOTALS = sentimentFixture.series.reduce(
  (acc, day) => {
    acc.positive += day.positive;
    acc.neutral += day.neutral;
    acc.negative += day.negative;
    return acc;
  },
  { positive: 0, neutral: 0, negative: 0 },
);

test.describe('Sentiment tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Sentiment' }).click();
    // Wait for data — cards should appear
    await expect(page.getByText('Positive')).toBeVisible({ timeout: 10000 });
  });

  test('three summary cards render (Positive, Neutral, Negative)', async ({ page }) => {
    await expect(page.getByText('Positive')).toBeVisible();
    await expect(page.getByText('Neutral')).toBeVisible();
    await expect(page.getByText('Negative')).toBeVisible();
  });

  test('card totals match fixture-computed values', async ({ page }) => {
    // Each value is displayed in a <div class="...text-2xl..."> inside an <article>
    const cards = page.getByRole('article');
    const texts = await cards.allTextContents();

    expect(texts.some((t) => t.includes(String(TOTALS.positive)))).toBe(true);
    expect(texts.some((t) => t.includes(String(TOTALS.neutral)))).toBe(true);
    expect(texts.some((t) => t.includes(String(TOTALS.negative)))).toBe(true);
  });

  test('recharts SVG area chart is present', async ({ page }) => {
    // Recharts renders an SVG element inside the chart container
    const svg = page.locator('.recharts-wrapper svg');
    await expect(svg).toBeVisible({ timeout: 8000 });
  });

  test('chart section heading is visible', async ({ page }) => {
    await expect(page.getByText(/Daily sentiment volume/i)).toBeVisible();
  });

  test('all 3 area paths are rendered (positive, neutral, negative)', async ({ page }) => {
    // Recharts stacked AreaChart renders paths for each dataKey
    const paths = page.locator('.recharts-area-area');
    // Expect at least 3 area fill paths
    const count = await paths.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
