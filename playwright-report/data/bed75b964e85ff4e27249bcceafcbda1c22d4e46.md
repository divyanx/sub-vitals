# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: export.spec.ts >> Export tab >> "Download recent 1000 posts" link has correct href
- Location: tests/e2e/export.spec.ts:35:3

# Error details

```
Test timeout of 30000ms exceeded while running "beforeEach" hook.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Export' })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - heading "RedLattice" [level=1] [ref=e7]
      - generic [ref=e8]: analytics
  - navigation [ref=e9]:
    - tablist "Dashboard tabs" [ref=e10]:
      - tab "Inbox" [selected] [ref=e11]
      - tab "Pulse" [ref=e12]
      - tab "Contact drivers" [ref=e13]
      - tab "Sentiment" [ref=e14]
      - tab "Incidents" [ref=e15]
      - tab "Themes" [ref=e16]
      - tab "Agents" [ref=e17]
      - tab "Export" [ref=e18]
      - tab "Audit" [ref=e19]
      - tab "Settings" [ref=e20]
  - main [ref=e21]:
    - generic [ref=e22]:
      - generic [ref=e23]:
        - generic [ref=e24]: "Views:"
        - button "+ Save current" [ref=e25]
      - generic [ref=e26]:
        - generic [ref=e27]:
          - heading "Triage inbox" [level=2] [ref=e28]
          - paragraph [ref=e29]: Auto-prioritized by driver severity × sentiment × thread heat × age. Top of list is what should get your attention first.
        - generic [ref=e30]:
          - button "Open" [ref=e31]
          - button "In progress" [ref=e32]
          - button "All" [ref=e33]
      - generic [ref=e34]:
        - checkbox "Select all" [ref=e35]
        - generic [ref=e36]: Select all
      - list [ref=e37]:
        - listitem [ref=e38]:
          - generic [ref=e39]:
            - generic [ref=e40]:
              - 'checkbox "Select post: App crashes every time I try to checkout" [ref=e41]'
              - generic [ref=e42]: "#1"
              - generic [ref=e43]: "1.12"
            - generic [ref=e44]:
              - link "App crashes every time I try to checkout" [ref=e45] [cursor=pointer]:
                - /url: https://reddit.com/r/brand/comments/post_001
              - generic [ref=e46]:
                - button "u/frustrated_frank" [ref=e47]
                - generic [ref=e48]: ·
                - generic [ref=e49]: 365d ago
                - generic [ref=e50]: ·
                - generic [ref=e51]: bug · ai
                - generic [ref=e52]: ·
                - generic [ref=e53]: negative -0.72 · ai
                - generic [ref=e54]: ·
                - generic [ref=e55]: open
              - generic [ref=e56]: "\"User describes a repeatable crash during checkout flow\""
              - generic [ref=e57]:
                - button "✓ Resolve" [ref=e58]
                - button "Take ownership" [ref=e59]
                - button "View thread" [ref=e60]
                - button "✨ Draft reply" [ref=e61]
                - link "↗ Open on Reddit" [ref=e62] [cursor=pointer]:
                  - /url: https://reddit.com/r/brand/comments/post_001
        - listitem [ref=e63]:
          - generic [ref=e64]:
            - generic [ref=e65]:
              - 'checkbox "Select post: Login 2FA stopped working after the update" [ref=e66]'
              - generic [ref=e67]: "#2"
              - generic [ref=e68]: "0.98"
            - generic [ref=e69]:
              - link "Login 2FA stopped working after the update" [ref=e70] [cursor=pointer]:
                - /url: https://reddit.com/r/brand/comments/post_005
              - generic [ref=e71]:
                - button "u/locked_out_larry" [ref=e72]
                - generic [ref=e73]: ·
                - generic [ref=e74]: 365d ago
                - generic [ref=e75]: ·
                - generic [ref=e76]: bug · ai
                - generic [ref=e77]: ·
                - generic [ref=e78]: negative -0.61 · ai
                - generic [ref=e79]: ·
                - generic [ref=e80]: open
              - generic [ref=e81]: "\"Authentication regression following product update\""
              - generic [ref=e82]:
                - button "✓ Resolve" [ref=e83]
                - button "Take ownership" [ref=e84]
                - button "View thread" [ref=e85]
                - button "✨ Draft reply" [ref=e86]
                - link "↗ Open on Reddit" [ref=e87] [cursor=pointer]:
                  - /url: https://reddit.com/r/brand/comments/post_005
        - listitem [ref=e88]:
          - generic [ref=e89]:
            - generic [ref=e90]:
              - 'checkbox "Select post: Feature request: dark mode for mobile" [ref=e91]'
              - generic [ref=e92]: "#3"
              - generic [ref=e93]: "0.31"
            - generic [ref=e94]:
              - 'link "Feature request: dark mode for mobile" [ref=e95] [cursor=pointer]':
                - /url: https://reddit.com/r/brand/comments/post_004
              - generic [ref=e96]:
                - button "u/devrel_diana" [ref=e97]
                - generic [ref=e98]: ·
                - generic [ref=e99]: 365d ago
                - generic [ref=e100]: ·
                - generic [ref=e101]: feature-request · ai
                - generic [ref=e102]: ·
                - generic [ref=e103]: neutral 0.02
                - generic [ref=e104]: ·
                - generic [ref=e105]: open
              - generic [ref=e106]: "\"User is requesting a specific UI feature\""
              - generic [ref=e107]:
                - button "✓ Resolve" [ref=e108]
                - button "Take ownership" [ref=e109]
                - button "View thread" [ref=e110]
                - button "✨ Draft reply" [ref=e111]
                - link "↗ Open on Reddit" [ref=e112] [cursor=pointer]:
                  - /url: https://reddit.com/r/brand/comments/post_004
```

# Test source

```ts
  1  | /**
  2  |  * export.spec.ts
  3  |  *
  4  |  * Tests the Export tab — section headings, download link buttons with correct
  5  |  * hrefs, REST endpoint documentation list.
  6  |  */
  7  | 
  8  | import { expect, test } from '@playwright/test';
  9  | import { setupMocks } from './mock-api.ts';
  10 | 
  11 | test.describe('Export tab', () => {
  12 |   test.beforeEach(async ({ page }) => {
  13 |     await setupMocks(page);
  14 |     await page.goto('/');
> 15 |     await page.getByRole('tab', { name: 'Export' }).click();
     |                                                        ^ Error: locator.click: Test timeout of 30000ms exceeded.
  16 |     // Wait for section heading
  17 |     await expect(page.getByText('Data export')).toBeVisible({ timeout: 8000 });
  18 |   });
  19 | 
  20 |   test('"Data export" section heading is visible', async ({ page }) => {
  21 |     await expect(page.getByText('Data export')).toBeVisible();
  22 |   });
  23 | 
  24 |   test('"REST endpoints" section heading is visible', async ({ page }) => {
  25 |     await expect(page.getByText('REST endpoints')).toBeVisible();
  26 |   });
  27 | 
  28 |   test('"Download recent 500 posts" link has correct href', async ({ page }) => {
  29 |     const link500 = page.getByRole('link', { name: /500 posts/i });
  30 |     await expect(link500).toBeVisible();
  31 |     const href = await link500.getAttribute('href');
  32 |     expect(href).toBe('/api/export/posts.csv?limit=500');
  33 |   });
  34 | 
  35 |   test('"Download recent 1000 posts" link has correct href', async ({ page }) => {
  36 |     const link1000 = page.getByRole('link', { name: /1000 posts/i });
  37 |     await expect(link1000).toBeVisible();
  38 |     const href = await link1000.getAttribute('href');
  39 |     expect(href).toBe('/api/export/posts.csv?limit=1000');
  40 |   });
  41 | 
  42 |   test('REST endpoints documentation lists key routes', async ({ page }) => {
  43 |     await expect(page.getByText('/api/dashboard/summary')).toBeVisible();
  44 |     await expect(page.getByText('/api/drivers/taxonomy')).toBeVisible();
  45 |     await expect(page.getByText('/api/agents')).toBeVisible();
  46 |     await expect(page.getByText('/api/export/posts.csv?limit=N')).toBeVisible();
  47 |   });
  48 | 
  49 |   test('both download links have target="_top" for Reddit iframe navigation', async ({ page }) => {
  50 |     const links = page.locator('a[href*="/api/export/posts.csv"]');
  51 |     const count = await links.count();
  52 |     expect(count).toBe(2);
  53 | 
  54 |     for (let i = 0; i < count; i++) {
  55 |       const target = await links.nth(i).getAttribute('target');
  56 |       expect(target).toBe('_top');
  57 |     }
  58 |   });
  59 | });
  60 | 
```