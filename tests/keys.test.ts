import { describe, expect, it } from 'vitest';
import { dateRange, K, today, yyyymm } from '../src/shared/keys.ts';

describe('K — key builders', () => {
  it('namespaces every key under rl:', () => {
    expect(K.taxonomy().startsWith('rl:')).toBe(true);
    expect(K.postTag('t3_abc').startsWith('rl:')).toBe(true);
    expect(K.driverIndex('bug').startsWith('rl:')).toBe(true);
    expect(K.driverRollup('2026-05-17').startsWith('rl:')).toBe(true);
    expect(K.agent('Alice').startsWith('rl:')).toBe(true);
    expect(K.sentimentScore('t1_xyz').startsWith('rl:')).toBe(true);
    expect(K.processed('h', 'c').startsWith('rl:')).toBe(true);
    expect(K.rateLimit('llm').startsWith('rl:')).toBe(true);
  });

  it('lowercases usernames in agent + perm cache keys', () => {
    expect(K.agent('ALICE')).toBe(K.agent('alice'));
    expect(K.modPermCache('Bob')).toBe(K.modPermCache('bob'));
  });
});

describe('today() / yyyymm()', () => {
  it('returns ISO YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('returns ISO YYYY-MM', () => {
    expect(yyyymm()).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('dateRange', () => {
  it('returns inclusive [from, to] range, ascending', () => {
    expect(dateRange('2026-05-15', '2026-05-17')).toEqual([
      '2026-05-15',
      '2026-05-16',
      '2026-05-17',
    ]);
  });
  it('returns single-element list when from === to', () => {
    expect(dateRange('2026-05-17', '2026-05-17')).toEqual(['2026-05-17']);
  });
  it('returns empty when from > to', () => {
    expect(dateRange('2026-05-18', '2026-05-17')).toEqual([]);
  });
});
