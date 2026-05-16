/**
 * Pure-logic tests around storage helpers that don't touch Redis.
 *
 * Storage functions are integration-shaped (they call redis.* singletons we
 * can't trivially mock without rewiring imports), so this file covers the
 * pure JSON/transform logic next to them.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_TAXONOMY } from '../src/shared/storage.ts';

describe('DEFAULT_TAXONOMY', () => {
  it('contains the seven Phase-1 contact-driver categories', () => {
    const ids = DEFAULT_TAXONOMY.map((t) => t.id).sort();
    expect(ids).toEqual(['billing', 'bug', 'complaint', 'feature', 'other', 'praise', 'question']);
  });

  it('every entry has a label', () => {
    for (const node of DEFAULT_TAXONOMY) {
      expect(node.label.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a #rrggbb color', () => {
    for (const node of DEFAULT_TAXONOMY) {
      expect(node.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
