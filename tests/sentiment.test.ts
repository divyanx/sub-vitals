import { describe, expect, it } from 'vitest';
import { scoreText } from '../src/modules/sentiment/index.ts';

describe('scoreText', () => {
  it('returns neutral for empty input', () => {
    expect(scoreText('').label).toBe('neutral');
    expect(scoreText('   ').label).toBe('neutral');
    expect(scoreText('').score).toBe(0);
  });

  it('returns neutral for text with no AFINN words', () => {
    const r = scoreText('the the the the');
    expect(r.label).toBe('neutral');
    expect(Math.abs(r.score)).toBeLessThan(0.05);
  });

  it('labels strongly positive text as positive', () => {
    const r = scoreText('I love this. Amazing service, fantastic experience.');
    expect(r.label).toBe('positive');
    expect(r.score).toBeGreaterThan(0.05);
  });

  it('labels strongly negative text as negative', () => {
    const r = scoreText('Terrible. Horrible product, worst purchase ever.');
    expect(r.label).toBe('negative');
    expect(r.score).toBeLessThan(-0.05);
  });

  it('normalizes score into [-1, 1]', () => {
    const r1 = scoreText('amazing amazing amazing amazing amazing');
    const r2 = scoreText('horrible horrible horrible horrible horrible');
    expect(r1.score).toBeLessThanOrEqual(1);
    expect(r1.score).toBeGreaterThanOrEqual(-1);
    expect(r2.score).toBeLessThanOrEqual(1);
    expect(r2.score).toBeGreaterThanOrEqual(-1);
  });

  it('handles AFINN negation ("not good")', () => {
    // The `sentiment` package handles "not good" by flipping the sign.
    const pos = scoreText('this is good');
    const neg = scoreText('this is not good');
    expect(pos.label).toBe('positive');
    expect(neg.score).toBeLessThan(pos.score);
  });
});
