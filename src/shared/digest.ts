/**
 * Weekly-digest builder.
 *
 * Produces a markdown-formatted modmail body summarising the last 7 days of
 * activity. Extracted into a pure helper so it can be unit-tested without a
 * running Devvit server.
 */

import { dateRange, today } from './keys.js';
import { readMonthlyCents } from './llm.js';
import {
  getDriverRollup,
  getIncident,
  getPostMetaMany,
  getRecentPostIds,
  getSentimentRollup,
  getSentimentScore,
  getThemeSnapshot,
  listAgents,
  listIncidentIds,
} from './storage.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DigestStats {
  weekDates: string[];
  totalPosts: number;
  totalComments: number;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  driverBreakdown: Record<string, number>;
  topNegativePosts: Array<{ postId: string; title: string; url: string; sentimentScore: number }>;
  activeAgentCount: number;
  incidentCount: number;
  resolvedIncidentCount: number;
  latestThemeNames: string[];
  llmSpendCents: number;
}

/**
 * Gather all stats for the weekly digest.
 * Pure async — all Redis reads, no side effects.
 */
export async function gatherDigestStats(): Promise<DigestStats> {
  const todayStr = today();
  const sevenDaysAgo = offsetDate(todayStr, -6);
  const weekDates = dateRange(sevenDaysAgo, todayStr);

  // Sentiment + driver rollups per day
  const [sentRollups, driverRollups] = await Promise.all([
    Promise.all(weekDates.map((d) => getSentimentRollup(d))),
    Promise.all(weekDates.map((d) => getDriverRollup(d))),
  ]);

  let totalComments = 0;
  const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0 };
  for (const r of sentRollups) {
    if (!r) continue;
    totalComments += r.total;
    sentimentBreakdown.positive += r.positive;
    sentimentBreakdown.neutral += r.neutral;
    sentimentBreakdown.negative += r.negative;
  }

  const driverBreakdown: Record<string, number> = {};
  let totalPosts = 0;
  for (const r of driverRollups) {
    if (!r) continue;
    totalPosts += r.totalPosts;
    for (const [driverId, count] of Object.entries(r.counts)) {
      driverBreakdown[driverId] = (driverBreakdown[driverId] ?? 0) + count;
    }
  }

  // Top 5 most-negative posts this week
  const recentIds = await getRecentPostIds(200);
  const sentScores = await Promise.all(recentIds.map((id) => getSentimentScore(id)));
  const negativePosts = recentIds
    .map((id, i) => ({ id, score: sentScores[i] }))
    .filter((x) => x.score?.label === 'negative')
    .sort((a, b) => (a.score?.score ?? 0) - (b.score?.score ?? 0))
    .slice(0, 5);

  const negMetasArr = await getPostMetaMany(negativePosts.map((x) => x.id));
  const negMetaById = new Map(negMetasArr.map((m) => [m.postId, m]));
  const topNegativePosts = negativePosts.map((x) => {
    const meta = negMetaById.get(x.id);
    return {
      postId: x.id,
      title: meta?.title ?? '(unknown)',
      url: meta?.url ?? '',
      sentimentScore: Number((x.score?.score ?? 0).toFixed(3)),
    };
  });

  // Incidents this week
  const incidentIds = await listIncidentIds(100);
  const incidents = (await Promise.all(incidentIds.map((id) => getIncident(id)))).filter(
    (inc) => inc !== null,
  );
  const weekStart = new Date(`${sevenDaysAgo}T00:00:00Z`).getTime();
  const weekIncidents = incidents.filter((inc) => inc !== null && inc.startedAt >= weekStart);
  const resolvedIncidentCount = weekIncidents.filter((inc) => inc?.status === 'resolved').length;

  // Agents
  const agents = await listAgents();
  const activeAgentCount = agents.filter((a) => a.role !== 'removed').length;

  // Themes
  const themeSnapshot = await getThemeSnapshot();
  const latestThemeNames = themeSnapshot?.themes.map((t) => t.name) ?? [];

  // LLM spend
  const llmSpendCents = await readMonthlyCents();

  return {
    weekDates,
    totalPosts,
    totalComments,
    sentimentBreakdown,
    driverBreakdown,
    topNegativePosts,
    activeAgentCount,
    incidentCount: weekIncidents.length,
    resolvedIncidentCount,
    latestThemeNames,
    llmSpendCents: Number(llmSpendCents.toFixed(2)),
  };
}

/**
 * Render the digest stats as a markdown modmail body.
 * Pure function — no I/O. Testable in isolation.
 */
export function buildWeeklyDigest(stats: DigestStats, subredditName: string): string {
  const sentTotal =
    stats.sentimentBreakdown.positive +
    stats.sentimentBreakdown.neutral +
    stats.sentimentBreakdown.negative;

  const sentPct = (n: number): string =>
    sentTotal > 0 ? `${Math.round((n / sentTotal) * 100)}%` : '—';

  const driverRows =
    Object.entries(stats.driverBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => `  - **${id}**: ${count}`)
      .join('\n') || '  _(no data)_';

  const negPostRows =
    stats.topNegativePosts.length > 0
      ? stats.topNegativePosts
          .map(
            (p) =>
              `  - [${escapeMarkdown(p.title)}](${p.url}) _(score: ${p.sentimentScore.toFixed(2)})_`,
          )
          .join('\n')
      : '  _(none)_';

  const themeRows =
    stats.latestThemeNames.length > 0
      ? stats.latestThemeNames.map((n) => `  - ${escapeMarkdown(n)}`).join('\n')
      : '  _(no themes generated yet — trigger /api/themes/regenerate)_';

  const from = stats.weekDates[0] ?? '—';
  const to = stats.weekDates[stats.weekDates.length - 1] ?? '—';

  return [
    `# RedLattuce Weekly Digest — r/${subredditName}`,
    `**Period:** ${from} → ${to}`,
    '',
    '## Volume',
    `- Posts: **${stats.totalPosts}**`,
    `- Comments: **${stats.totalComments}**`,
    '',
    '## Sentiment breakdown',
    `- Positive: **${stats.sentimentBreakdown.positive}** (${sentPct(stats.sentimentBreakdown.positive)})`,
    `- Neutral:  **${stats.sentimentBreakdown.neutral}** (${sentPct(stats.sentimentBreakdown.neutral)})`,
    `- Negative: **${stats.sentimentBreakdown.negative}** (${sentPct(stats.sentimentBreakdown.negative)})`,
    '',
    '## Contact driver breakdown',
    driverRows,
    '',
    '## Top 5 most-negative posts',
    negPostRows,
    '',
    '## Crisis incidents this week',
    `- Total: **${stats.incidentCount}** | Resolved: **${stats.resolvedIncidentCount}**`,
    '',
    '## Emerging themes (latest cluster)',
    themeRows,
    '',
    '## Team',
    `- Active verified agents: **${stats.activeAgentCount}**`,
    '',
    '## AI spend (current month)',
    `- LLM cost: **$${(stats.llmSpendCents / 100).toFixed(2)}** USD`,
    '',
    '---',
    '_Generated by RedLattuce · [Dashboard](https://reddit.com) · unsubscribe by disabling the weekly-digest scheduler task_',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function escapeMarkdown(text: string): string {
  return text.replace(/[[\]()\\`*_{}#+\-.!|]/g, (c) => `\\${c}`);
}
