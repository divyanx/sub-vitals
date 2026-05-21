/**
 * Copilot tool catalogue.
 *
 * Each tool has:
 *   - `name`     stable id, used in the LLM tool list
 *   - `description` plain-English summary for the model
 *   - `inputSchema` Zod schema for the args
 *   - `safety`    'read' (runs immediately) or 'write' (returns a preview;
 *                 actual execution gated behind /api/copilot/execute)
 *   - `execute`   (read-only tools) async function returning JSON-serialisable data
 *   - `preview`   (write tools) async function returning a human-readable plan
 *   - `commit`    (write tools) async function that actually applies the change
 *
 * Write tools NEVER mutate during the LLM turn. The model proposes; the UI
 * shows a confirmation card; the mod clicks Confirm; the client POSTs to
 * /api/copilot/execute with the tool name + args; only THEN do we mutate.
 *
 * All inputs are Zod-validated before invocation. All tools call `requireMod`
 * before touching anything privileged.
 */

import { reddit, redis } from '@devvit/web/server';
import { recordAudit } from '@modules/audit-log/index.js';
import { K, today } from '@shared/keys.js';
import { readMonthlyCents, readMonthlyTokens } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import {
  getInstance,
  installFromTemplate,
  listInstances,
  patchInstance,
} from '@shared/pipeline-instances.js';
import { getPipelineTemplate, PIPELINE_TEMPLATES } from '@shared/pipeline-templates.js';
import { getRule, listEnabledRules, listRules, saveRule } from '@shared/rules-storage.js';
import { getRuleTemplate, RULE_TEMPLATES } from '@shared/rules-templates.js';
import type { Action, Rule } from '@shared/rules-types.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

function pageMeta(items: unknown[], total?: number): { count: number; total?: number } {
  return total === undefined ? { count: items.length } : { count: items.length, total };
}

// ---------------------------------------------------------------------------
// Read tool schemas + executors
// ---------------------------------------------------------------------------

const listInstalledPipelinesSchema = z.object({}).strict();
async function execListInstalledPipelines() {
  const all = await listInstances();
  return {
    ...pageMeta(all),
    instances: all.map((i) => ({
      id: i.id,
      name: i.name,
      templateId: i.templateId,
      enabled: i.enabled,
      kind: i.config.outputSchema,
      trigger: i.config.trigger,
      showIn: i.showIn,
    })),
  };
}

const searchPostsSchema = z
  .object({
    query: z.string().max(200).optional(),
    driverId: z.string().max(80).optional(),
    sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
    status: z.enum(['open', 'in-progress', 'responded', 'resolved']).optional(),
    days: z.number().int().min(1).max(90).optional().default(7),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict();

async function execSearchPosts(args: z.infer<typeof searchPostsSchema>) {
  // Pull recent meta from rl:meta:recent (LIST of postIds) and filter by tags.
  const ids = (await redis
    .zRange(K.recentPosts(), 0, args.limit * 4, { reverse: true } as never)
    .catch(() => [])) as Array<{ member: string }> | string[];
  const flatIds: string[] = Array.isArray(ids)
    ? (ids as unknown[])
        .map((v) => (typeof v === 'string' ? v : ((v as { member: string }).member ?? '')))
        .filter(Boolean)
    : [];

  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const results: Array<Record<string, unknown>> = [];

  for (const postId of flatIds) {
    if (results.length >= args.limit) break;
    const metaRaw = await redis.get(K.postMeta(postId)).catch(() => null);
    if (!metaRaw) continue;
    const meta = JSON.parse(metaRaw) as {
      postId: string;
      title: string;
      authorName: string;
      url: string;
      createdAt: number;
    };
    if (meta.createdAt < cutoff) continue;

    const tagRaw = await redis.get(K.postTag(postId)).catch(() => null);
    const tag = tagRaw ? (JSON.parse(tagRaw) as { driverId?: string; status?: string }) : null;
    if (args.driverId && tag?.driverId !== args.driverId) continue;
    if (args.status && tag?.status !== args.status) continue;

    const sentRaw = await redis.get(K.sentimentScore(postId)).catch(() => null);
    const sent = sentRaw ? (JSON.parse(sentRaw) as { label?: string; score?: number }) : null;
    if (args.sentiment && sent?.label !== args.sentiment) continue;

    if (args.query) {
      const q = args.query.toLowerCase();
      if (!meta.title.toLowerCase().includes(q)) continue;
    }

    results.push({
      postId: meta.postId,
      title: meta.title,
      author: meta.authorName,
      url: meta.url,
      createdAt: meta.createdAt,
      driverId: tag?.driverId ?? null,
      status: tag?.status ?? null,
      sentimentLabel: sent?.label ?? null,
      sentimentScore: sent?.score ?? null,
    });
  }

  return { ...pageMeta(results), posts: results };
}

const getPostDetailSchema = z.object({ postId: z.string().min(1).max(50) }).strict();
async function execGetPostDetail(args: z.infer<typeof getPostDetailSchema>) {
  const metaRaw = await redis.get(K.postMeta(args.postId)).catch(() => null);
  if (!metaRaw) return { post: null, reason: 'not-found' };
  const meta = JSON.parse(metaRaw);
  const [tagRaw, sentRaw] = await Promise.all([
    redis.get(K.postTag(args.postId)).catch(() => null),
    redis.get(K.sentimentScore(args.postId)).catch(() => null),
  ]);
  return {
    post: meta,
    tag: tagRaw ? JSON.parse(tagRaw) : null,
    sentiment: sentRaw ? JSON.parse(sentRaw) : null,
  };
}

const getPipelineSummarySchema = z.object({ pipelineId: z.string().min(1).max(80) }).strict();
async function execGetPipelineSummary(args: z.infer<typeof getPipelineSummarySchema>) {
  const inst = await getInstance(args.pipelineId);
  if (!inst) return { pipelineId: args.pipelineId, exists: false };
  return {
    pipelineId: inst.id,
    exists: true,
    name: inst.name,
    enabled: inst.enabled,
    trigger: inst.config.trigger,
    outputSchema: inst.config.outputSchema,
    labels: inst.config.labels ?? [],
    description: inst.description ?? null,
  };
}

const getAvailableTemplatesSchema = z.object({}).strict();
async function execGetAvailableTemplates() {
  return {
    ...pageMeta(PIPELINE_TEMPLATES),
    templates: PIPELINE_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      kind: t.kind,
      shortDescription: t.shortDescription,
    })),
  };
}

const getAvailableRuleTemplatesSchema = z.object({}).strict();
async function execGetAvailableRuleTemplates() {
  return {
    ...pageMeta(RULE_TEMPLATES),
    templates: RULE_TEMPLATES.map((t) => ({
      templateId: t.templateId,
      name: t.name,
      whatHappens: t.whatHappens,
      category: t.category,
    })),
  };
}

const getRecentRulesSchema = z.object({}).strict();
async function execGetRecentRules() {
  const rules = await listRules();
  return {
    ...pageMeta(rules),
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      trigger: r.trigger,
      actionCount: r.actions.length,
      fireCount: r.fireCount,
      lastFiredAt: r.lastFiredAt ?? null,
    })),
  };
}

const getTeamPerformanceSchema = z
  .object({ days: z.number().int().min(1).max(90).optional().default(7) })
  .strict();
async function execGetTeamPerformance(args: z.infer<typeof getTeamPerformanceSchema>) {
  // Minimal stub — surface verified agent count + a note. Real leaderboard
  // lives in agent-metrics module which is too heavy to inline here.
  const agentIds = (await redis.zRange(K.agentList(), 0, -1).catch(() => [])) as
    | Array<{ member: string }>
    | string[];
  const count = Array.isArray(agentIds) ? agentIds.length : 0;
  return {
    days: args.days,
    verifiedAgentCount: count,
    note: 'Detailed leaderboard available via the Team tab.',
  };
}

const getAISpendSchema = z.object({}).strict();
async function execGetAISpend() {
  const [cents, tokens] = await Promise.all([readMonthlyCents(), readMonthlyTokens()]);
  return {
    monthCents: Number(cents.toFixed(4)),
    monthDollars: Number((cents / 100).toFixed(4)),
    tokensIn: tokens.tokensIn,
    tokensOut: tokens.tokensOut,
    month: today().slice(0, 7),
  };
}

// ---------------------------------------------------------------------------
// Write tool schemas + preview/commit
// ---------------------------------------------------------------------------

const installPipelineSchema = z
  .object({
    templateId: z.string().min(1).max(80),
    instanceName: z.string().min(1).max(120).optional(),
  })
  .strict();

async function previewInstallPipeline(args: z.infer<typeof installPipelineSchema>) {
  const tpl = getPipelineTemplate(args.templateId);
  if (!tpl) return { ok: false as const, error: `Template '${args.templateId}' not found.` };
  return {
    ok: true as const,
    summary: `Install pipeline "${args.instanceName ?? tpl.name}" from template '${tpl.id}'.`,
    template: { id: tpl.id, name: tpl.name, category: tpl.category, kind: tpl.kind },
  };
}
async function commitInstallPipeline(args: z.infer<typeof installPipelineSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  const inst = await installFromTemplate({
    templateId: args.templateId,
    ...(args.instanceName ? { name: args.instanceName } : {}),
  });
  await recordAudit('settings-update', inst.id, { source: 'copilot' });
  return { instanceId: inst.id, name: inst.name, enabled: inst.enabled };
}

const toggleInstanceSchema = z
  .object({ instanceId: z.string().min(1).max(80), enabled: z.boolean() })
  .strict();
async function previewToggleInstance(args: z.infer<typeof toggleInstanceSchema>) {
  const inst = await getInstance(args.instanceId);
  if (!inst) return { ok: false as const, error: `Pipeline '${args.instanceId}' not found.` };
  return {
    ok: true as const,
    summary: `${args.enabled ? 'Enable' : 'Disable'} pipeline "${inst.name}".`,
    currentlyEnabled: inst.enabled,
  };
}
async function commitToggleInstance(args: z.infer<typeof toggleInstanceSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  const updated = await patchInstance(args.instanceId, { enabled: args.enabled });
  await recordAudit('settings-update', args.instanceId, {
    source: 'copilot',
    enabled: args.enabled,
  });
  return { instanceId: args.instanceId, enabled: updated?.enabled ?? args.enabled };
}

const createRuleSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(400).optional(),
    trigger: z.enum(['on-tag-write', 'on-post-create', 'on-comment-create', 'on-status-change']),
    // Free-form conditions — model emits the tree; we only round-trip + validate shape lightly.
    conditions: z.unknown(),
    actions: z.array(z.unknown()).min(1).max(10),
    enabled: z.boolean().optional().default(true),
  })
  .strict();

async function previewCreateRule(args: z.infer<typeof createRuleSchema>) {
  return {
    ok: true as const,
    summary: `Create rule "${args.name}" with ${args.actions.length} action(s), trigger '${args.trigger}'.`,
    enabled: args.enabled ?? true,
  };
}

async function commitCreateRule(args: z.infer<typeof createRuleSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  const now = Date.now();
  const id = `rule_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const rule: Rule = {
    id,
    name: args.name,
    ...(args.description ? { description: args.description } : {}),
    enabled: args.enabled ?? true,
    trigger: args.trigger,
    // Cast — model is trusted to emit a structurally valid ConditionTree.
    conditions: args.conditions as Rule['conditions'],
    actions: args.actions as Action[],
    createdAt: now,
    updatedAt: now,
    fireCount: 0,
  };
  await saveRule(rule);
  await recordAudit('settings-update', id, { source: 'copilot', kind: 'rule-create' });
  return { ruleId: id, name: rule.name };
}

// ── setRuleEnabled ───────────────────────────────────────────────────────
const setRuleEnabledSchema = z
  .object({ ruleId: z.string().min(1).max(80), enabled: z.boolean() })
  .strict();
async function previewSetRuleEnabled(args: z.infer<typeof setRuleEnabledSchema>) {
  const rule = await getRule(args.ruleId);
  if (!rule) return { ok: false as const, error: `Rule '${args.ruleId}' not found.` };
  return {
    ok: true as const,
    summary: `${args.enabled ? 'Enable' : 'Disable'} rule "${rule.name}".`,
    currentlyEnabled: rule.enabled,
  };
}
async function commitSetRuleEnabled(args: z.infer<typeof setRuleEnabledSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  const rule = await getRule(args.ruleId);
  if (!rule) throw new Error(`Rule '${args.ruleId}' not found.`);
  const updated: Rule = { ...rule, enabled: args.enabled, updatedAt: Date.now() };
  await saveRule(updated);
  await recordAudit('settings-update', args.ruleId, {
    source: 'copilot',
    kind: 'rule-toggle',
    enabled: args.enabled,
  });
  return { ruleId: args.ruleId, enabled: args.enabled };
}

// ── installRuleTemplate ──────────────────────────────────────────────────
const installRuleTemplateSchema = z
  .object({
    templateId: z.string().min(1).max(80),
    enabled: z.boolean().optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .strict();
async function previewInstallRuleTemplate(args: z.infer<typeof installRuleTemplateSchema>) {
  const tpl = getRuleTemplate(args.templateId);
  if (!tpl) {
    const known = RULE_TEMPLATES.map((t) => t.templateId).join(', ');
    return {
      ok: false as const,
      error: `Unknown rule template '${args.templateId}'. Available: ${known}`,
    };
  }
  return {
    ok: true as const,
    summary: `Install rule template "${tpl.name}" (${args.enabled === false ? 'disabled' : 'enabled'}) — ${tpl.actions.length} action(s).`,
    whatHappens: tpl.whatHappens,
  };
}
async function commitInstallRuleTemplate(args: z.infer<typeof installRuleTemplateSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  const tpl = getRuleTemplate(args.templateId);
  if (!tpl) throw new Error(`Unknown rule template '${args.templateId}'`);
  const now = Date.now();
  const id = `rule_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const rule: Rule = {
    id,
    name: args.name?.trim() || tpl.name,
    description: tpl.description,
    enabled: args.enabled ?? false,
    trigger: tpl.trigger,
    conditions: tpl.conditions,
    actions: tpl.actions as Action[],
    createdAt: now,
    updatedAt: now,
    fireCount: 0,
  };
  await saveRule(rule);
  await recordAudit('settings-update', id, {
    source: 'copilot',
    kind: 'rule-template-install',
    templateId: args.templateId,
  });
  return { ruleId: id, name: rule.name, fromTemplate: args.templateId };
}

const setPostStatusToolSchema = z
  .object({
    postId: z.string().min(1).max(50),
    status: z.enum(['open', 'in-progress', 'responded', 'resolved']),
  })
  .strict();

async function previewSetPostStatus(args: z.infer<typeof setPostStatusToolSchema>) {
  const meta = await redis.get(K.postMeta(args.postId)).catch(() => null);
  if (!meta) return { ok: false as const, error: `Post '${args.postId}' not found.` };
  const parsed = JSON.parse(meta) as { title?: string };
  return {
    ok: true as const,
    summary: `Set status of "${parsed.title ?? args.postId}" to '${args.status}'.`,
  };
}
async function commitSetPostStatus(args: z.infer<typeof setPostStatusToolSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  const tagRaw = await redis.get(K.postTag(args.postId)).catch(() => null);
  const tag = tagRaw ? JSON.parse(tagRaw) : {};
  tag.status = args.status;
  tag.statusChangedAt = Date.now();
  await redis.set(K.postTag(args.postId), JSON.stringify(tag));
  await recordAudit(args.status === 'resolved' ? 'mark-resolved' : 'mark-open', args.postId, {
    source: 'copilot',
    status: args.status,
  });
  return { postId: args.postId, status: args.status };
}

const approvePostToolSchema = z.object({ postId: z.string().min(1).max(50) }).strict();
async function previewApprovePost(args: z.infer<typeof approvePostToolSchema>) {
  return { ok: true as const, summary: `Approve post ${args.postId}.` };
}
async function commitApprovePost(args: z.infer<typeof approvePostToolSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  try {
    const post = await reddit.getPostById(args.postId as `t3_${string}`);
    await post.approve();
    await recordAudit('mod-approve', args.postId, { source: 'copilot' });
    return { postId: args.postId, approved: true };
  } catch (err) {
    log.warn('copilot: approve failed', { err: String(err), postId: args.postId });
    throw new Error(`Approve failed: ${String(err)}`);
  }
}

const bulkSetStatusToolSchema = z
  .object({
    postIds: z.array(z.string().min(1).max(50)).min(1).max(50),
    status: z.enum(['open', 'in-progress', 'responded', 'resolved']),
  })
  .strict();
async function previewBulkSetStatus(args: z.infer<typeof bulkSetStatusToolSchema>) {
  return {
    ok: true as const,
    summary: `Set status to '${args.status}' on ${args.postIds.length} post(s).`,
  };
}
async function commitBulkSetStatus(args: z.infer<typeof bulkSetStatusToolSchema>) {
  if (!(await requireMod())) throw new Error('mod-only');
  let succeeded = 0;
  for (const id of args.postIds) {
    try {
      await commitSetPostStatus({ postId: id, status: args.status });
      succeeded += 1;
    } catch {
      // continue
    }
  }
  return { succeeded, failed: args.postIds.length - succeeded };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export type ToolSafety = 'read' | 'write';

export interface ReadToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  safety: 'read';
  inputSchema: S;
  execute: (args: z.infer<S>) => Promise<unknown>;
}

export interface WriteToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  safety: 'write';
  inputSchema: S;
  preview: (
    args: z.infer<S>,
  ) => Promise<{ ok: true; summary: string; [k: string]: unknown } | { ok: false; error: string }>;
  commit: (args: z.infer<S>) => Promise<unknown>;
}

// biome-ignore lint/suspicious/noExplicitAny: registry erases per-tool schema generics
type AnyTool = ReadToolDef<any> | WriteToolDef<any>;

export const TOOLS: AnyTool[] = [
  // Read
  {
    name: 'listInstalledPipelines',
    description: 'List all installed pipeline instances (id, name, enabled, kind, trigger).',
    safety: 'read',
    inputSchema: listInstalledPipelinesSchema,
    execute: execListInstalledPipelines,
  },
  {
    name: 'searchPosts',
    description:
      'Search recent posts. Optional filters: query (title substring), driverId, sentiment, status, days (default 7), limit (default 20, max 50).',
    safety: 'read',
    inputSchema: searchPostsSchema,
    execute: execSearchPosts,
  },
  {
    name: 'getPostDetail',
    description: 'Get post metadata, tag, and sentiment by postId.',
    safety: 'read',
    inputSchema: getPostDetailSchema,
    execute: execGetPostDetail,
  },
  {
    name: 'getPipelineSummary',
    description: 'Get details about a single installed pipeline by id.',
    safety: 'read',
    inputSchema: getPipelineSummarySchema,
    execute: execGetPipelineSummary,
  },
  {
    name: 'getAvailableRuleTemplates',
    description:
      'List curated rule templates (id, name, what-happens, category). Use before installRuleTemplate.',
    safety: 'read',
    inputSchema: getAvailableRuleTemplatesSchema,
    execute: execGetAvailableRuleTemplates,
  },
  {
    name: 'getAvailableTemplates',
    description: 'List catalogue pipeline templates the mod can install.',
    safety: 'read',
    inputSchema: getAvailableTemplatesSchema,
    execute: execGetAvailableTemplates,
  },
  {
    name: 'getRecentRules',
    description: 'List automation rules with their fire counts and enable state.',
    safety: 'read',
    inputSchema: getRecentRulesSchema,
    execute: execGetRecentRules,
  },
  {
    name: 'getTeamPerformance',
    description: 'Summary stats on the verified agent team.',
    safety: 'read',
    inputSchema: getTeamPerformanceSchema,
    execute: execGetTeamPerformance,
  },
  {
    name: 'getAISpend',
    description: 'Month-to-date LLM cost + token usage for this installation.',
    safety: 'read',
    inputSchema: getAISpendSchema,
    execute: execGetAISpend,
  },
  // Write
  {
    name: 'installPipeline',
    description: 'Install a pipeline from a template. Requires confirmation.',
    safety: 'write',
    inputSchema: installPipelineSchema,
    preview: previewInstallPipeline,
    commit: commitInstallPipeline,
  },
  {
    name: 'setPipelineEnabled',
    description: 'Enable or disable an installed pipeline. Requires confirmation.',
    safety: 'write',
    inputSchema: toggleInstanceSchema,
    preview: previewToggleInstance,
    commit: commitToggleInstance,
  },
  {
    name: 'createRule',
    description:
      'Create an automation rule. Conditions must be a tree of {op:"and"|"or"|"condition", ...}. Actions match the Action union (tag-post, set-status, send-modmail, etc.).',
    safety: 'write',
    inputSchema: createRuleSchema,
    preview: previewCreateRule,
    commit: commitCreateRule,
  },
  {
    name: 'setRuleEnabled',
    description: 'Enable or disable an existing rule by id. Requires confirmation.',
    safety: 'write',
    inputSchema: setRuleEnabledSchema,
    preview: previewSetRuleEnabled,
    commit: commitSetRuleEnabled,
  },
  {
    name: 'installRuleTemplate',
    description:
      'Install a rule from the curated templates catalogue (e.g. "fraud-permaban", "bug-negative-escalate", "slack-on-fraud"). Use getAvailableRuleTemplates to discover ids. Requires confirmation.',
    safety: 'write',
    inputSchema: installRuleTemplateSchema,
    preview: previewInstallRuleTemplate,
    commit: commitInstallRuleTemplate,
  },
  {
    name: 'setPostStatus',
    description: 'Set a post status to open/in-progress/responded/resolved. Requires confirmation.',
    safety: 'write',
    inputSchema: setPostStatusToolSchema,
    preview: previewSetPostStatus,
    commit: commitSetPostStatus,
  },
  {
    name: 'approvePost',
    description: 'Approve a post in the mod queue. Requires confirmation.',
    safety: 'write',
    inputSchema: approvePostToolSchema,
    preview: previewApprovePost,
    commit: commitApprovePost,
  },
  {
    name: 'bulkSetStatus',
    description: 'Set status on up to 50 posts at once. Requires confirmation.',
    safety: 'write',
    inputSchema: bulkSetStatusToolSchema,
    preview: previewBulkSetStatus,
    commit: commitBulkSetStatus,
  },
];

export function getTool(name: string): AnyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Public catalogue (no executors) — safe to ship to the client. */
export function publicCatalogue(): Array<{
  name: string;
  description: string;
  safety: ToolSafety;
}> {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, safety: t.safety }));
}

// Re-export for tests
export {
  execListInstalledPipelines,
  execSearchPosts,
  execGetPostDetail,
  execGetPipelineSummary,
  execGetAvailableTemplates,
  execGetRecentRules,
  execGetTeamPerformance,
  execGetAISpend,
  previewInstallPipeline,
  previewCreateRule,
};

// suppress unused warnings — listEnabledRules kept for future "enabled-only" tool
void listEnabledRules;
