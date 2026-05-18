/**
 * Canonical registry of builtin pipelines — single source of truth.
 *
 * All UI surfaces (Pipelines tab, Insights tab, Incidents, Team, Audit) derive
 * their pipeline lists from this registry via the `showIn` field.
 *
 * Rules:
 *   - 'insights'  → rendered as a sub-tab section in the Insights tab
 *   - 'pipelines' → appears in the Pipelines catalog (all builtins carry this)
 *   - 'incidents' → output feeds the Incidents tab (crisis-detection)
 *   - 'team'      → output feeds the Team tab (agent-metrics)
 *   - 'audit'     → output feeds the Audit log tab (impostor-detection)
 *
 * These records are immutable in code — operators can tune prompts and
 * enable/disable pipelines via pipeline overrides, but cannot delete or rename.
 */

import type { Pipeline } from './types.js';

export const BUILTIN_PIPELINES: Pipeline[] = [
  {
    id: 'intent',
    name: 'Drivers',
    description: 'Classifies each post into a contact-driver category from your taxonomy.',
    kind: 'categorical',
    trigger: 'post-create',
    outputSchema: 'single-label',
    source: 'builtin',
    enabled: true,
    logic: 'Lexicon → LLM',
    moduleKey: 'contact-drivers',
    showIn: ['insights', 'pipelines'],
    order: 0,
  },
  {
    id: 'sentiment',
    name: 'Sentiment',
    description: 'AFINN-lexicon sentiment score with positive / neutral / negative label.',
    kind: 'ordinal',
    trigger: 'post-create',
    outputSchema: 'label-confidence',
    source: 'builtin',
    enabled: true,
    labels: ['positive', 'neutral', 'negative'],
    logic: 'AFINN lexicon → LLM judge for ambiguous',
    moduleKey: 'sentiment',
    showIn: ['insights', 'pipelines'],
    order: 1,
  },
  {
    id: 'themes',
    name: 'Themes',
    description: 'LLM clusters recent posts into recurring topic groups.',
    kind: 'cluster',
    trigger: 'scheduled',
    outputSchema: 'cluster',
    source: 'builtin',
    enabled: true,
    logic: 'LLM clustering of negative posts',
    moduleKey: 'theme-clustering',
    showIn: ['insights', 'pipelines'],
    order: 2,
  },
  {
    id: 'impostor',
    name: 'Impostor detection',
    description: 'Flags comments that impersonate brand agents or attempt social-engineering.',
    kind: 'boolean',
    trigger: 'comment-create',
    outputSchema: 'boolean',
    source: 'builtin',
    enabled: true,
    logic: 'Regex pre-filter → LLM judge',
    moduleKey: 'impostor-detection',
    // Not in 'insights' — boolean flag renders in dedicated Audit log tab instead
    showIn: ['pipelines', 'audit'],
    order: 3,
  },
  {
    id: 'crisis',
    name: 'Crisis detection',
    description: 'Monitors comment velocity and sentiment for potential community crises.',
    kind: 'boolean',
    trigger: 'comment-create',
    outputSchema: 'boolean',
    source: 'builtin',
    enabled: true,
    logic: 'Hourly volume + negative-share thresholds',
    moduleKey: 'crisis-detection',
    // Not in 'insights' — has its own Incidents tab
    showIn: ['pipelines', 'incidents'],
    order: 4,
  },
  {
    id: 'agent-metrics',
    name: 'Team performance',
    description: 'Tracks first-response latency and sentiment-delta for verified agents.',
    kind: 'scalar',
    trigger: 'comment-create',
    outputSchema: 'scalar',
    source: 'builtin',
    enabled: true,
    logic: 'First-response latency + sentiment delta tracking',
    moduleKey: 'agent-metrics',
    // Not in 'insights' — per-agent data renders in dedicated Team tab
    showIn: ['pipelines', 'team'],
    order: 5,
  },
  {
    id: 'root-cause',
    name: 'Root cause',
    description: 'AI summarises resolved post + agent reply into a root-cause string.',
    kind: 'categorical',
    trigger: 'status-change',
    outputSchema: 'single-label',
    source: 'builtin',
    enabled: true,
    logic: 'AI summarises post + agent reply into root-cause string',
    moduleKey: 'root-cause',
    alpha: true,
    showIn: ['insights', 'pipelines'],
    order: 6,
  },
];

/** Look up a single builtin by id. */
export function getBuiltinPipeline(id: string): Pipeline | undefined {
  return BUILTIN_PIPELINES.find((p) => p.id === id);
}

/**
 * Return only the builtins that should appear as sub-tabs in the Insights view.
 * Filters to showIn.includes('insights').
 */
export function getInsightsPipelines(): Pipeline[] {
  return BUILTIN_PIPELINES.filter((p) => p.showIn?.includes('insights'));
}
