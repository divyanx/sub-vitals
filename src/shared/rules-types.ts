/**
 * Rules engine — shared types.
 *
 * Rules are the conditional automation layer: WHEN (conditions) THEN (actions).
 * They fire after a pipeline writes a Tag and evaluate whether the new tag
 * satisfies a condition tree; matching rules run their action list sequentially.
 */

export type RuleTrigger =
  | 'on-tag-write'
  | 'on-post-create'
  | 'on-comment-create'
  | 'on-status-change';

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'matches';

export type ConditionField = 'value' | 'confidence' | 'label';

export type ConditionTree =
  | { op: 'and'; children: ConditionTree[] }
  | { op: 'or'; children: ConditionTree[] }
  | {
      op: 'condition';
      pipelineId: string;
      field: ConditionField;
      operator: ConditionOperator;
      value: string | number | boolean;
    };

export type PostStatus = 'open' | 'in-progress' | 'responded' | 'resolved';

export type Action =
  | { type: 'tag-post'; instanceId: string; value: string }
  | { type: 'set-status'; status: PostStatus }
  | { type: 'send-modmail'; subject: string; bodyTemplate: string }
  | { type: 'remove-post'; spam?: boolean }
  | { type: 'remove-comment'; spam?: boolean }
  | { type: 'lock-post' }
  | { type: 'distinguish-comment' }
  | { type: 'approve' }
  | { type: 'escalate'; severity: 'low' | 'medium' | 'high' | 'critical' }
  | { type: 'webhook'; url: string; method?: 'POST' | 'PUT' }
  /**
   * Direct ban. Use sparingly — prefer `ban-if-repeat` so first offenders
   * aren't punished for a single misfire.
   */
  | { type: 'ban-author'; reason: string; message?: string; durationDays?: number }
  /**
   * Conditional ban: only fires when the author has accumulated at least
   * `threshold` matching tags from `pipelineId` within `windowDays`. Each
   * call also records the current tag against the author's counter, so this
   * action is meant to be the LAST step in a spam/fraud rule's action list.
   */
  | {
      type: 'ban-if-repeat';
      pipelineId: string;
      threshold: number;
      windowDays: number;
      reason: string;
      message?: string;
      durationDays?: number;
    }
  | { type: 'audit-only'; note: string };

export interface Rule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions: ConditionTree;
  actions: Action[];
  createdAt: number;
  updatedAt: number;
  fireCount: number;
  lastFiredAt?: number;
}

export interface RuleStats {
  fireCount: number;
  lastFiredAt?: number;
  errorCount: number;
  lastError?: string;
}

/** Context passed to the rule engine when evaluating conditions and running actions. */
export interface RuleContext {
  /** The tag that triggered evaluation (for on-tag-write). */
  tag?: {
    pipelineId: string;
    value: string | number | boolean;
    confidence?: number;
    label?: string;
    targetId: string;
    targetType: 'post' | 'comment';
  };
  /** All current tags for the target, keyed by pipelineId. */
  allTags: Record<
    string,
    { value: string | number | boolean; confidence?: number; label?: string }
  >;
  postId?: string;
  commentId?: string;
  /** Whether this is a dry-run (test mode — no side effects). */
  dryRun?: boolean;
}

/** Result of a dry-run test execution. */
export interface RuleTestResult {
  ruleId: string;
  conditionsMatched: boolean;
  conditionTrace: ConditionTraceNode;
  actions: Array<{
    type: string;
    wouldFire: boolean;
    description: string;
    error?: string;
  }>;
}

export type ConditionTraceNode =
  | { op: 'and' | 'or'; matched: boolean; children: ConditionTraceNode[] }
  | {
      op: 'condition';
      pipelineId: string;
      field: ConditionField;
      operator: ConditionOperator;
      expectedValue: string | number | boolean;
      actualValue: string | number | boolean | undefined;
      matched: boolean;
    };
