import { describe, expect, it } from 'vitest';
import { suggestDriver } from '../src/modules/contact-drivers/index.ts';
import { DEFAULT_TAXONOMY } from '../src/shared/storage.ts';

describe('suggestDriver', () => {
  it('returns null when no keyword matches', () => {
    expect(suggestDriver('hello world this is a generic post', DEFAULT_TAXONOMY)).toBeNull();
  });

  it('returns null when match is below confidence threshold', () => {
    // 'bug' alone = 1 hit / 3 = 0.33 → below 0.34 threshold
    expect(suggestDriver('weird bug', DEFAULT_TAXONOMY)).toBeNull();
  });

  it('detects billing keywords', () => {
    const r = suggestDriver('how do i get a refund for my subscription', DEFAULT_TAXONOMY);
    expect(r?.id).toBe('billing');
    expect(r?.confidence).toBeGreaterThanOrEqual(0.34);
  });

  it('detects feature requests', () => {
    const r = suggestDriver(
      'feature request: please add a dark mode, would be nice',
      DEFAULT_TAXONOMY,
    );
    expect(r?.id).toBe('feature');
  });

  it('detects complaints', () => {
    const r = suggestDriver('this is terrible, horrible, just awful', DEFAULT_TAXONOMY);
    expect(r?.id).toBe('complaint');
  });

  it('prefers the higher-confidence match when multiple categories hit', () => {
    // refund (billing 1) vs feature-request would-be-nice please-add (feature 3)
    const r = suggestDriver(
      'feature request: please add refund support, would be nice',
      DEFAULT_TAXONOMY,
    );
    expect(r?.id).toBe('feature');
  });

  it('respects custom taxonomy — ignores keywords for unconfigured drivers', () => {
    const customTax = [
      { id: 'billing', label: 'Billing' },
      { id: 'other', label: 'Other' },
    ];
    // 'bug' keyword exists but 'bug' is not in this taxonomy — should fall through
    const r = suggestDriver('this bug is broken broken broken broken', customTax);
    expect(r).toBeNull(); // 'bug' driver not in taxonomy
  });

  it('caps confidence at 1.0', () => {
    const r = suggestDriver(
      'amazing love this fantastic awesome best ever love this fantastic',
      DEFAULT_TAXONOMY,
    );
    if (r) expect(r.confidence).toBeLessThanOrEqual(1);
  });
});
