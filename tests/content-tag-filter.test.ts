/**
 * Unit tests for the pipelineTags intersection logic used by /api/content/search.
 *
 * We test the pure intersection algorithm directly (not through the Hono handler)
 * so we can run without Redis. The helper `applyTagFilter` mirrors what the
 * server does: OR within a dimension, AND across dimensions.
 */

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helper — mirrors the server intersection logic so we can unit-test it
// without Redis stubs.
// ---------------------------------------------------------------------------

/**
 * @param candidateIds  Full list of post/comment ids (the "all ids" pool)
 * @param pipelineTags  Map of pipelineId → selected values
 * @param tagIndex      Mock index: (pipelineId, value) → targetId[]
 * @returns Filtered candidate list after applying all tag dimensions
 */
function applyTagFilter(
  candidateIds: string[],
  pipelineTags: Record<string, string[]>,
  tagIndex: (pipelineId: string, value: string) => string[],
): string[] {
  const hasPipelineTagFilter = Object.keys(pipelineTags).length > 0;
  if (!hasPipelineTagFilter) return candidateIds;

  let tagCandidateSet: Set<string> | null = null;

  for (const [pipelineId, values] of Object.entries(pipelineTags)) {
    const dimensionIds = new Set<string>();
    for (const v of values) {
      for (const id of tagIndex(pipelineId, v)) {
        dimensionIds.add(id);
      }
    }
    if (tagCandidateSet === null) {
      tagCandidateSet = dimensionIds;
    } else {
      for (const id of tagCandidateSet) {
        if (!dimensionIds.has(id)) tagCandidateSet.delete(id);
      }
    }
  }

  return candidateIds.filter((id) => (tagCandidateSet as Set<string>).has(id));
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ALL_IDS = ['post_001', 'post_002', 'post_003', 'post_004', 'post_005'];

// Mock index: intent pipeline
// post_001 → bug, post_002 → billing, post_003 → bug+billing, post_004 → feature
// post_005 → (no intent tag)
const intentIndex: Record<string, string[]> = {
  bug: ['post_001', 'post_003'],
  billing: ['post_002', 'post_003'],
  feature: ['post_004'],
};

// Mock index: sentiment pipeline
// post_001 → negative, post_002 → negative, post_003 → positive, post_004 → neutral
const sentimentIndex: Record<string, string[]> = {
  negative: ['post_001', 'post_002'],
  positive: ['post_003'],
  neutral: ['post_004'],
};

function mockTagIndex(pipelineId: string, value: string): string[] {
  if (pipelineId === 'intent') return intentIndex[value] ?? [];
  if (pipelineId === 'sentiment') return sentimentIndex[value] ?? [];
  return [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyTagFilter — single dimension, single value', () => {
  it('narrows to posts tagged bug under intent pipeline', () => {
    const result = applyTagFilter(ALL_IDS, { intent: ['bug'] }, mockTagIndex);
    expect(result).toEqual(expect.arrayContaining(['post_001', 'post_003']));
    expect(result).not.toContain('post_002');
    expect(result).not.toContain('post_004');
    expect(result).not.toContain('post_005');
    expect(result.length).toBe(2);
  });
});

describe('applyTagFilter — single dimension, multiple values (OR within)', () => {
  it('returns union of bug and billing posts', () => {
    const result = applyTagFilter(ALL_IDS, { intent: ['bug', 'billing'] }, mockTagIndex);
    // post_001 (bug), post_002 (billing), post_003 (bug+billing)
    expect(result).toEqual(expect.arrayContaining(['post_001', 'post_002', 'post_003']));
    expect(result).not.toContain('post_004');
    expect(result).not.toContain('post_005');
    expect(result.length).toBe(3);
  });
});

describe('applyTagFilter — multiple dimensions (AND across)', () => {
  it('intersects intent=bug AND sentiment=negative', () => {
    const result = applyTagFilter(
      ALL_IDS,
      { intent: ['bug'], sentiment: ['negative'] },
      mockTagIndex,
    );
    // Only post_001 is bug AND negative; post_003 is bug but positive
    expect(result).toEqual(['post_001']);
  });

  it('intersects intent=billing AND sentiment=negative', () => {
    const result = applyTagFilter(
      ALL_IDS,
      { intent: ['billing'], sentiment: ['negative'] },
      mockTagIndex,
    );
    // post_002 is billing AND negative; post_003 is billing but positive
    expect(result).toEqual(['post_002']);
  });
});

describe('applyTagFilter — no tags provided', () => {
  it('returns the full candidate list unchanged', () => {
    const result = applyTagFilter(ALL_IDS, {}, mockTagIndex);
    expect(result).toEqual(ALL_IDS);
  });
});

describe('applyTagFilter — tag set empty (no matching targets)', () => {
  it('returns empty array when no posts match the requested tag', () => {
    // "nonexistent" value → empty index → intersection = empty
    const result = applyTagFilter(ALL_IDS, { intent: ['nonexistent'] }, mockTagIndex);
    expect(result).toEqual([]);
  });

  it('returns empty array when intersection across two dimensions is empty', () => {
    // intent=feature (only post_004) AND sentiment=negative (post_001, post_002) → empty
    const result = applyTagFilter(
      ALL_IDS,
      { intent: ['feature'], sentiment: ['negative'] },
      mockTagIndex,
    );
    expect(result).toEqual([]);
  });
});
