/**
 * Unit tests for evaluateConditions — covers AND/OR/nested + all operators.
 */

import { describe, expect, it } from 'vitest';
import { evaluateConditions, traceConditions } from '../src/shared/rules-engine.ts';
import type { ConditionTree, RuleContext } from '../src/shared/rules-types.ts';

function makeCtx(
  tags: Record<string, { value: string | number | boolean; confidence?: number; label?: string }>,
): RuleContext {
  return { allTags: tags };
}

// ---------------------------------------------------------------------------
// Basic operators
// ---------------------------------------------------------------------------

describe('evaluateConditions — operators', () => {
  it('eq: matches equal string (case-insensitive)', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'sentiment',
      field: 'value',
      operator: 'eq',
      value: 'negative',
    };
    expect(evaluateConditions(tree, makeCtx({ sentiment: { value: 'negative' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ sentiment: { value: 'NEGATIVE' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ sentiment: { value: 'positive' } }))).toBe(false);
  });

  it('neq: mismatches', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'value',
      operator: 'neq',
      value: 'bug',
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'praise' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'bug' } }))).toBe(false);
  });

  it('gt / gte / lt / lte: numeric comparisons', () => {
    const gt: ConditionTree = {
      op: 'condition',
      pipelineId: 'score',
      field: 'confidence',
      operator: 'gt',
      value: 0.7,
    };
    const gte: ConditionTree = {
      op: 'condition',
      pipelineId: 'score',
      field: 'confidence',
      operator: 'gte',
      value: 0.9,
    };
    const lt: ConditionTree = {
      op: 'condition',
      pipelineId: 'score',
      field: 'confidence',
      operator: 'lt',
      value: -0.5,
    };
    const lte: ConditionTree = {
      op: 'condition',
      pipelineId: 'score',
      field: 'confidence',
      operator: 'lte',
      value: 0.5,
    };

    const ctx = makeCtx({ score: { value: 'x', confidence: 0.9 } });
    expect(evaluateConditions(gt, ctx)).toBe(true);
    expect(evaluateConditions(gte, ctx)).toBe(true);
    expect(evaluateConditions(lt, ctx)).toBe(false);
    expect(evaluateConditions(lte, ctx)).toBe(false);

    const negCtx = makeCtx({ score: { value: 'x', confidence: -0.8 } });
    expect(evaluateConditions(lt, negCtx)).toBe(true);
    expect(evaluateConditions(lte, negCtx)).toBe(true);
  });

  it('contains: substring match', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'value',
      operator: 'contains',
      value: 'crash',
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'app-crash-bug' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'billing' } }))).toBe(false);
  });

  it('matches: regex match', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'value',
      operator: 'matches',
      value: '^bug\\.',
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'bug.crash' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'billing' } }))).toBe(false);
  });

  it('matches: invalid regex returns false', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'value',
      operator: 'matches',
      value: '[invalid',
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'anything' } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

describe('evaluateConditions — fields', () => {
  it('value field', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'value',
      operator: 'eq',
      value: 'bug',
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'bug' } }))).toBe(true);
  });

  it('confidence field', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'confidence',
      operator: 'gt',
      value: 0.5,
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'x', confidence: 0.9 } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ p: { value: 'x', confidence: 0.1 } }))).toBe(false);
  });

  it('label field', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'label',
      operator: 'eq',
      value: 'negative',
    };
    expect(evaluateConditions(tree, makeCtx({ p: { value: -0.9, label: 'negative' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ p: { value: 0.5, label: 'positive' } }))).toBe(false);
  });

  it('missing pipeline returns false', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'absent',
      field: 'value',
      operator: 'eq',
      value: 'x',
    };
    expect(evaluateConditions(tree, makeCtx({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AND / OR logic
// ---------------------------------------------------------------------------

describe('evaluateConditions — AND / OR', () => {
  it('AND: all children must match', () => {
    const tree: ConditionTree = {
      op: 'and',
      children: [
        { op: 'condition', pipelineId: 'intent', field: 'value', operator: 'eq', value: 'bug' },
        {
          op: 'condition',
          pipelineId: 'sentiment',
          field: 'value',
          operator: 'eq',
          value: 'negative',
        },
      ],
    };
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'bug' },
          sentiment: { value: 'negative' },
        }),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'bug' },
          sentiment: { value: 'positive' },
        }),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'praise' },
          sentiment: { value: 'negative' },
        }),
      ),
    ).toBe(false);
  });

  it('OR: at least one child must match', () => {
    const tree: ConditionTree = {
      op: 'or',
      children: [
        { op: 'condition', pipelineId: 'a', field: 'value', operator: 'eq', value: 'x' },
        { op: 'condition', pipelineId: 'b', field: 'value', operator: 'eq', value: 'y' },
      ],
    };
    expect(evaluateConditions(tree, makeCtx({ a: { value: 'x' }, b: { value: 'z' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ a: { value: 'z' }, b: { value: 'y' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ a: { value: 'z' }, b: { value: 'z' } }))).toBe(false);
  });

  it('AND with empty children returns true (vacuous)', () => {
    const tree: ConditionTree = { op: 'and', children: [] };
    expect(evaluateConditions(tree, makeCtx({}))).toBe(true);
  });

  it('OR with empty children returns false (vacuous)', () => {
    const tree: ConditionTree = { op: 'or', children: [] };
    expect(evaluateConditions(tree, makeCtx({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Nested / complex trees
// ---------------------------------------------------------------------------

describe('evaluateConditions — nested', () => {
  it('AND containing nested OR', () => {
    // WHEN intent=bug AND (sentiment=negative OR severity=critical)
    const tree: ConditionTree = {
      op: 'and',
      children: [
        { op: 'condition', pipelineId: 'intent', field: 'value', operator: 'eq', value: 'bug' },
        {
          op: 'or',
          children: [
            {
              op: 'condition',
              pipelineId: 'sentiment',
              field: 'value',
              operator: 'eq',
              value: 'negative',
            },
            {
              op: 'condition',
              pipelineId: 'severity',
              field: 'value',
              operator: 'eq',
              value: 'critical',
            },
          ],
        },
      ],
    };

    // intent=bug + sentiment=negative → true
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'bug' },
          sentiment: { value: 'negative' },
        }),
      ),
    ).toBe(true);

    // intent=bug + severity=critical → true
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'bug' },
          severity: { value: 'critical' },
        }),
      ),
    ).toBe(true);

    // intent=bug + neither → false
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'bug' },
          sentiment: { value: 'positive' },
        }),
      ),
    ).toBe(false);

    // intent!=bug → false regardless
    expect(
      evaluateConditions(
        tree,
        makeCtx({
          intent: { value: 'praise' },
          sentiment: { value: 'negative' },
        }),
      ),
    ).toBe(false);
  });

  it('OR containing nested AND groups', () => {
    const tree: ConditionTree = {
      op: 'or',
      children: [
        {
          op: 'and',
          children: [
            { op: 'condition', pipelineId: 'a', field: 'value', operator: 'eq', value: '1' },
            { op: 'condition', pipelineId: 'b', field: 'value', operator: 'eq', value: '2' },
          ],
        },
        {
          op: 'and',
          children: [
            { op: 'condition', pipelineId: 'c', field: 'value', operator: 'eq', value: '3' },
            { op: 'condition', pipelineId: 'd', field: 'value', operator: 'eq', value: '4' },
          ],
        },
      ],
    };

    expect(evaluateConditions(tree, makeCtx({ a: { value: '1' }, b: { value: '2' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ c: { value: '3' }, d: { value: '4' } }))).toBe(true);
    expect(evaluateConditions(tree, makeCtx({ a: { value: '1' }, c: { value: '3' } }))).toBe(false);
    expect(evaluateConditions(tree, makeCtx({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// traceConditions
// ---------------------------------------------------------------------------

describe('traceConditions', () => {
  it('traces a single condition with matched=true', () => {
    const tree: ConditionTree = {
      op: 'condition',
      pipelineId: 'p',
      field: 'value',
      operator: 'eq',
      value: 'x',
    };
    const trace = traceConditions(tree, makeCtx({ p: { value: 'x' } }));
    expect(trace.matched).toBe(true);
    expect(trace.op).toBe('condition');
  });

  it('traces AND group with correct children', () => {
    const tree: ConditionTree = {
      op: 'and',
      children: [
        { op: 'condition', pipelineId: 'a', field: 'value', operator: 'eq', value: '1' },
        { op: 'condition', pipelineId: 'b', field: 'value', operator: 'eq', value: '2' },
      ],
    };
    const trace = traceConditions(tree, makeCtx({ a: { value: '1' }, b: { value: 'X' } }));
    expect(trace.matched).toBe(false);
    expect(trace.op).toBe('and');
    if ('children' in trace) {
      expect(trace.children[0].matched).toBe(true);
      expect(trace.children[1].matched).toBe(false);
    }
  });
});
