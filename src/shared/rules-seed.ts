/**
 * Sample rules pre-seeded on first install.
 *
 * Why these are enabled by default:
 *   Mods installing the spam-detector / fraud-detector pipelines expect
 *   removal + ban behavior out of the box. Leaving every rule disabled
 *   meant pipelines could flag content forever without anything happening,
 *   which is what the user hit in QA ("I made a 'free Bitcoin giveaway'
 *   post but it wasn't marked as spam"). Each rule is plainly named in the
 *   Rules tab so it's obvious what's running and easy to disable.
 *
 *   The repeat-offender bans (3 spam/fraud tags in 30 days) give first
 *   offenders a removal-only warning before a permanent ban.
 */

import type { Rule } from './rules-types.js';

function nanoId(): string {
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
      name: 'Auto-remove spam',
      description:
        'Removes posts where the spam-detector pipeline fires true. Disable if you want to triage manually instead.',
      enabled: true,
      trigger: 'on-tag-write' as const,
      conditions: {
        op: 'condition' as const,
        pipelineId: 'spam-detector',
        field: 'value' as const,
        operator: 'eq' as const,
        value: true,
      },
      actions: [
        { type: 'remove-post' as const, spam: true },
        { type: 'audit-only' as const, note: 'auto-removed: spam-detector fired' },
        {
          type: 'ban-if-repeat' as const,
          pipelineId: 'spam-detector',
          threshold: 3,
          windowDays: 30,
          reason: 'Repeat spam (3+ flags in 30 days)',
          message:
            'Your account has been banned for repeated spam in this community. If you think this is a mistake, reply to this message.',
          durationDays: 30,
        },
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
        value: true,
      },
      actions: [{ type: 'audit-only' as const, note: 'impostor flagged by rules engine' }],
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
    },
    {
      id: `rule_seed_04_${nanoId()}`,
      name: 'Auto-remove fraud + ban repeats',
      description:
        'Removes posts the fraud-detector pipeline flags as scams (fake support, phishing, credential harvesting). Permanently bans authors who hit the rule 2+ times in 60 days — fraud is more serious than spam so the threshold is tighter.',
      enabled: true,
      trigger: 'on-tag-write' as const,
      conditions: {
        op: 'condition' as const,
        pipelineId: 'fraud-detector',
        field: 'value' as const,
        operator: 'eq' as const,
        value: true,
      },
      actions: [
        { type: 'remove-post' as const, spam: true },
        {
          type: 'send-modmail' as const,
          subject: 'Fraud removed by RedLattuce',
          bodyTemplate:
            'The fraud-detector pipeline removed a post from {{post.id}}. Review the audit log for the reasoning.',
        },
        {
          type: 'ban-if-repeat' as const,
          pipelineId: 'fraud-detector',
          threshold: 2,
          windowDays: 60,
          reason: 'Repeat fraud / impersonation attempts',
          message:
            'Your account has been permanently banned for repeated fraudulent activity in this community.',
          // No durationDays = permanent
        },
      ],
      createdAt: now,
      updatedAt: now,
      fireCount: 0,
    },
  ];
}
