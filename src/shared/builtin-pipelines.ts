/**
 * Canonical list of builtin pipelines.
 *
 * These are immutable in code — operators can tune prompts and enable/disable
 * them via pipeline overrides, but cannot delete or rename them.
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
    order: 4,
  },
  {
    id: 'agent-metrics',
    name: 'Agent metrics',
    description: 'Tracks first-response latency and sentiment-delta for verified agents.',
    kind: 'scalar',
    trigger: 'comment-create',
    outputSchema: 'scalar',
    source: 'builtin',
    enabled: true,
    order: 5,
  },
];

/** Look up a single builtin by id. */
export function getBuiltinPipeline(id: string): Pipeline | undefined {
  return BUILTIN_PIPELINES.find((p) => p.id === id);
}
