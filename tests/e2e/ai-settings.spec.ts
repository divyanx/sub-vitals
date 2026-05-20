/**
 * E2E tests for Settings → AI section.
 *
 * Covers: dropdown renders, model switch triggers validation,
 * validation indicator displays, fallback alert is shown when active.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

async function openAISection(page: import('@playwright/test').Page) {
  await setupMocks(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: 'AI' }).click();
  // Wait for the AI section to render.
  await expect(page.getByText(/openrouter model/i).or(page.getByText(/ai model/i))).toBeVisible({
    timeout: 8000,
  });
}

test.describe('Settings → AI section', () => {
  test('renders model dropdown with curated options', async ({ page }) => {
    await openAISection(page);
    const dropdown = page.getByTestId('model-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 6000 });

    // Should have at least the three mocked catalog entries as options.
    const options = await dropdown.locator('option').allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(3);
    expect(options.some((o) => /claude haiku/i.test(o))).toBe(true);
  });

  test('switching model in dropdown triggers validation indicator', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'AI' }).click();

    const dropdown = page.getByTestId('model-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 8000 });

    // Select a different model to trigger validation.
    await dropdown.selectOption('openai/gpt-5-mini');

    // The validation result should eventually appear.
    await expect(page.getByTestId('validation-result')).toBeVisible({ timeout: 6000 });
  });

  test('validation result shows green checkmark on success', async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'AI' }).click();

    const dropdown = page.getByTestId('model-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 8000 });
    await dropdown.selectOption('openai/gpt-5-mini');

    const result = page.getByTestId('validation-result');
    await expect(result).toBeVisible({ timeout: 6000 });
    // Green validation: should contain the checkmark.
    await expect(result).toContainText('✓');
  });

  test('fallback alert is shown when fallback is active', async ({ page }) => {
    // Override the /api/ai/status mock to return fallback: true.
    await page.route('**/api/ai/status', (route) => {
      return route.fulfill({
        json: {
          effectiveModel: 'anthropic/claude-haiku-4.5',
          isFallback: true,
          originalSlug: 'openai/gpt-5',
          defaultModel: 'anthropic/claude-haiku-4.5',
          catalog: [
            {
              slug: 'anthropic/claude-haiku-4.5',
              label: 'Claude Haiku 4.5',
              provider: 'anthropic',
              tier: 'recommended',
              pricePer1kTaggingCalls: 0.00015,
              supportsStructuredOutput: true,
            },
          ],
        },
      });
    });
    await setupMocks(page);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('menuitem', { name: 'AI' }).click();

    await expect(page.getByTestId('fallback-alert')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('fallback-alert')).toContainText('openai/gpt-5');
  });
});
