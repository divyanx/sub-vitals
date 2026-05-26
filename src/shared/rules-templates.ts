/**
 * Rule templates — curated catalogue of ready-to-install automations.
 *
 * Each template is a Rule (minus id/timestamps) plus catalogue metadata
 * (name shown in the picker, category, icon). The Rules tab's "Browse
 * templates" surfaces these so mods can install common automations with
 * one click instead of authoring conditions/actions from scratch.
 *
 * To add a new template: copy an existing entry, give it a fresh
 * templateId (kebab-case), and write a one-line `whatHappens` that
 * states the cause and effect plainly ("when X happens, SubVitals
 * does Y"). The UI shows that line literally.
 *
 * All templates install with enabled=false by default so mods can read
 * + tweak before activating. The two safety nets we ship enabled
 * (spam-detector + fraud-detector auto-remove) live in rules-seed.ts.
 */

import type { Action, ConditionTree, RuleTrigger } from './rules-types.js';

export type RuleCategory =
  | 'safety' // spam / fraud / impostor / pii
  | 'triage' // escalation / status / routing
  | 'engagement' // praise / question handling
  | 'enforcement' // bans / locks
  | 'integration'; // webhooks / external systems

export interface RuleTemplate {
  templateId: string;
  name: string;
  whatHappens: string;
  category: RuleCategory;
  iconEmoji: string;
  /** Used as the rule's `description` when installed. */
  description: string;
  trigger: RuleTrigger;
  conditions: ConditionTree;
  actions: Action[];
}

/**
 * Catalogue. Ordered by typical usefulness — most-installed first.
 */
export const RULE_TEMPLATES: RuleTemplate[] = [
  // ───── safety ────────────────────────────────────────────────────────────
  {
    templateId: 'fraud-permaban',
    name: 'Permaban on fraud detection',
    whatHappens:
      'When fraud-detector flags a post, permanently ban the author and modmail the team.',
    category: 'safety',
    iconEmoji: '🚨',
    description: 'Zero-tolerance fraud rule. Tighter than the default 2-in-60-day ban-if-repeat.',
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'fraud-detector',
      field: 'value',
      operator: 'eq',
      value: true,
    },
    actions: [
      { type: 'remove-post', spam: true },
      {
        type: 'ban-author',
        reason: 'Fraud / impersonation attempt (SubVitals)',
        message:
          'Your account has been permanently banned for posting fraudulent or impersonation content in this community.',
      },
      {
        type: 'send-modmail',
        subject: 'Fraud detected — author permabanned',
        bodyTemplate:
          'Post {{post.id}} was removed and its author permanently banned by the Permaban-on-fraud rule.',
      },
    ],
  },
  {
    templateId: 'pii-quarantine',
    name: 'Quarantine posts with PII',
    whatHappens:
      'When pii-detector finds personal info, remove the post and audit-log it so a mod can DM the user.',
    category: 'safety',
    iconEmoji: '🔒',
    description:
      "Removes posts that contain phone numbers, emails, credit cards, or SSNs. We don't auto-ban — the user almost certainly didn't mean to leak.",
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'pii-detector',
      field: 'value',
      operator: 'eq',
      value: true,
    },
    actions: [
      { type: 'remove-post', spam: false },
      {
        type: 'audit-only',
        note: 'PII detected — removed for user safety. Reach out to the author with privacy guidance.',
      },
      {
        type: 'send-modmail',
        subject: 'PII removed — please follow up with author',
        bodyTemplate:
          'Post {{post.id}} contained PII and was removed. Consider sending the author a friendly DM with guidance.',
      },
    ],
  },
  {
    templateId: 'impostor-modmail',
    name: 'Flag suspected brand impostors',
    whatHappens:
      'When impostor-detector flags a comment author, modmail the team with the audit context.',
    category: 'safety',
    iconEmoji: '🎭',
    description:
      'Silent flagging — no removal. Lets a human verify before acting because false positives ("I work at X" said honestly) are easy here.',
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'impostor',
      field: 'value',
      operator: 'eq',
      value: true,
    },
    actions: [
      { type: 'audit-only', note: 'impostor flagged — please verify' },
      {
        type: 'send-modmail',
        subject: 'Possible brand impostor — verify',
        bodyTemplate:
          'Audit log entry for post {{post.id}}: an author was flagged as a possible impostor. Open SubVitals → Audit log for details.',
      },
    ],
  },

  // ───── triage ────────────────────────────────────────────────────────────
  {
    templateId: 'bug-negative-escalate',
    name: 'Escalate critical bug reports',
    whatHappens:
      'When a post is intent=bug AND sentiment is strongly negative, escalate to high severity and modmail the engineering channel.',
    category: 'triage',
    iconEmoji: '🐛',
    description:
      "Catches angry bug reports before they snowball into community frustration. The escalation shows up in the Pulse 'priority queue'.",
    trigger: 'on-tag-write',
    conditions: {
      op: 'and',
      children: [
        {
          op: 'condition',
          pipelineId: 'contact-drivers',
          field: 'value',
          operator: 'eq',
          value: 'bug',
        },
        {
          op: 'condition',
          pipelineId: 'sentiment',
          field: 'confidence',
          operator: 'lt',
          value: -0.5,
        },
      ],
    },
    actions: [
      { type: 'escalate', severity: 'high' },
      { type: 'set-status', status: 'in-progress' },
      {
        type: 'send-modmail',
        subject: 'High-priority bug report',
        bodyTemplate:
          'A post was flagged as a critical bug with strongly negative sentiment. Post ID: {{post.id}}',
      },
    ],
  },
  {
    templateId: 'refund-route',
    name: 'Route refund requests to billing',
    whatHappens:
      'When intent=refund or intent=billing, modmail the billing alias so finance sees it without scrolling the feed.',
    category: 'triage',
    iconEmoji: '💸',
    description:
      'Useful when your finance / billing team is a different group from community mods. Edit the modmail body to mention specific users (e.g. @finance-team).',
    trigger: 'on-tag-write',
    conditions: {
      op: 'or',
      children: [
        {
          op: 'condition',
          pipelineId: 'contact-drivers',
          field: 'value',
          operator: 'eq',
          value: 'refund',
        },
        {
          op: 'condition',
          pipelineId: 'contact-drivers',
          field: 'value',
          operator: 'eq',
          value: 'billing',
        },
      ],
    },
    actions: [
      {
        type: 'send-modmail',
        subject: '[Billing] new refund / billing post',
        bodyTemplate: 'Post {{post.id}} was tagged as a billing / refund request.',
      },
      { type: 'set-status', status: 'in-progress' },
    ],
  },
  {
    templateId: 'praise-mark-responded',
    name: 'Mark positive praise as resolved',
    whatHappens:
      'When sentiment is strongly positive and intent is praise, set status to "responded" so the queue stays focused on actual problems.',
    category: 'triage',
    iconEmoji: '🌟',
    description:
      'Optional — only useful if you triage the queue by status. Doesn\'t remove or hide anything; just clears these posts off the "needs attention" filter.',
    trigger: 'on-tag-write',
    conditions: {
      op: 'and',
      children: [
        {
          op: 'condition',
          pipelineId: 'contact-drivers',
          field: 'value',
          operator: 'eq',
          value: 'praise',
        },
        {
          op: 'condition',
          pipelineId: 'sentiment',
          field: 'confidence',
          operator: 'gt',
          value: 0.5,
        },
      ],
    },
    actions: [{ type: 'set-status', status: 'responded' }],
  },

  // ───── engagement ────────────────────────────────────────────────────────
  {
    templateId: 'question-needs-team',
    name: 'Flag questions awaiting team response',
    whatHappens:
      'When intent=question is detected, set status to in-progress and audit-log so the team-response tracker can measure SLA.',
    category: 'engagement',
    iconEmoji: '❓',
    description:
      "Pairs with the team-response-tracker pipeline. Doesn't do anything visible to users — pure SLA bookkeeping.",
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'contact-drivers',
      field: 'value',
      operator: 'eq',
      value: 'question',
    },
    actions: [
      { type: 'set-status', status: 'in-progress' },
      { type: 'audit-only', note: 'question routed — team SLA clock started' },
    ],
  },

  // ───── enforcement ───────────────────────────────────────────────────────
  {
    templateId: 'repeat-negative-author',
    name: 'Ban authors with repeat very-negative posts',
    whatHappens:
      'When the same author has 5+ strongly-negative posts in 30 days, ban for 7 days. Catches sustained brigaders without punishing one bad day.',
    category: 'enforcement',
    iconEmoji: '⛔',
    description:
      'Borderline rule — disabled by default. Tune the threshold and pipelineId before enabling. Strongly-negative is sentiment confidence ≤ -0.5.',
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'sentiment',
      field: 'confidence',
      operator: 'lt',
      value: -0.5,
    },
    actions: [
      {
        type: 'ban-if-repeat',
        pipelineId: 'sentiment',
        threshold: 5,
        windowDays: 30,
        reason: '5+ strongly-negative posts in 30 days (SubVitals)',
        durationDays: 7,
      },
    ],
  },

  // ───── integration ───────────────────────────────────────────────────────
  {
    templateId: 'slack-on-fraud',
    name: 'Slack webhook on fraud',
    whatHappens: 'When fraud-detector fires, POST a JSON payload to your Slack incoming webhook.',
    category: 'integration',
    iconEmoji: '💬',
    description:
      'Set the webhook URL to your Slack channel after install. The payload includes pipelineId, value, postId, and timestamp.',
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'fraud-detector',
      field: 'value',
      operator: 'eq',
      value: true,
    },
    actions: [
      { type: 'webhook', url: 'https://hooks.slack.com/services/REPLACE_ME', method: 'POST' },
    ],
  },
  {
    templateId: 'pagerduty-on-crisis',
    name: 'PagerDuty incident on crisis',
    whatHappens:
      'When the volume-spike-detector pipeline fires, POST to a PagerDuty Events API endpoint to page on-call.',
    category: 'integration',
    iconEmoji: '🚒',
    description:
      'Replace the URL with your PagerDuty integration key. Pairs naturally with crisis-detection escalations.',
    trigger: 'on-tag-write',
    conditions: {
      op: 'condition',
      pipelineId: 'crisis',
      field: 'value',
      operator: 'eq',
      value: true,
    },
    actions: [
      { type: 'webhook', url: 'https://events.pagerduty.com/v2/enqueue', method: 'POST' },
      { type: 'escalate', severity: 'critical' },
    ],
  },
];

/** Lookup by templateId. */
export function getRuleTemplate(templateId: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.templateId === templateId);
}
