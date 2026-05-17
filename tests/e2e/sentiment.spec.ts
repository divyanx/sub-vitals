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
    // Each card is now a <button> with data-testid
    const positiveCard = page.getByTestId('sentiment-card-positive');
    const neutralCard = page.getByTestId('sentiment-card-neutral');
    const negativeCard = page.getByTestId('sentiment-card-negative');

    await expect(positiveCard).toContainText(String(TOTALS.positive));
    await expect(neutralCard).toContainText(String(TOTALS.neutral));
    await expect(negativeCard).toContainText(String(TOTALS.negative));
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
    // SentimentChart is lazy-loaded via React.lazy → wait for chunk + render
    await expect(page.locator('.recharts-wrapper')).toBeVisible({ timeout: 15000 });
    const paths = page.locator('.recharts-area-area');
    await expect(paths.first()).toBeVisible({ timeout: 5000 });
    const count = await paths.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('clicking the Negative card expands the contributing posts list', async ({ page }) => {
    // Click the Negative card
    await page.getByTestId('sentiment-card-negative').click();

    // The drill-through list should appear
    await expect(page.getByTestId('sentiment-posts-negative')).toBeVisible({ timeout: 8000 });

    // Both fixture posts should appear
    await expect(page.getByText('App keeps crashing every time I open it')).toBeVisible();
    await expect(page.getByText('Terrible customer service, never using again')).toBeVisible();
  });

  test('clicking Negative card a second time collapses the list', async ({ page }) => {
    // Open
    await page.getByTestId('sentiment-card-negative').click();
    await expect(page.getByTestId('sentiment-posts-negative')).toBeVisible({ timeout: 8000 });

    // Close
    await page.getByTestId('sentiment-card-negative').click();
    await expect(page.getByTestId('sentiment-posts-negative')).not.toBeVisible();
  });

  test('clicking a different card closes the previously open one', async ({ page }) => {
    // Open Negative
    await page.getByTestId('sentiment-card-negative').click();
    await expect(page.getByTestId('sentiment-posts-negative')).toBeVisible({ timeout: 8000 });

    // Click Positive — Negative list should close
    await page.getByTestId('sentiment-card-positive').click();
    await expect(page.getByTestId('sentiment-posts-negative')).not.toBeVisible();
  });

  test('Positive posts list shows empty state when no posts', async ({ page }) => {
    // positive label returns 0 posts per mock
    await page.getByTestId('sentiment-card-positive').click();
    await expect(page.getByText(/no positive posts in the last 30 days/i)).toBeVisible({
      timeout: 8000,
    });
  });
});
