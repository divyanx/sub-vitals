/**
 * Unit tests for ai-models.ts — curated catalog helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  CURATED_MODELS,
  DEFAULT_MODEL,
  findModel,
  isStructuredOutputCapable,
} from '../src/shared/ai-models.ts';

describe('CURATED_MODELS', () => {
  it('has at least 8 entries', () => {
    expect(CURATED_MODELS.length).toBeGreaterThanOrEqual(8);
  });

  it('includes the default model', () => {
    expect(CURATED_MODELS.some((m) => m.slug === DEFAULT_MODEL)).toBe(true);
  });

  it('default model is marked recommended', () => {
    const m = CURATED_MODELS.find((m) => m.slug === DEFAULT_MODEL);
    expect(m?.tier).toBe('recommended');
  });

  it('all entries have positive pricePer1kTaggingCalls', () => {
    for (const m of CURATED_MODELS) {
      expect(m.pricePer1kTaggingCalls).toBeGreaterThan(0);
    }
  });
});

describe('findModel', () => {
  it('returns the entry for a known slug', () => {
    const m = findModel('anthropic/claude-haiku-4.5');
    expect(m).not.toBeNull();
    expect(m?.label).toBe('Claude Haiku 4.5');
    expect(m?.provider).toBe('anthropic');
  });

  it('returns null for an unknown slug', () => {
    expect(findModel('unknown/does-not-exist')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(findModel('')).toBeNull();
  });
});

describe('isStructuredOutputCapable', () => {
  it('returns true for claude-haiku-4.5', () => {
    expect(isStructuredOutputCapable('anthropic/claude-haiku-4.5')).toBe(true);
  });

  it('returns false for llama-4-scout (not in structured output list)', () => {
    expect(isStructuredOutputCapable('meta-llama/llama-4-scout')).toBe(false);
  });

  it('returns true (optimistic) for an unknown slug', () => {
    // Unknown models get optimistic true so callers get real failure feedback at runtime.
    expect(isStructuredOutputCapable('unknown/mystery-model')).toBe(true);
  });

  it('returns true for gemini-2.5-flash', () => {
    expect(isStructuredOutputCapable('google/gemini-2.5-flash')).toBe(true);
  });
});
