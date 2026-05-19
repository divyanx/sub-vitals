/**
 * Sample rules pre-seeded on first install.
 * All disabled by default so mods can explore them without side effects.
 */

import type { Rule } from './rules-types.js';

function nanoId(): string {
  // Simple deterministic-enough ID for seeded rules
  return Math.random().toString(36).slice(2, 11);
}

export function buildSeedRules(): Rule[] {
  const now = Date.now();
  return [
    {
      id: `rule_seed_01_${nanoId()}`,
      name: 'Auto-escalate critical bugs',
      description: 'Fires when a post is tagged as a bug and has strongly negative sentiment.',
      enabled: false,
      trigger: 'on-tag-write' as const,
      conditions: {
        op: 'and' as const,
        children: [
          {
            op: 'condition' as const,
            pipelineId: 'intent',
            field: 'value' as const,
            operator: 'eq' as const,
            value: 'bug',
          },
          {
            op: 'condition' as const,
            pipelineId: 'sentiment',
            field: 'confidence' as const,
            operator: 'lt' as const,
            value: -0.5,
          },
        ],
      },
      actions: [
        { type: 'escalate' as const, severity: 'high' as const },
        {
          type: 'send-modmail' as const,
          subject: 'High-priority bug report',
          bodyTemplate:
            'A post has been flagged as a critical bug with strongly negative sentiment. Post ID: {{post.id}}',
        },
      ],
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
    },
    {
      id: `rule_seed_02_${nanoId()}`,
      name: 'Remove suspected spam',
      description: 'Removes posts where the spam-detector pipeline fires true.',
      enabled: false,
      trigger: 'on-tag-write' as const,
      conditions: {
        op: 'condition' as const,
        pipelineId: 'spam-detector',
        field: 'value' as const,
        operator: 'eq' as const,
        value: 'true',
      },
      actions: [
        { type: 'remove-post' as const, spam: true },
        { type: 'audit-only' as const, note: 'auto-removed: spam-detector fired' },
      ],
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
    },
    {
      id: `rule_seed_03_${nanoId()}`,
      name: 'Flag impostors silently',
      description: 'Records an audit note when impostor-detection fires — no public action.',
      enabled: false,
      trigger: 'on-tag-write' as const,
      conditions: {
        op: 'condition' as const,
        pipelineId: 'impostor',
        field: 'value' as const,
        operator: 'eq' as const,
        value: 'true',
      },
      actions: [{ type: 'audit-only' as const, note: 'impostor flagged by rules engine' }],
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
    },
  ];
}
