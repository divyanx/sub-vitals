import { describe, expect, it } from 'vitest';
import type { DigestStats } from '../src/shared/digest.ts';
import { buildWeeklyDigest } from '../src/shared/digest.ts';

const baseStats: DigestStats = {
  weekDates: [
    '2026-05-10',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-16',
  ],
  totalPosts: 142,
  totalComments: 938,
  sentimentBreakdown: { positive: 310, neutral: 420, negative: 208 },
  driverBreakdown: {
    bug: 45,
    complaint: 38,
    feature: 22,
    question: 15,
    billing: 10,
    praise: 7,
    other: 5,
  },
  topNegativePosts: [
    {
      postId: 't3_abc1',
      title: 'Firmware 16.3 bricked my amp',
      url: 'https://reddit.com/r/test/comments/abc1',
      sentimentScore: -0.92,
    },
    {
      postId: 't3_abc2',
      title: 'Still no fix after 3 months',
      url: 'https://reddit.com/r/test/comments/abc2',
      sentimentScore: -0.87,
    },
  ],
  activeAgentCount: 4,
  incidentCount: 2,
  resolvedIncidentCount: 2,
  latestThemeNames: [
    'App crashing on iOS',
    'Setup failure on new hardware',
    'No sound after update',
  ],
  llmSpendCents: 42.5,
};

describe('buildWeeklyDigest', () => {
  it('includes the subreddit name in the heading', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('r/sonos');
  });

  it('includes the week date range', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('2026-05-10');
    expect(md).toContain('2026-05-16');
  });

  it('includes volume stats', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('142'); // posts
    expect(md).toContain('938'); // comments
  });

  it('includes sentiment breakdown with percentages', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('310'); // positive count
    expect(md).toContain('208'); // negative count
    // 310/938 ≈ 33%, 208/938 ≈ 22%
    expect(md).toMatch(/33%/);
    expect(md).toMatch(/22%/);
  });

  it('includes top driver breakdown', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('bug');
    expect(md).toContain('45');
    expect(md).toContain('complaint');
  });

  it('includes top-negative post links', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('Firmware');
    expect(md).toContain('reddit.com/r/test/comments/abc1');
    expect(md).toContain('-0.92');
  });

  it('includes incident stats', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('2'); // incidentCount
    expect(md).toContain('Resolved');
  });

  it('includes theme names', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('App crashing on iOS');
    expect(md).toContain('Setup failure on new hardware');
  });

  it('includes LLM spend in USD', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    // 42.5 cents = $0.42 (toFixed(2) truncates at .425 → .42)
    expect(md).toContain('$0.42');
  });

  it('includes verified agent count', () => {
    const md = buildWeeklyDigest(baseStats, 'sonos');
    expect(md).toContain('4');
  });

  it('returns a non-empty markdown string', () => {
    const md = buildWeeklyDigest(baseStats, 'testbrand');
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(200);
    // Starts with a markdown heading
    expect(md.startsWith('#')).toBe(true);
  });

  it('handles empty stats gracefully', () => {
    const empty: DigestStats = {
      weekDates: ['2026-05-10', '2026-05-16'],
      totalPosts: 0,
      totalComments: 0,
      sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
      driverBreakdown: {},
      topNegativePosts: [],
      activeAgentCount: 0,
      incidentCount: 0,
      resolvedIncidentCount: 0,
      latestThemeNames: [],
      llmSpendCents: 0,
    };
    const md = buildWeeklyDigest(empty, 'brand');
    expect(md).toContain('r/brand');
    expect(md).toContain('_(none)_');
    expect(md).toContain('_(no data)_');
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('NaN');
  });

  it('escapes markdown special chars in post titles', () => {
    const stats: DigestStats = {
      ...baseStats,
      topNegativePosts: [
        {
          postId: 't3_xyz',
          title: 'My [device] broke (again)',
          url: 'https://reddit.com/r/test/xyz',
          sentimentScore: -0.8,
        },
      ],
    };
    const md = buildWeeklyDigest(stats, 'brand');
    // Brackets around title text should be escaped so they don't form a markdown link
    expect(md).toContain('\\[device\\]');
  });
});
