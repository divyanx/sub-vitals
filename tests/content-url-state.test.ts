/**
 * Unit tests for ContentBrowser URL state serialization.
 *
 * Verifies that filters <-> URLSearchParams round-trips correctly,
 * so that saved/shared URLs reproduce the same filter state.
 */

import { describe, expect, it } from 'vitest';
import {
  type ContentFilters,
  DEFAULT_FILTERS,
  filtersToSearchParams,
  searchParamsToFilters,
} from '../src/client/views/ContentBrowser.tsx';

describe('filtersToSearchParams', () => {
  it('produces empty params for default filters', () => {
    const p = filtersToSearchParams(DEFAULT_FILTERS);
    expect(p.toString()).toBe('');
  });

  it('serializes query string', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, q: 'crash' });
    expect(p.get('q')).toBe('crash');
  });

  it('serializes multiple drivers as comma-separated', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, drivers: ['bug', 'billing'] });
    expect(p.get('driver')).toBe('bug,billing');
  });

  it('serializes sentiments', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, sentiments: ['negative', 'neutral'] });
    expect(p.get('sentiment')).toBe('negative,neutral');
  });

  it('serializes statuses', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, statuses: ['open', 'in-progress'] });
    expect(p.get('status')).toBe('open,in-progress');
  });

  it('omits hasAgent=any', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, hasAgent: 'any' });
    expect(p.has('hasAgent')).toBe(false);
  });

  it('includes hasAgent=yes', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, hasAgent: 'yes' });
    expect(p.get('hasAgent')).toBe('yes');
  });

  it('omits type=both', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, type: 'both' });
    expect(p.has('type')).toBe(false);
  });

  it('includes type=post', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, type: 'post' });
    expect(p.get('type')).toBe('post');
  });

  it('omits default sort', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, sort: 'priority_desc' });
    expect(p.has('sort')).toBe(false);
  });

  it('includes non-default sort', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, sort: 'createdAt_asc' });
    expect(p.get('sort')).toBe('createdAt_asc');
  });

  it('includes date range from/to', () => {
    const p = filtersToSearchParams({ ...DEFAULT_FILTERS, from: '2026-05-01', to: '2026-05-17' });
    expect(p.get('from')).toBe('2026-05-01');
    expect(p.get('to')).toBe('2026-05-17');
  });
});

describe('searchParamsToFilters', () => {
  it('returns defaults for empty params', () => {
    const f = searchParamsToFilters(new URLSearchParams());
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it('parses query string', () => {
    const f = searchParamsToFilters(new URLSearchParams('q=crash'));
    expect(f.q).toBe('crash');
  });

  it('parses comma-separated drivers', () => {
    const f = searchParamsToFilters(new URLSearchParams('driver=bug,billing'));
    expect(f.drivers).toEqual(['bug', 'billing']);
  });

  it('parses sentiments', () => {
    const f = searchParamsToFilters(new URLSearchParams('sentiment=negative,neutral'));
    expect(f.sentiments).toEqual(['negative', 'neutral']);
  });

  it('parses statuses', () => {
    const f = searchParamsToFilters(new URLSearchParams('status=open,in-progress'));
    expect(f.statuses).toEqual(['open', 'in-progress']);
  });

  it('parses hasAgent', () => {
    const f = searchParamsToFilters(new URLSearchParams('hasAgent=yes'));
    expect(f.hasAgent).toBe('yes');
  });

  it('defaults invalid hasAgent to any', () => {
    const f = searchParamsToFilters(new URLSearchParams('hasAgent=bogus'));
    expect(f.hasAgent).toBe('any');
  });

  it('parses content type', () => {
    const f = searchParamsToFilters(new URLSearchParams('type=post'));
    expect(f.type).toBe('post');
  });

  it('parses sort', () => {
    const f = searchParamsToFilters(new URLSearchParams('sort=createdAt_asc'));
    expect(f.sort).toBe('createdAt_asc');
  });
});

describe('round-trip', () => {
  it('serializes and deserializes a complex filter set', () => {
    const original: ContentFilters = {
      q: 'checkout crash',
      drivers: ['bug', 'billing'],
      sentiments: ['negative'],
      statuses: ['open'],
      author: 'frank',
      hasAgent: 'no',
      dateRange: '7d',
      from: '2026-05-10',
      to: '2026-05-17',
      type: 'post',
      sort: 'sentimentScore_asc',
    };
    const params = filtersToSearchParams(original);
    const restored = searchParamsToFilters(params);
    // dateRange is not serialized to URL (derived field); exclude from comparison
    expect(restored.q).toBe(original.q);
    expect(restored.drivers).toEqual(original.drivers);
    expect(restored.sentiments).toEqual(original.sentiments);
    expect(restored.statuses).toEqual(original.statuses);
    expect(restored.author).toBe(original.author);
    expect(restored.hasAgent).toBe(original.hasAgent);
    expect(restored.from).toBe(original.from);
    expect(restored.to).toBe(original.to);
    expect(restored.type).toBe(original.type);
    expect(restored.sort).toBe(original.sort);
  });
});
