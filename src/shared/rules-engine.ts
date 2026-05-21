/**
 * Rules engine — evaluation and action execution.
 *
 * evaluateConditions(tree, ctx)  — recursive boolean eval
 * runActions(actions, ctx)       — sequential action execution with per-action error isolation
 * executeRule(rule, ctx)         — full pipeline: eval → actions → stats
 * firingRules({trigger, ctx})    — returns enabled rules whose conditions evaluate true
 */

import { context, reddit, redis } from '@devvit/web/server';
import type { AuditAction } from '../modules/audit-log/index.js';
import { recordAudit } from '../modules/audit-log/index.js';
import { K } from './keys.js';
import { log } from './log.js';
import { incrementFireCount, listEnabledRules, recordRuleError } from './rules-storage.js';
import type {
  Action,
  ConditionField,
  ConditionOperator,
  ConditionTraceNode,
  ConditionTree,
  Rule,
  RuleContext,
  RuleTestResult,
} from './rules-types.js';
import { setPostStatus } from './storage.js';

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

function renderTemplate(template: string, ctx: RuleContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const k = key.trim();
    if (k === 'tag.value') return String(ctx.tag?.value ?? '');
    if (k === 'tag.confidence') return String(ctx.tag?.confidence ?? '');
    if (k === 'post.id') return ctx.postId ?? '';
    if (k === 'rule.name') return '';
    return '';
  });
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function resolveField(
  field: ConditionField,
  entry: { value: string | number | boolean; confidence?: number; label?: string } | undefined,
): string | number | boolean | undefined {
  if (!entry) return undefined;
  if (field === 'value') return entry.value;
  if (field === 'confidence') return entry.confidence;
  if (field === 'label') return entry.label;
  return undefined;
}

function applyOperator(
  actual: string | number | boolean | undefined,
  op: ConditionOperator,
  expected: string | number | boolean,
): boolean {
  if (actual === undefined) return false;
  switch (op) {
    case 'eq':
      return String(actual).toLowerCase() === String(expected).toLowerCase();
    case 'neq':
      return String(actual).toLowerCase() !== String(expected).toLowerCase();
    case 'gt':
      return Number(actual) > Number(expected);
    case 'gte':
      return Number(actual) >= Number(expected);
    case 'lt':
      return Number(actual) < Number(expected);
    case 'lte':
      return Number(actual) <= Number(expected);
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'matches': {
      try {
        return new RegExp(String(expected), 'i').test(String(actual));
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Recursively evaluate a ConditionTree.
 * Returns true/false (no side effects).
 */
export function evaluateConditions(tree: ConditionTree, ctx: RuleContext): boolean {
  if (tree.op === 'and') {
    return tree.children.every((child) => evaluateConditions(child, ctx));
  } else if (tree.op === 'or') {
    return tree.children.some((child) => evaluateConditions(child, ctx));
  } else {
    // op === 'condition' — TypeScript narrows here via else chain
    const entry = ctx.allTags[tree.pipelineId];
    const actual = resolveField(tree.field, entry);
    return applyOperator(actual, tree.operator, tree.value);
  }
}

/**
 * Build a trace tree alongside evaluation — used by the test endpoint.
 */
export function traceConditions(tree: ConditionTree, ctx: RuleContext): ConditionTraceNode {
  if (tree.op === 'and') {
    const children = tree.children.map((c) => traceConditions(c, ctx));
    const matched = children.every((c) => c.matched);
    return { op: 'and', matched, children };
  } else if (tree.op === 'or') {
    const children = tree.children.map((c) => traceConditions(c, ctx));
    const matched = children.some((c) => c.matched);
    return { op: 'or', matched, children };
  } else {
    // op === 'condition'
    const entry = ctx.allTags[tree.pipelineId];
    const actual = resolveField(tree.field, entry);
    const matched = applyOperator(actual, tree.operator, tree.value);
    return {
      op: 'condition',
      pipelineId: tree.pipelineId,
      field: tree.field,
      operator: tree.operator,
      expectedValue: tree.value,
      actualValue: actual,
      matched,
    };
  }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

/** Execute a single action. Throws on failure (caller isolates per action). */
async function executeAction(action: Action, ctx: RuleContext): Promise<void> {
  if (ctx.dryRun) return; // no side effects in test mode

  const postId = ctx.postId;
  const commentId = ctx.commentId;

  switch (action.type) {
    case 'set-status': {
      if (!postId) return;
      await setPostStatus(postId, action.status, 'rules-engine');
      break;
    }

    case 'send-modmail': {
      try {
        const { context } = await import('@devvit/web/server');
        const subredditName = context.subredditName;
        if (!subredditName) return;
        const body = renderTemplate(action.bodyTemplate, ctx);
        await reddit.modMail.createConversation({
          subredditName,
          subject: action.subject.slice(0, 100),
          body: body.slice(0, 10_000),
          to: subredditName,
          isAuthorHidden: false,
        });
      } catch (err) {
        log.warn('rules-engine: send-modmail failed', { err: String(err) });
        throw err;
      }
      break;
    }

    case 'remove-post': {
      if (!postId) return;
      await reddit.remove(`t3_${postId}` as `t3_${string}`, action.spam ?? false);
      break;
    }

    case 'remove-comment': {
      if (!commentId) return;
      await reddit.remove(`t1_${commentId}` as `t1_${string}`, action.spam ?? false);
      break;
    }

    case 'lock-post': {
      // reddit.lock is not available in this Devvit version — stubbed as audit
      if (!postId) return;
      log.info('rules-engine: lock-post (stubbed — reddit.lock unavailable)', { postId });
      await recordAudit('rule-audit' satisfies AuditAction, postId, { action: 'lock-post' });
      break;
    }

    case 'distinguish-comment': {
      // reddit.distinguish is not available in this Devvit version — stubbed as audit
      if (!commentId) return;
      log.info('rules-engine: distinguish-comment (stubbed — reddit.distinguish unavailable)', {
        commentId,
      });
      await recordAudit('rule-audit' satisfies AuditAction, commentId, {
        action: 'distinguish-comment',
      });
      break;
    }

    case 'approve': {
      if (postId) {
        await reddit.approve(`t3_${postId}` as `t3_${string}`);
      } else if (commentId) {
        await reddit.approve(`t1_${commentId}` as `t1_${string}`);
      }
      break;
    }

    case 'escalate': {
      await recordAudit('rule-audit' satisfies AuditAction, postId ?? commentId ?? null, {
        action: 'escalate',
        severity: action.severity,
        tagValue: ctx.tag?.value,
        pipelineId: ctx.tag?.pipelineId,
      });
      break;
    }

    case 'webhook': {
      try {
        const body = JSON.stringify({
          trigger: 'rule',
          postId,
          commentId,
          tag: ctx.tag,
          ts: Date.now(),
        });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          await fetch(action.url, {
            method: action.method ?? 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        log.warn('rules-engine: webhook action failed', { url: action.url, err: String(err) });
        throw err;
      }
      break;
    }

    case 'tag-post': {
      if (!postId) return;
      const { recordTag } = await import('./tags.js');
      await recordTag({
        pipelineId: action.instanceId,
        targetType: 'post',
        targetId: postId,
        value: action.value,
        by: 'manual',
        createdAt: Date.now(),
      });
      break;
    }

    case 'audit-only': {
      await recordAudit('rule-audit' satisfies AuditAction, postId ?? commentId ?? null, {
        note: action.note,
        tag: ctx.tag,
      });
      break;
    }

    case 'ban-author': {
      const author = await resolveAuthor(ctx);
      const sub = context.subredditName;
      if (!author || !sub) return;
      try {
        await reddit.banUser({
          username: author,
          subredditName: sub,
          reason: action.reason.slice(0, 100),
          ...(action.message ? { message: action.message.slice(0, 1000) } : {}),
          ...(action.durationDays ? { duration: action.durationDays } : {}),
          note: `RedLattice rule ${ctx.tag?.pipelineId ?? ''}`.slice(0, 250),
        });
        await recordAudit('rule-audit' satisfies AuditAction, postId ?? commentId ?? null, {
          action: 'ban-author',
          username: author,
          reason: action.reason,
          durationDays: action.durationDays ?? null,
        });
      } catch (err) {
        // Most common failure: author already banned, or insufficient mod scope.
        log.warn('rules-engine: ban-author failed', { author, err: String(err) });
        throw err;
      }
      break;
    }

    case 'ban-if-repeat': {
      const author = await resolveAuthor(ctx);
      const sub = context.subredditName;
      const targetId = ctx.tag?.targetId ?? postId ?? commentId;
      if (!author || !sub || !targetId) return;

      const key = K.offenderTimeline(action.pipelineId, author);
      const now = Date.now();
      const windowStart = now - action.windowDays * 24 * 60 * 60 * 1000;

      // Record this offense, then count within the window.
      await redis.zAdd(key, { score: now, member: targetId });
      // Trim entries older than the window so the set doesn't grow unbounded.
      await redis.zRemRangeByScore(key, 0, windowStart - 1);
      const count = await redis.zCard(key);

      if (count < action.threshold) {
        log.info('rules-engine: ban-if-repeat below threshold', {
          author,
          pipelineId: action.pipelineId,
          count,
          threshold: action.threshold,
        });
        await recordAudit('rule-audit' satisfies AuditAction, postId ?? commentId ?? null, {
          action: 'ban-if-repeat:count',
          username: author,
          count,
          threshold: action.threshold,
        });
        return;
      }

      try {
        await reddit.banUser({
          username: author,
          subredditName: sub,
          reason: action.reason.slice(0, 100),
          ...(action.message ? { message: action.message.slice(0, 1000) } : {}),
          ...(action.durationDays ? { duration: action.durationDays } : {}),
          note: `RedLattice repeat ${action.pipelineId} (${count} in ${action.windowDays}d)`.slice(
            0,
            250,
          ),
        });
        await recordAudit('rule-audit' satisfies AuditAction, postId ?? commentId ?? null, {
          action: 'ban-if-repeat:banned',
          username: author,
          count,
          threshold: action.threshold,
          pipelineId: action.pipelineId,
        });
      } catch (err) {
        log.warn('rules-engine: ban-if-repeat ban failed', { author, err: String(err) });
        throw err;
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Best-effort author lookup. Rule context carries postId/commentId but not
 * authorName; we resolve it from Reddit on demand. Cheap because the post is
 * cached for the duration of this trigger.
 */
async function resolveAuthor(ctx: RuleContext): Promise<string | null> {
  try {
    if (ctx.commentId) {
      const c = await reddit.getCommentById(`t1_${ctx.commentId}` as `t1_${string}`);
      return c.authorName ?? null;
    }
    if (ctx.postId) {
      const p = await reddit.getPostById(`t3_${ctx.postId}` as `t3_${string}`);
      return p.authorName ?? null;
    }
  } catch (err) {
    log.warn('rules-engine: resolveAuthor failed', { err: String(err) });
  }
  return null;
}

/** Describe what an action would do (for dry-run output). */
function describeAction(action: Action): string {
  switch (action.type) {
    case 'set-status':
      return `Set post status to "${action.status}"`;
    case 'send-modmail':
      return `Send modmail: "${action.subject}"`;
    case 'remove-post':
      return `Remove post${action.spam ? ' (spam)' : ''}`;
    case 'remove-comment':
      return `Remove comment${action.spam ? ' (spam)' : ''}`;
    case 'lock-post':
      return 'Lock post';
    case 'distinguish-comment':
      return 'Distinguish comment';
    case 'approve':
      return 'Approve content';
    case 'escalate':
      return `Escalate with severity "${action.severity}"`;
    case 'webhook':
      return `Webhook ${action.method ?? 'POST'} ${action.url}`;
    case 'tag-post':
      return `Tag post via pipeline "${action.instanceId}" with value "${action.value}"`;
    case 'audit-only':
      return `Audit-only: ${action.note}`;
    case 'ban-author':
      return `Ban author${action.durationDays ? ` for ${action.durationDays}d` : ' permanently'} — "${action.reason}"`;
    case 'ban-if-repeat':
      return `Ban author if ${action.pipelineId} fires ${action.threshold}+ times in ${action.windowDays}d`;
    default:
      return 'Unknown action';
  }
}

/**
 * Run all actions for a rule sequentially.
 * Per-action errors are caught and logged — one failing action does not
 * prevent subsequent actions.
 */
export async function runActions(
  actions: Action[],
  ctx: RuleContext,
  ruleId: string,
): Promise<Array<{ type: string; wouldFire: boolean; description: string; error?: string }>> {
  const results: Array<{ type: string; wouldFire: boolean; description: string; error?: string }> =
    [];

  for (const action of actions) {
    const desc = describeAction(action);
    if (ctx.dryRun) {
      results.push({ type: action.type, wouldFire: true, description: desc });
      continue;
    }
    try {
      await executeAction(action, ctx);
      results.push({ type: action.type, wouldFire: true, description: desc });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('rules-engine: action failed', {
        ruleId,
        actionType: action.type,
        err: msg,
      });
      await recordRuleError(ruleId, `action:${action.type}: ${msg}`);
      results.push({ type: action.type, wouldFire: false, description: desc, error: msg });
    }
  }
  return results;
}

/**
 * Full rule execution: evaluate conditions → run matching actions → update stats.
 */
export async function executeRule(rule: Rule, ctx: RuleContext): Promise<void> {
  if (!evaluateConditions(rule.conditions, ctx)) return;

  log.info('rules-engine: rule fired', { ruleId: rule.id, name: rule.name });

  try {
    await runActions(rule.actions, ctx, rule.id);
  } catch {
    // runActions already catches per-action errors; this catch is belt-and-suspenders.
  }

  if (!ctx.dryRun) {
    await incrementFireCount(rule.id);
  }
}

/**
 * Dry-run: evaluate conditions + describe what actions would fire.
 * Does NOT execute any side effects.
 */
export async function testRule(rule: Rule, ctx: RuleContext): Promise<RuleTestResult> {
  const dryCtx: RuleContext = { ...ctx, dryRun: true };
  const trace = traceConditions(rule.conditions, dryCtx);
  const conditionsMatched = trace.matched;
  const actionResults = conditionsMatched
    ? await runActions(rule.actions, dryCtx, rule.id)
    : rule.actions.map((a) => ({
        type: a.type,
        wouldFire: false,
        description: describeAction(a),
      }));

  return {
    ruleId: rule.id,
    conditionsMatched,
    conditionTrace: trace,
    actions: actionResults,
  };
}

/**
 * Return all enabled rules whose trigger matches and whose conditions evaluate true.
 */
export async function firingRules(opts: {
  trigger: Rule['trigger'];
  ctx: RuleContext;
}): Promise<Rule[]> {
  const enabled = await listEnabledRules();
  const matching: Rule[] = [];
  for (const rule of enabled) {
    if (rule.trigger !== opts.trigger) continue;
    if (evaluateConditions(rule.conditions, opts.ctx)) {
      matching.push(rule);
    }
  }
  return matching;
}

/**
 * Hook called by the tag system after a tag is written.
 * Fans out to all matching on-tag-write rules with failure isolation.
 */
export async function onTagWrite(tag: {
  pipelineId: string;
  value: string | number | boolean;
  confidence?: number;
  targetId: string;
  targetType: 'post' | 'comment';
}): Promise<void> {
  try {
    const tagEntry = {
      value: tag.value,
      ...(tag.confidence !== undefined ? { confidence: tag.confidence } : {}),
      ...(typeof tag.value === 'string' ? { label: tag.value } : {}),
    };

    const ctx: RuleContext = {
      tag: {
        pipelineId: tag.pipelineId,
        value: tag.value,
        ...(tag.confidence !== undefined ? { confidence: tag.confidence } : {}),
        ...(typeof tag.value === 'string' ? { label: tag.value } : {}),
        targetId: tag.targetId,
        targetType: tag.targetType,
      },
      allTags: { [tag.pipelineId]: tagEntry },
      ...(tag.targetType === 'post' ? { postId: tag.targetId } : { commentId: tag.targetId }),
    };

    const enabled = await listEnabledRules();
    const matching = enabled.filter((r) => {
      if (r.trigger !== 'on-tag-write') return false;
      return evaluateConditions(r.conditions, ctx);
    });

    await Promise.allSettled(
      matching.map(async (rule) => {
        try {
          await runActions(rule.actions, ctx, rule.id);
          await incrementFireCount(rule.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error('rules-engine: rule execution error', { ruleId: rule.id, err: msg });
          await recordRuleError(rule.id, msg);
        }
      }),
    );
  } catch (err) {
    // Never throw from the dispatcher hook — fail gracefully.
    log.warn('rules-engine: onTagWrite threw (non-fatal)', { err: String(err) });
  }
}
