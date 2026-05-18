/**
 * mod-actions.spec.ts
 *
 * Verifies the mod-action API endpoints respond correctly when mocked.
 * Tests that: the mock routes handle POST requests and return 200 ok,
 * matching the client api.mod.* expectations.
 */

import { expect, test } from '@playwright/test';
import { setupMocks } from './mock-api.ts';

test.describe('Mod action API mocks', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/');
  });

  test('POST /api/posts/:id/approve returns ok', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/posts/post_001/approve', { method: 'POST' });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('POST /api/posts/:id/remove returns ok', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/posts/post_001/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spam: false }),
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('POST /api/posts/:id/lock returns ok', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/posts/post_001/lock', { method: 'POST' });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('POST /api/comments/:id/approve returns ok', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/comments/comment_001/approve', { method: 'POST' });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('POST /api/comments/:id/remove with spam=true returns ok', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/comments/comment_001/remove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spam: true }),
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('POST /api/comments/:id/distinguish returns ok', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/comments/comment_001/distinguish', { method: 'POST' });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  test('POST /api/posts/:id/reply with as=app returns commentId', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const r = await fetch('/api/posts/post_001/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'Thanks for your feedback!', as: 'app' }),
      });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('commentId');
  });
});
