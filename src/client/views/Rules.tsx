/**
 * Rules tab — list and builder for conditional automation rules.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { RuleCategory, RuleTemplate } from '../../shared/rules-templates.js';
import type {
  Action,
  ConditionField,
  ConditionOperator,
  ConditionTree,
  PostStatus,
  Rule,
  RuleContext,
  RuleTestResult,
  RuleTrigger,
} from '../../shared/rules-types.js';
import { Button } from '../components/ui/index.ts';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchRules(): Promise<{ count: number; rules: Rule[] }> {
  const res = await fetch('/api/rules');
  if (!res.ok) throw new Error('Failed to fetch rules');
  return res.json() as Promise<{ count: number; rules: Rule[] }>;
}

async function createRule(
  body: Omit<Rule, 'id' | 'createdAt' | 'updatedAt' | 'fireCount'>,
): Promise<{ rule: Rule }> {
  const res = await fetch('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error ?? 'Failed to create rule');
  }
  return res.json() as Promise<{ rule: Rule }>;
}

async function updateRule(id: string, body: Partial<Rule>): Promise<{ rule: Rule }> {
  const res = await fetch(`/api/rules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to update rule');
  return res.json() as Promise<{ rule: Rule }>;
}

async function deleteRuleApi(id: string): Promise<void> {
  await fetch(`/api/rules/${id}`, { method: 'DELETE' });
}

async function toggleRule(id: string): Promise<{ rule: Rule }> {
  const res = await fetch(`/api/rules/${id}/toggle`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to toggle rule');
  return res.json() as Promise<{ rule: Rule }>;
}

async function fetchRuleTemplates(): Promise<{ count: number; templates: RuleTemplate[] }> {
  const res = await fetch('/api/rules/templates');
  if (!res.ok) throw new Error('Failed to fetch rule templates');
  return res.json() as Promise<{ count: number; templates: RuleTemplate[] }>;
}

async function installRuleTemplate(
  templateId: string,
  opts?: { enabled?: boolean; name?: string },
): Promise<{ rule: Rule; fromTemplate: string }> {
  const res = await fetch('/api/rules/install-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, ...(opts ?? {}) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? 'Failed to install template');
  }
  return res.json() as Promise<{ rule: Rule; fromTemplate: string }>;
}

async function testRuleApi(
  id: string,
  ctx: { sampleTags?: RuleContext['allTags']; postId?: string },
): Promise<RuleTestResult> {
  const res = await fetch(`/api/rules/${id}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ctx),
  });
  if (!res.ok) throw new Error('Failed to test rule');
  return res.json() as Promise<RuleTestResult>;
}

// ---------------------------------------------------------------------------
// Rule row
// ---------------------------------------------------------------------------

/**
 * Render the rule as a compact horizontal flow chip:
 *   [trigger] → [conditions] → [actions]
 * This turns the JSON shape into something a mod can read in 2 seconds.
 */
function summarizeConditions(tree: ConditionTree): string {
  if (tree.op === 'condition') {
    const v =
      typeof tree.value === 'boolean'
        ? String(tree.value)
        : typeof tree.value === 'number'
          ? String(tree.value)
          : `"${tree.value}"`;
    return `${tree.pipelineId}.${tree.field} ${tree.operator} ${v}`;
  }
  const sep = tree.op === 'and' ? ' & ' : ' | ';
  return tree.children.map(summarizeConditions).join(sep);
}

function summarizeAction(action: Action): string {
  switch (action.type) {
    case 'remove-post':
      return action.spam ? 'remove (spam)' : 'remove';
    case 'remove-comment':
      return action.spam ? 'remove cmt (spam)' : 'remove cmt';
    case 'send-modmail':
      return 'modmail';
    case 'set-status':
      return `→ ${action.status}`;
    case 'lock-post':
      return 'lock';
    case 'distinguish-comment':
      return 'distinguish';
    case 'approve':
      return 'approve';
    case 'escalate':
      return `escalate (${action.severity})`;
    case 'webhook':
      return 'webhook';
    case 'tag-post':
      return `tag ${action.instanceId}`;
    case 'ban-author':
      return action.durationDays ? `ban ${action.durationDays}d` : 'permaban';
    case 'ban-if-repeat':
      return `ban-if ${action.threshold}/${action.windowDays}d`;
    case 'audit-only':
      return 'audit';
    default:
      return 'action';
  }
}

function RuleFlow({ rule }: { rule: Rule }) {
  const conditionSummary = summarizeConditions(rule.conditions);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[length:var(--t-xs)]">
      <span className="rounded-[var(--r-1)] bg-[var(--n-3)] px-2 py-0.5 font-mono text-[var(--n-9)]">
        {rule.trigger}
      </span>
      <span className="text-[var(--n-7)]" aria-hidden="true">
        →
      </span>
      <span
        className="max-w-[420px] truncate rounded-[var(--r-1)] bg-[var(--n-3)] px-2 py-0.5 font-mono text-[var(--n-11)]"
        title={conditionSummary}
      >
        {conditionSummary}
      </span>
      <span className="text-[var(--n-7)]" aria-hidden="true">
        →
      </span>
      {rule.actions.length === 0 ? (
        <span className="rounded-[var(--r-1)] bg-[var(--n-3)] px-2 py-0.5 italic text-[var(--n-8)]">
          no actions
        </span>
      ) : (
        rule.actions.map((a, i) => (
          <span
            key={i}
            className="rounded-[var(--r-1)] bg-[var(--accent-3)] px-2 py-0.5 font-mono text-[var(--accent-11)]"
          >
            {summarizeAction(a)}
          </span>
        ))
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
  onTest,
}: {
  rule: Rule;
  onEdit: (r: Rule) => void;
  onDuplicate: (r: Rule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onTest: (r: Rule) => void;
}) {
  return (
    <div
      data-testid={`rule-row-${rule.id}`}
      className="flex flex-col gap-3 rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-3 transition hover:border-[var(--accent-9)] shadow-[var(--shadow-1)] sm:flex-row sm:items-center"
    >
      {/* Enabled toggle */}
      <button
        type="button"
        aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
        onClick={() => onToggle(rule.id)}
        className={`relative h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] ${rule.enabled ? 'bg-[var(--accent-9)]' : 'bg-[var(--n-5)]'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>

      {/* Name + flow */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[length:var(--t-sm)] font-medium text-[var(--n-12)]">
          {rule.name}
        </p>
        {rule.description && (
          <p className="mb-1.5 truncate text-[length:var(--t-xs)] text-[var(--n-8)]">
            {rule.description}
          </p>
        )}
        <RuleFlow rule={rule} />
      </div>

      {/* Stats */}
      <div className="hidden text-right sm:block">
        <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">{rule.fireCount ?? 0} fires</p>
        {rule.lastFiredAt && (
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
            {new Date(rule.lastFiredAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => onTest(rule)}>
          Test
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(rule)}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDuplicate(rule)}>
          Dup
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(rule.id)}>
          Del
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default condition / action builders
// ---------------------------------------------------------------------------

function defaultCondition(): ConditionTree {
  return {
    op: 'condition',
    pipelineId: 'sentiment',
    field: 'value',
    operator: 'eq',
    value: 'negative',
  };
}

function defaultAction(): Action {
  return { type: 'audit-only', note: 'Rule fired' };
}

// ---------------------------------------------------------------------------
// Condition editor (single leaf)
// ---------------------------------------------------------------------------

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'contains' },
  { value: 'matches', label: 'matches (regex)' },
];

const FIELDS: { value: ConditionField; label: string }[] = [
  { value: 'value', label: 'value' },
  { value: 'confidence', label: 'confidence' },
  { value: 'label', label: 'label' },
];

function ConditionLeafEditor({
  node,
  onChange,
  onRemove,
}: {
  node: Extract<ConditionTree, { op: 'condition' }>;
  onChange: (n: ConditionTree) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--n-4)] bg-[var(--n-1)] p-2">
      <input
        type="text"
        aria-label="Pipeline ID"
        placeholder="pipeline-id"
        value={node.pipelineId}
        onChange={(e) => onChange({ ...node, pipelineId: e.target.value })}
        className="w-32 rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
      />
      <select
        aria-label="Field"
        value={node.field}
        onChange={(e) => onChange({ ...node, field: e.target.value as ConditionField })}
        className="rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none"
      >
        {FIELDS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Operator"
        value={node.operator}
        onChange={(e) => onChange({ ...node, operator: e.target.value as ConditionOperator })}
        className="rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none"
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        aria-label="Expected value"
        placeholder="value"
        value={String(node.value)}
        onChange={(e) => onChange({ ...node, value: e.target.value })}
        className="w-28 rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
      />
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto text-[length:var(--t-xs)] text-[var(--error-11)] hover:text-[var(--error-9)]"
        aria-label="Remove condition"
      >
        Remove
      </button>
    </div>
  );
}

function ConditionGroupEditor({
  node,
  onChange,
  onRemove,
  depth,
}: {
  node: Extract<ConditionTree, { op: 'and' | 'or' }>;
  onChange: (n: ConditionTree) => void;
  onRemove: () => void;
  depth: number;
}) {
  const updateChild = (i: number, child: ConditionTree) => {
    const children = [...node.children];
    children[i] = child;
    onChange({ ...node, children });
  };
  const removeChild = (i: number) => {
    const children = node.children.filter((_, idx) => idx !== i);
    onChange({ ...node, children });
  };
  const addCondition = () => {
    onChange({ ...node, children: [...node.children, defaultCondition()] });
  };
  const addGroup = () => {
    onChange({
      ...node,
      children: [...node.children, { op: 'and', children: [defaultCondition()] } as ConditionTree],
    });
  };

  return (
    <div className={`rounded border border-[var(--n-4)] p-2 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="mb-2 flex items-center gap-2">
        <select
          aria-label="Group operator"
          value={node.op}
          onChange={(e) => onChange({ ...node, op: e.target.value as 'and' | 'or' })}
          className="rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] font-bold text-[var(--n-11)] focus:outline-none"
        >
          <option value="and">AND (all must match)</option>
          <option value="or">OR (any must match)</option>
        </select>
        {depth > 0 && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto text-[length:var(--t-xs)] text-[var(--error-11)] hover:text-[var(--error-9)]"
          >
            Remove group
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {node.children.map((child, i) =>
          child.op === 'condition' ? (
            <ConditionLeafEditor
              key={i}
              node={child}
              onChange={(n) => updateChild(i, n)}
              onRemove={() => removeChild(i)}
            />
          ) : (
            <ConditionGroupEditor
              key={i}
              node={child as Extract<ConditionTree, { op: 'and' | 'or' }>}
              onChange={(n) => updateChild(i, n)}
              onRemove={() => removeChild(i)}
              depth={depth + 1}
            />
          ),
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={addCondition}
          className="rounded border border-[var(--n-4)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-8)] hover:text-[var(--n-11)]"
        >
          + Add condition
        </button>
        {depth < 3 && (
          <button
            type="button"
            onClick={addGroup}
            className="rounded border border-[var(--n-4)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-8)] hover:text-[var(--n-11)]"
          >
            + Group (AND/OR)
          </button>
        )}
      </div>
    </div>
  );
}

function ConditionEditor({
  tree,
  onChange,
}: {
  tree: ConditionTree;
  onChange: (t: ConditionTree) => void;
}) {
  if (tree.op === 'condition') {
    return (
      <div>
        <div className="mb-2">
          <button
            type="button"
            onClick={() => onChange({ op: 'and', children: [tree] })}
            className="rounded border border-[var(--n-4)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-8)] hover:text-[var(--n-11)]"
          >
            Wrap in group
          </button>
        </div>
        <ConditionLeafEditor node={tree} onChange={onChange} onRemove={() => {}} />
      </div>
    );
  }
  return (
    <ConditionGroupEditor
      node={tree as Extract<ConditionTree, { op: 'and' | 'or' }>}
      onChange={onChange}
      onRemove={() => {}}
      depth={0}
    />
  );
}

// ---------------------------------------------------------------------------
// Action editor
// ---------------------------------------------------------------------------

const ACTION_TYPES: { value: Action['type']; label: string }[] = [
  { value: 'audit-only', label: 'Audit only (no public action)' },
  { value: 'set-status', label: 'Set post status' },
  { value: 'send-modmail', label: 'Send modmail' },
  { value: 'remove-post', label: 'Remove post' },
  { value: 'remove-comment', label: 'Remove comment' },
  { value: 'lock-post', label: 'Lock post' },
  { value: 'distinguish-comment', label: 'Distinguish comment' },
  { value: 'approve', label: 'Approve content' },
  { value: 'escalate', label: 'Escalate' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'tag-post', label: 'Tag post' },
  { value: 'ban-author', label: 'Ban author' },
  { value: 'ban-if-repeat', label: 'Ban author if repeat offender' },
];

function ActionEditor({
  action,
  index,
  onChange,
  onRemove,
}: {
  action: Action;
  index: number;
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
  const changeType = (type: Action['type']) => {
    const defaults: Record<Action['type'], Action> = {
      'audit-only': { type: 'audit-only', note: '' },
      'set-status': { type: 'set-status', status: 'in-progress' },
      'send-modmail': { type: 'send-modmail', subject: '', bodyTemplate: '' },
      'remove-post': { type: 'remove-post', spam: false },
      'remove-comment': { type: 'remove-comment', spam: false },
      'lock-post': { type: 'lock-post' },
      'distinguish-comment': { type: 'distinguish-comment' },
      approve: { type: 'approve' },
      escalate: { type: 'escalate', severity: 'medium' },
      webhook: { type: 'webhook', url: 'https://', method: 'POST' },
      'tag-post': { type: 'tag-post', instanceId: '', value: '' },
      'ban-author': { type: 'ban-author', reason: 'Violation of community rules' },
      'ban-if-repeat': {
        type: 'ban-if-repeat',
        pipelineId: '',
        threshold: 3,
        windowDays: 30,
        reason: 'Repeat offender',
      },
    };
    onChange(defaults[type]);
  };

  return (
    <div className="rounded border border-[var(--n-4)] bg-[var(--n-1)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[length:var(--t-xs)] font-medium text-[var(--n-8)]">
          Action {index + 1}
        </span>
        <select
          aria-label={`Action ${index + 1} type`}
          value={action.type}
          onChange={(e) => changeType(e.target.value as Action['type'])}
          className="flex-1 rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none"
        >
          {ACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRemove}
          className="text-[length:var(--t-xs)] text-[var(--error-11)] hover:text-[var(--error-9)]"
          aria-label={`Remove action ${index + 1}`}
        >
          Remove
        </button>
      </div>

      {/* Action-specific fields */}
      {action.type === 'audit-only' && (
        <input
          type="text"
          aria-label="Note"
          placeholder="Note for audit log"
          value={action.note}
          onChange={(e) => onChange({ ...action, note: e.target.value })}
          className="w-full rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
        />
      )}
      {action.type === 'set-status' && (
        <select
          aria-label="Status"
          value={action.status}
          onChange={(e) => onChange({ ...action, status: e.target.value as PostStatus })}
          className="rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none"
        >
          {(['open', 'in-progress', 'responded', 'resolved'] as PostStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      {action.type === 'send-modmail' && (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            aria-label="Subject"
            placeholder="Subject"
            value={action.subject}
            onChange={(e) => onChange({ ...action, subject: e.target.value })}
            className="w-full rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
          />
          <textarea
            aria-label="Body template"
            placeholder="Body — use {{post.id}}, {{tag.value}}, {{tag.confidence}}"
            value={action.bodyTemplate}
            onChange={(e) => onChange({ ...action, bodyTemplate: e.target.value })}
            rows={3}
            className="w-full rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
          />
        </div>
      )}
      {(action.type === 'remove-post' || action.type === 'remove-comment') && (
        <label className="flex items-center gap-2 text-[length:var(--t-xs)] text-[var(--n-8)]">
          <input
            type="checkbox"
            checked={action.spam ?? false}
            onChange={(e) => onChange({ ...action, spam: e.target.checked })}
            className="rounded"
          />
          Mark as spam
        </label>
      )}
      {action.type === 'escalate' && (
        <select
          aria-label="Severity"
          value={action.severity}
          onChange={(e) =>
            onChange({
              ...action,
              severity: e.target.value as 'low' | 'medium' | 'high' | 'critical',
            })
          }
          className="rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none"
        >
          {(['low', 'medium', 'high', 'critical'] as const).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      {action.type === 'webhook' && (
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="Webhook URL"
            placeholder="https://..."
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            className="flex-1 rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
          />
          <select
            aria-label="HTTP method"
            value={action.method ?? 'POST'}
            onChange={(e) => onChange({ ...action, method: e.target.value as 'POST' | 'PUT' })}
            className="rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none"
          >
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
      )}
      {action.type === 'tag-post' && (
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="Pipeline instance ID"
            placeholder="pipeline-id"
            value={action.instanceId}
            onChange={(e) => onChange({ ...action, instanceId: e.target.value })}
            className="w-32 rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
          />
          <input
            type="text"
            aria-label="Tag value"
            placeholder="value"
            value={action.value}
            onChange={(e) => onChange({ ...action, value: e.target.value })}
            className="w-24 rounded border border-[var(--n-4)] bg-[var(--n-2)] px-2 py-1 text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule builder modal
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4;

interface BuilderState {
  name: string;
  description: string;
  trigger: RuleTrigger;
  conditions: ConditionTree;
  actions: Action[];
  enabled: boolean;
}

function defaultBuilderState(): BuilderState {
  return {
    name: '',
    description: '',
    trigger: 'on-tag-write',
    conditions: { op: 'and', children: [defaultCondition()] },
    actions: [defaultAction()],
    enabled: false,
  };
}

function RuleBuilderModal({
  initial,
  editId,
  onClose,
  onSaved,
}: {
  initial?: BuilderState;
  editId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [state, setState] = useState<BuilderState>(initial ?? defaultBuilderState());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!editId;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (isEdit) {
        await updateRule(editId, state);
      } else {
        await createRule(state);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const updateActions = (i: number, a: Action) => {
    const actions = [...state.actions];
    actions[i] = a;
    setState({ ...state, actions });
  };
  const removeAction = (i: number) => {
    setState({ ...state, actions: state.actions.filter((_, idx) => idx !== i) });
  };
  const addAction = () => {
    setState({ ...state, actions: [...state.actions, defaultAction()] });
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard ESC handled by Escape button inside modal
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit rule' : 'New rule'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] shadow-[var(--shadow-3)]"
        data-testid="rule-builder-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--n-4)] px-6 py-4">
          <h2 className="text-[length:var(--t-base)] font-semibold text-[var(--n-11)]">
            {isEdit ? 'Edit rule' : 'New rule'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--n-8)] hover:text-[var(--n-11)]"
            aria-label="Close"
          >
            x
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex border-b border-[var(--n-4)] px-6">
          {([1, 2, 3, 4] as Step[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              className={`-mb-px border-b-2 px-4 py-2 text-[length:var(--t-xs)] font-medium transition ${
                step === s
                  ? 'border-[var(--accent-9)] text-[var(--n-12)]'
                  : 'border-transparent text-[var(--n-8)] hover:text-[var(--n-11)]'
              }`}
            >
              {s === 1 ? 'Name' : s === 2 ? 'Trigger' : s === 3 ? 'Conditions' : 'Actions'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="rule-name"
                  className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
                >
                  Name <span className="text-[var(--error-11)]">*</span>
                </label>
                <input
                  id="rule-name"
                  type="text"
                  data-testid="rule-name-input"
                  placeholder="Rule name"
                  value={state.name}
                  onChange={(e) => setState({ ...state, name: e.target.value })}
                  className="w-full rounded border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 text-[length:var(--t-sm)] text-[var(--n-11)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
                />
              </div>
              <div>
                <label
                  htmlFor="rule-desc"
                  className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
                >
                  Description
                </label>
                <textarea
                  id="rule-desc"
                  placeholder="What does this rule do?"
                  value={state.description}
                  onChange={(e) => setState({ ...state, description: e.target.value })}
                  rows={3}
                  className="w-full rounded border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 text-[length:var(--t-sm)] text-[var(--n-11)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]"
                />
              </div>
              <label className="flex items-center gap-2 text-[length:var(--t-sm)] text-[var(--n-11)]">
                <input
                  type="checkbox"
                  checked={state.enabled}
                  onChange={(e) => setState({ ...state, enabled: e.target.checked })}
                  className="rounded"
                />
                Enable immediately
              </label>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="mb-2 text-[length:var(--t-xs)] font-medium text-[var(--n-11)]">
                Trigger
              </p>
              <div className="flex flex-col gap-2">
                {(
                  [
                    {
                      value: 'on-tag-write',
                      label: 'On tag write',
                      desc: 'Fires whenever a pipeline writes a tag to a post or comment.',
                    },
                    {
                      value: 'on-post-create',
                      label: 'On post create',
                      desc: 'Fires when a new post is created in the subreddit.',
                    },
                    {
                      value: 'on-comment-create',
                      label: 'On comment create',
                      desc: 'Fires when a new comment is created.',
                    },
                    {
                      value: 'on-status-change',
                      label: 'On status change',
                      desc: 'Fires when a post status changes.',
                    },
                  ] as { value: RuleTrigger; label: string; desc: string }[]
                ).map((t) => (
                  <label
                    key={t.value}
                    className={`flex cursor-pointer flex-col rounded-[var(--r-2)] border p-3 transition ${
                      state.trigger === t.value
                        ? 'border-[var(--accent-9)] bg-[var(--accent-3)]'
                        : 'border-[var(--n-4)] hover:border-[var(--accent-9)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="trigger"
                        value={t.value}
                        checked={state.trigger === t.value}
                        onChange={() => setState({ ...state, trigger: t.value })}
                        className="accent-[var(--accent-9)]"
                      />
                      <span className="text-[length:var(--t-sm)] font-medium text-[var(--n-11)]">
                        {t.label}
                      </span>
                    </div>
                    <p className="mt-1 pl-5 text-[length:var(--t-xs)] text-[var(--n-8)]">
                      {t.desc}
                    </p>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <p className="mb-3 text-[length:var(--t-xs)] text-[var(--n-8)]">
                Conditions evaluate against pipeline tags on the target content.
              </p>
              <ConditionEditor
                tree={state.conditions}
                onChange={(conditions) => setState({ ...state, conditions })}
              />
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3">
              <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
                Actions run sequentially. One failing action does not block the rest.
              </p>
              {state.actions.map((action, i) => (
                <ActionEditor
                  key={i}
                  action={action}
                  index={i}
                  onChange={(a) => updateActions(i, a)}
                  onRemove={() => removeAction(i)}
                />
              ))}
              <button
                type="button"
                onClick={addAction}
                className="flex items-center gap-1 rounded-[var(--r-2)] border border-dashed border-[var(--n-4)] px-3 py-2 text-[length:var(--t-xs)] text-[var(--n-8)] transition hover:border-[var(--accent-9)] hover:text-[var(--n-11)]"
              >
                + Add action
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {error && (
          <p className="border-t border-[var(--n-4)] px-6 py-2 text-[length:var(--t-xs)] text-[var(--error-11)]">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between border-t border-[var(--n-4)] px-6 py-4">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
              disabled={step === 1}
            >
              Back
            </Button>
            {step < 4 && (
              <Button
                variant="primary"
                size="sm"
                data-testid="rule-builder-next"
                onClick={() => setStep((s) => (s + 1) as Step)}
              >
                Next
              </Button>
            )}
          </div>
          {step === 4 && (
            <Button
              variant="primary"
              size="sm"
              data-testid="rule-builder-save"
              onClick={handleSave}
              disabled={saving || !state.name.trim() || state.actions.length === 0}
              isLoading={saving}
            >
              {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create rule'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test modal
// ---------------------------------------------------------------------------

function TestModal({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const [tags, setTags] = useState('{}');
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setLoading(true);
    setError(null);
    try {
      const sampleTags = JSON.parse(tags) as RuleContext['allTags'];
      const res = await testRuleApi(rule.id, { sampleTags });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard ESC handled by close button inside modal
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Test rule: ${rule.name}`}
      data-testid="rule-test-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] shadow-[var(--shadow-3)]">
        <div className="flex items-center justify-between border-b border-[var(--n-4)] px-6 py-4">
          <h2 className="text-[length:var(--t-base)] font-semibold text-[var(--n-11)]">
            Test: {rule.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--n-8)] hover:text-[var(--n-11)]"
          >
            x
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <label
            htmlFor="test-modal-tags"
            className="mb-1 block text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
          >
            Sample tags (JSON object: pipelineId -&gt; {'{value, confidence, label}'})
          </label>
          <textarea
            id="test-modal-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            rows={6}
            className="mb-3 w-full rounded border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-2 font-mono text-[length:var(--t-xs)] text-[var(--n-11)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-9)]"
            placeholder='{"sentiment": {"value": "negative", "confidence": 0.9}}'
          />
          {error && (
            <p className="mb-2 text-[length:var(--t-xs)] text-[var(--error-11)]">{error}</p>
          )}
          {result && (
            <div className="mt-2 rounded border border-[var(--n-4)] bg-[var(--n-2)] p-3 text-[length:var(--t-xs)]">
              <p
                className={`mb-2 font-semibold ${result.conditionsMatched ? 'text-[var(--success-11)]' : 'text-[var(--n-8)]'}`}
              >
                Conditions: {result.conditionsMatched ? 'MATCHED' : 'did not match'}
              </p>
              <div className="mb-2">
                <p className="mb-1 font-medium text-[var(--n-11)]">Actions that would fire:</p>
                {result.actions.map((a, i) => (
                  <div
                    key={i}
                    className={`mb-1 flex items-start gap-2 ${a.wouldFire ? 'text-[var(--n-11)]' : 'text-[var(--n-8)] line-through'}`}
                  >
                    <span>{a.wouldFire ? '✓' : '–'}</span>
                    <span>{a.description}</span>
                    {a.error && <span className="text-[var(--error-11)]">({a.error})</span>}
                  </div>
                ))}
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-[var(--n-8)] hover:text-[var(--n-11)]">
                  Condition trace
                </summary>
                <pre className="mt-1 overflow-x-auto rounded-[var(--r-1)] bg-[var(--n-3)] p-2 text-[10px] text-[var(--n-8)]">
                  {JSON.stringify(result.conditionTrace, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-[var(--n-4)] px-6 py-4">
          <button
            type="button"
            onClick={runTest}
            disabled={loading}
            className="rounded-[var(--r-2)] bg-[var(--accent-9)] px-4 py-1.5 text-[length:var(--t-xs)] font-medium text-white hover:bg-[var(--accent-10)] disabled:opacity-40"
          >
            {loading ? 'Running...' : 'Run test'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Rules tab
// ---------------------------------------------------------------------------

/**
 * Rule templates catalogue modal. Browse a curated set of pre-built rules
 * (safety, triage, engagement, enforcement, integrations) and install one
 * with a single click. Installed disabled-by-default so mods can review +
 * tweak (especially webhook URLs) before activating.
 */
function TemplatePicker({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['rule-templates'],
    queryFn: fetchRuleTemplates,
  });
  const [filter, setFilter] = useState<RuleCategory | 'all'>('all');
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [justInstalled, setJustInstalled] = useState<string | null>(null);

  const installMut = useMutation({
    mutationFn: (templateId: string) => installRuleTemplate(templateId, { enabled: false }),
    onMutate: (templateId) => setInstallingId(templateId),
    onSuccess: (_data, templateId) => {
      setInstallingId(null);
      setJustInstalled(templateId);
      void qc.invalidateQueries({ queryKey: ['rules'] });
      setTimeout(() => setJustInstalled(null), 2500);
    },
    onError: () => setInstallingId(null),
  });

  const templates = data?.templates ?? [];
  const filtered = useMemo(
    () => (filter === 'all' ? templates : templates.filter((t) => t.category === filter)),
    [templates, filter],
  );

  const categories: { id: RuleCategory | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'safety', label: 'Safety' },
    { id: 'triage', label: 'Triage' },
    { id: 'engagement', label: 'Engagement' },
    { id: 'enforcement', label: 'Enforcement' },
    { id: 'integration', label: 'Integrations' },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Browse rule templates"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-[var(--r-4)] border border-[var(--n-4)] bg-[var(--n-1)] shadow-[var(--shadow-3)]">
        <div className="flex items-center justify-between border-b border-[var(--n-4)] px-5 py-4">
          <div>
            <h3 className="text-[length:var(--t-lg)] font-semibold text-[var(--n-12)]">
              Browse rule templates
            </h3>
            <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
              Pre-built automations. Installed disabled by default — review + enable when you're
              ready.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-[var(--r-1)] px-2 py-1 text-[var(--n-9)] hover:bg-[var(--n-3)] hover:text-[var(--n-12)]"
          >
            ✕
          </button>
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5 border-b border-[var(--n-4)] px-5 py-3">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={`rounded-[var(--r-1)] px-3 py-1 text-[length:var(--t-xs)] transition ${
                filter === c.id
                  ? 'bg-[var(--accent-3)] text-[var(--accent-11)]'
                  : 'bg-[var(--n-2)] text-[var(--n-9)] hover:bg-[var(--n-3)] hover:text-[var(--n-11)]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <p className="text-[length:var(--t-sm)] text-[var(--n-8)]">Loading catalogue…</p>
          )}
          {error && (
            <p className="text-[length:var(--t-sm)] text-[var(--error-11)]">
              Could not load templates.
            </p>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <p className="text-[length:var(--t-sm)] text-[var(--n-8)]">
              No templates in this category.
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filtered.map((t) => {
              const busy = installingId === t.templateId;
              const done = justInstalled === t.templateId;
              return (
                <div
                  key={t.templateId}
                  className="flex flex-col gap-2 rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] p-4"
                >
                  <div className="flex items-start gap-2">
                    <span role="img" aria-label={t.category} className="text-[length:var(--t-lg)]">
                      {t.iconEmoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--n-12)]">{t.name}</p>
                      <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">{t.whatHappens}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--n-3)] px-2 py-0.5 text-[length:var(--t-xs)] uppercase tracking-wider text-[var(--n-8)]">
                      {t.category}
                    </span>
                  </div>

                  {/* Mini flow preview */}
                  <RuleFlow
                    rule={{
                      id: '',
                      name: t.name,
                      enabled: false,
                      trigger: t.trigger,
                      conditions: t.conditions,
                      actions: t.actions,
                      createdAt: 0,
                      updatedAt: 0,
                      fireCount: 0,
                    }}
                  />

                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">{t.description}</p>
                    <button
                      type="button"
                      disabled={busy || done}
                      onClick={() => installMut.mutate(t.templateId)}
                      className={`shrink-0 rounded-[var(--r-2)] px-3 py-1 text-[length:var(--t-xs)] font-medium transition ${
                        done
                          ? 'bg-[var(--success-3)] text-[var(--success-11)]'
                          : busy
                            ? 'bg-[var(--n-3)] text-[var(--n-8)]'
                            : 'bg-[var(--accent-9)] text-white hover:bg-[var(--accent-10)]'
                      }`}
                    >
                      {done ? '✓ Installed' : busy ? 'Installing…' : '+ Install'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[var(--n-4)] px-5 py-3 text-[length:var(--t-xs)] text-[var(--n-8)]">
          Templates install in <span className="text-[var(--n-11)]">disabled</span> state — toggle
          them on from the main Rules list once you've reviewed the actions.
        </div>
      </div>
    </div>
  );
}

export function Rules() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['rules'],
    queryFn: fetchRules,
  });

  const [builderOpen, setBuilderOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [testingRule, setTestingRule] = useState<Rule | null>(null);

  const toggleMut = useMutation({
    mutationFn: (id: string) => toggleRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRuleApi(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  function handleEdit(rule: Rule) {
    setEditingRule(rule);
    setBuilderOpen(true);
  }

  function handleDuplicate(rule: Rule) {
    setEditingRule({
      ...rule,
      id: '',
      name: `${rule.name} (copy)`,
    } as Rule);
    setBuilderOpen(true);
  }

  function handleDelete(id: string) {
    if (window.confirm('Delete this rule?')) {
      deleteMut.mutate(id);
    }
  }

  function handleSaved() {
    setBuilderOpen(false);
    setEditingRule(null);
    void qc.invalidateQueries({ queryKey: ['rules'] });
  }

  const rules = data?.rules ?? [];
  const active = rules.filter((r) => r.enabled);
  const inactive = rules.filter((r) => !r.enabled);

  return (
    <div data-testid="rules-tab" className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[length:var(--t-lg)] font-semibold text-[var(--n-11)]">Rules</h2>
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
            Conditional automation — WHEN pipeline tags match, THEN fire actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="browse-templates-button"
            onClick={() => setTemplatesOpen(true)}
            className="rounded-[var(--r-2)] border border-[var(--n-4)] bg-[var(--n-2)] px-3 py-1.5 text-[length:var(--t-sm)] font-medium text-[var(--n-11)] hover:border-[var(--accent-9)] hover:text-[var(--accent-11)]"
          >
            📚 Browse templates
          </button>
          <button
            type="button"
            data-testid="new-rule-button"
            onClick={() => {
              setEditingRule(null);
              setBuilderOpen(true);
            }}
            className="rounded-[var(--r-2)] bg-[var(--accent-9)] px-3 py-1.5 text-[length:var(--t-sm)] font-medium text-white hover:bg-[var(--accent-10)]"
          >
            + New rule
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex gap-4">
        <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-3 text-center shadow-[var(--shadow-1)]">
          <p className="text-[length:var(--t-xl)] font-bold tabular-nums text-[var(--n-12)]">
            {rules.length}
          </p>
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">Total</p>
        </div>
        <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-3 text-center shadow-[var(--shadow-1)]">
          <p className="text-[length:var(--t-xl)] font-bold tabular-nums text-[var(--accent-11)]">
            {active.length}
          </p>
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">Active</p>
        </div>
        <div className="rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-2)] px-4 py-3 text-center shadow-[var(--shadow-1)]">
          <p className="text-[length:var(--t-xl)] font-bold tabular-nums text-[var(--n-12)]">
            {rules.reduce((sum, r) => sum + (r.fireCount ?? 0), 0)}
          </p>
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">Total fires</p>
        </div>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-[length:var(--t-sm)] text-[var(--n-8)]">
          Loading rules...
        </div>
      )}
      {error && (
        <div className="rounded-[var(--r-3)] border border-[var(--error-9)] bg-[var(--error-3)] p-4 text-[length:var(--t-sm)] text-[var(--error-11)]">
          Failed to load rules.
        </div>
      )}

      {/* Active rules */}
      {!isLoading && active.length > 0 && (
        <section>
          <h3 className="mb-2 text-[length:var(--t-xs)] font-semibold uppercase tracking-wider text-[var(--n-8)]">
            Active
          </h3>
          <div className="flex flex-col gap-2">
            {active.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onToggle={(id) => toggleMut.mutate(id)}
                onTest={(rule) => setTestingRule(rule)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Inactive rules */}
      {!isLoading && inactive.length > 0 && (
        <section>
          <h3 className="mb-2 text-[length:var(--t-xs)] font-semibold uppercase tracking-wider text-[var(--n-8)]">
            Disabled
          </h3>
          <div className="flex flex-col gap-2">
            {inactive.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onToggle={(id) => toggleMut.mutate(id)}
                onTest={(rule) => setTestingRule(rule)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!isLoading && rules.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="rounded-full border border-[var(--n-4)] bg-[var(--n-2)] p-4 text-[length:var(--t-2xl)]">
            R
          </div>
          <h3 className="text-[length:var(--t-sm)] font-medium text-[var(--n-11)]">No rules yet</h3>
          <p className="max-w-xs text-[length:var(--t-xs)] text-[var(--n-8)]">
            Create your first rule to automate actions when pipeline tags match conditions.
          </p>
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="rounded-[var(--r-2)] bg-[var(--accent-9)] px-4 py-2 text-[length:var(--t-sm)] font-medium text-white hover:bg-[var(--accent-10)]"
          >
            Create first rule
          </button>
        </div>
      )}

      {/* Modals */}
      {builderOpen && (
        <RuleBuilderModal
          {...(editingRule
            ? {
                initial: {
                  name: editingRule.name,
                  description: editingRule.description ?? '',
                  trigger: editingRule.trigger,
                  conditions: editingRule.conditions,
                  actions: editingRule.actions,
                  enabled: editingRule.enabled,
                },
                ...(editingRule.id !== '' ? { editId: editingRule.id } : {}),
              }
            : {})}
          onClose={() => {
            setBuilderOpen(false);
            setEditingRule(null);
          }}
          onSaved={handleSaved}
        />
      )}
      {testingRule && <TestModal rule={testingRule} onClose={() => setTestingRule(null)} />}
      {templatesOpen && <TemplatePicker onClose={() => setTemplatesOpen(false)} />}
    </div>
  );
}
