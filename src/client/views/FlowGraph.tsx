/**
 * FlowGraph — read-only computation graph of the live RedLattice config.
 *
 * What you see:
 *   Triggers (PostSubmit / CommentSubmit / status-change)
 *      → Pipelines (every installed instance — enabled brighter, disabled dim)
 *        → Tags (single sink node — "all pipeline outputs flow through here")
 *          → Rules (every rule — enabled = solid edge, disabled = dashed)
 *            → Actions (terminal pills — one per rule action)
 *
 * Why read-only:
 *   Drag-to-wire edges sound nice but map poorly to our data model — rules
 *   don't "subscribe" to pipelines, they reference them via
 *   condition.pipelineId. Editing the wire == editing the condition's
 *   pipelineId, which is form work. So instead we make every node clickable
 *   and route to the existing well-tested editor surface. No new mutation
 *   path means no new sync bugs.
 *
 * Copilot integration:
 *   The Copilot can already create / install / enable / disable pipelines
 *   and rules. Those mutations invalidate the same TanStack Query keys this
 *   view reads from, so anything the Copilot does shows up here on next
 *   render with zero extra wiring.
 */

import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Rule } from '../../shared/rules-types.js';
import { api, type PipelineInstance } from '../lib/api.ts';
import { getPipelineTheme } from '../lib/pipelineTheme.ts';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const COL = {
  trigger: 0,
  pipeline: 320,
  tag: 680,
  rule: 940,
  action: 1280,
};
const ROW_GAP = 110;

// ---------------------------------------------------------------------------
// Custom node components
// ---------------------------------------------------------------------------

function TriggerNode({ data }: NodeProps) {
  const d = data as { label: string; emoji: string };
  return (
    <div className="flow-node trigger" style={{ minWidth: 180 }}>
      <div className="flow-node-row">
        <span className="flow-node-emoji">{d.emoji}</span>
        <div className="flow-node-title">{d.label}</div>
      </div>
      <div className="flow-node-sub">Reddit trigger</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function PipelineNode({ data }: NodeProps) {
  const d = data as {
    label: string;
    kind: string;
    enabled: boolean;
    templateId: string;
    trigger: string;
  };
  const theme = getPipelineTheme(d.templateId);
  const opacity = d.enabled ? 1 : 0.45;
  return (
    <div
      className="flow-node pipeline"
      style={{
        minWidth: 240,
        opacity,
        borderLeft: `2px solid hsla(${theme.hue}, ${theme.sat}%, 60%, 0.9)`,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-row">
        <span
          className="flow-node-emoji"
          style={{ background: `hsla(${theme.hue}, ${theme.sat}%, 55%, 0.15)` }}
        >
          {theme.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flow-node-title">{d.label}</div>
          <div className="flow-node-sub flex items-center gap-1.5">
            <span>{d.kind}</span>
            <span aria-hidden>·</span>
            <span>{d.trigger}</span>
            {!d.enabled && (
              <>
                <span aria-hidden>·</span>
                <span style={{ color: 'var(--n-7)' }}>disabled</span>
              </>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function TagSinkNode() {
  return (
    <div className="flow-node tag-sink" style={{ minWidth: 140 }}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-row">
        <span className="flow-node-emoji">🏷️</span>
        <div className="flow-node-title">Tags</div>
      </div>
      <div className="flow-node-sub">All pipeline outputs</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RuleNode({ data }: NodeProps) {
  const d = data as { label: string; enabled: boolean; triggerType: string };
  return (
    <div
      className="flow-node rule"
      style={{
        minWidth: 260,
        opacity: d.enabled ? 1 : 0.45,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-row">
        <span className="flow-node-emoji">⚡</span>
        <div className="min-w-0 flex-1">
          <div className="flow-node-title">{d.label}</div>
          <div className="flow-node-sub">
            {d.triggerType} {d.enabled ? '' : '· disabled'}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function ActionNode({ data }: NodeProps) {
  const d = data as { label: string; emoji: string; tone: string };
  return (
    <div className={`flow-node action ${d.tone}`} style={{ minWidth: 160 }}>
      <Handle type="target" position={Position.Left} />
      <div className="flow-node-row">
        <span className="flow-node-emoji">{d.emoji}</span>
        <div className="flow-node-title">{d.label}</div>
      </div>
    </div>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  pipeline: PipelineNode,
  tagSink: TagSinkNode,
  rule: RuleNode,
  action: ActionNode,
};

// ---------------------------------------------------------------------------
// Action display config
// ---------------------------------------------------------------------------

const ACTION_VISUAL: Record<
  string,
  { emoji: string; label: (a: Record<string, unknown>) => string; tone: string }
> = {
  'remove-post': {
    emoji: '🗑️',
    label: (a) => (a.spam ? 'Remove (spam)' : 'Remove'),
    tone: 'danger',
  },
  'remove-comment': {
    emoji: '🗑️',
    label: (a) => (a.spam ? 'Remove cmt (spam)' : 'Remove cmt'),
    tone: 'danger',
  },
  'send-modmail': { emoji: '📬', label: () => 'Modmail', tone: 'info' },
  'set-status': { emoji: '🟢', label: (a) => `→ ${String(a.status)}`, tone: 'info' },
  'lock-post': { emoji: '🔒', label: () => 'Lock', tone: 'warn' },
  'distinguish-comment': { emoji: '⭐', label: () => 'Distinguish', tone: 'info' },
  approve: { emoji: '✅', label: () => 'Approve', tone: 'success' },
  escalate: { emoji: '🚨', label: (a) => `Escalate ${String(a.severity)}`, tone: 'warn' },
  webhook: { emoji: '🔗', label: () => 'Webhook', tone: 'info' },
  'tag-post': { emoji: '🏷️', label: (a) => `Tag ${String(a.instanceId)}`, tone: 'info' },
  'ban-author': {
    emoji: '⛔',
    label: (a) => (a.durationDays ? `Ban ${String(a.durationDays)}d` : 'Permaban'),
    tone: 'danger',
  },
  'ban-if-repeat': {
    emoji: '⛔',
    label: (a) => `Ban-if ${String(a.threshold)}/${String(a.windowDays)}d`,
    tone: 'danger',
  },
  'audit-only': { emoji: '📝', label: () => 'Audit', tone: 'muted' },
};

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

interface BuiltGraph {
  nodes: Node[];
  edges: Edge[];
}

function buildGraph(pipelines: PipelineInstance[], rules: Rule[]): BuiltGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group pipelines by trigger so each trigger node fans to its pipelines.
  const triggers = ['post-create', 'comment-create', 'status-change'] as const;
  const triggerEmoji: Record<string, string> = {
    'post-create': '📝',
    'comment-create': '💬',
    'status-change': '🔄',
  };
  const triggerLabel: Record<string, string> = {
    'post-create': 'PostSubmit',
    'comment-create': 'CommentSubmit',
    'status-change': 'Status change',
  };

  // Place triggers in column 0, vertically distributed
  triggers.forEach((t, i) => {
    nodes.push({
      id: `trigger:${t}`,
      type: 'trigger',
      position: { x: COL.trigger, y: i * 200 },
      data: { label: triggerLabel[t], emoji: triggerEmoji[t] },
      draggable: false,
      selectable: false,
    });
  });

  // Pipelines in column 1, grouped by trigger
  const pipelinesByTrigger: Record<string, PipelineInstance[]> = {};
  for (const p of pipelines) {
    const t = p.config.trigger ?? 'post-create';
    if (!pipelinesByTrigger[t]) pipelinesByTrigger[t] = [];
    pipelinesByTrigger[t].push(p);
  }

  let pipelineY = 0;
  for (const t of triggers) {
    const list = pipelinesByTrigger[t] ?? [];
    for (const p of list) {
      nodes.push({
        id: `pipeline:${p.id}`,
        type: 'pipeline',
        position: { x: COL.pipeline, y: pipelineY },
        data: {
          label: p.name,
          kind: p.config.outputSchema,
          enabled: p.enabled,
          templateId: p.templateId,
          trigger: t,
        },
        draggable: false,
      });
      edges.push({
        id: `e-trigger-${t}-${p.id}`,
        source: `trigger:${t}`,
        target: `pipeline:${p.id}`,
        type: 'smoothstep',
        animated: p.enabled,
        style: { stroke: p.enabled ? 'var(--accent-9)' : 'var(--n-6)', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: p.enabled ? '#ff4500' : '#525252' },
      });
      pipelineY += ROW_GAP;
    }
    pipelineY += 24; // gap between trigger groups
  }
  const totalContentHeight = Math.max(pipelineY, triggers.length * 200);

  // Tag sink in column 2, vertically centered
  const tagY = Math.max(totalContentHeight / 2 - 40, 0);
  nodes.push({
    id: 'tag-sink',
    type: 'tagSink',
    position: { x: COL.tag, y: tagY },
    data: {},
    draggable: false,
    selectable: false,
  });
  for (const p of pipelines) {
    edges.push({
      id: `e-pipe-${p.id}-tags`,
      source: `pipeline:${p.id}`,
      target: 'tag-sink',
      type: 'smoothstep',
      animated: p.enabled,
      style: { stroke: p.enabled ? 'var(--accent-9)' : 'var(--n-6)', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: p.enabled ? '#ff4500' : '#525252' },
    });
  }

  // Rules in column 3
  let ruleY = 0;
  for (const r of rules) {
    nodes.push({
      id: `rule:${r.id}`,
      type: 'rule',
      position: { x: COL.rule, y: ruleY },
      data: { label: r.name, enabled: r.enabled, triggerType: r.trigger },
      draggable: false,
    });
    edges.push({
      id: `e-tags-rule-${r.id}`,
      source: 'tag-sink',
      target: `rule:${r.id}`,
      type: 'smoothstep',
      animated: r.enabled,
      style: {
        stroke: r.enabled ? 'var(--accent-9)' : 'var(--n-6)',
        strokeWidth: 1.5,
        strokeDasharray: r.enabled ? undefined : '4 4',
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: r.enabled ? '#ff4500' : '#525252' },
    });
    ruleY += ROW_GAP;
  }

  // Actions in column 4, fanning out from each rule
  for (const r of rules) {
    const ruleNode = nodes.find((n) => n.id === `rule:${r.id}`);
    if (!ruleNode) continue;
    const baseY = ruleNode.position.y;
    r.actions.forEach((a, i) => {
      const visual = ACTION_VISUAL[a.type] ?? {
        emoji: '•',
        label: () => a.type,
        tone: 'muted',
      };
      const id = `action:${r.id}:${i}`;
      nodes.push({
        id,
        type: 'action',
        position: { x: COL.action, y: baseY + i * 56 },
        data: {
          label: visual.label(a as unknown as Record<string, unknown>),
          emoji: visual.emoji,
          tone: visual.tone,
        },
        draggable: false,
        selectable: false,
      });
      edges.push({
        id: `e-rule-${r.id}-action-${i}`,
        source: `rule:${r.id}`,
        target: id,
        type: 'smoothstep',
        animated: r.enabled,
        style: {
          stroke: r.enabled ? 'var(--accent-9)' : 'var(--n-6)',
          strokeWidth: 1,
          strokeDasharray: r.enabled ? undefined : '4 4',
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: r.enabled ? '#ff4500' : '#525252' },
      });
    });
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function FlowGraphInner() {
  const pipelinesQ = useQuery({
    queryKey: ['pipelines-instances'],
    queryFn: () => api.pipelines.listInstances(),
    staleTime: 30_000,
  });
  const rulesQ = useQuery({
    queryKey: ['rules'],
    queryFn: async () => {
      const res = await fetch('/api/rules');
      if (!res.ok) throw new Error('Failed to fetch rules');
      const json = (await res.json()) as { rules: Rule[] };
      return json.rules;
    },
    staleTime: 30_000,
  });

  const pipelines = pipelinesQ.data?.instances ?? [];
  const rules = rulesQ.data ?? [];

  const { nodes, edges } = useMemo(() => buildGraph(pipelines, rules), [pipelines, rules]);

  const onNodeClick = (_: unknown, node: Node) => {
    // Click-to-edit: open the existing tab/section the node belongs to.
    // We push a hash so the existing route handler picks it up.
    if (node.id.startsWith('pipeline:')) {
      const id = node.id.slice('pipeline:'.length);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'pipelines');
      url.searchParams.set('instance', id);
      url.searchParams.delete('section');
      window.location.href = url.toString();
    } else if (node.id.startsWith('rule:')) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'rules');
      url.searchParams.delete('section');
      window.location.href = url.toString();
    }
  };

  const loading = pipelinesQ.isPending || rulesQ.isPending;
  const error = pipelinesQ.error || rulesQ.error;

  return (
    <div className="flex h-full flex-col gap-3">
      <FlowGraphStyles />

      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <div>
          <h2 className="text-[length:var(--t-lg)] font-semibold text-[var(--n-12)]">Flow graph</h2>
          <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">
            Live computation graph — triggers → pipelines → tags → rules → actions. Click any
            pipeline or rule node to open its editor.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[length:var(--t-xs)] text-[var(--n-8)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-6 bg-[var(--accent-9)]" /> active
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-6" style={{ borderTop: '1.5px dashed var(--n-6)' }} /> disabled
          </span>
        </div>
      </div>

      {error && (
        <p className="px-1 text-[length:var(--t-sm)] text-[var(--error-11)]">
          Could not load graph data.
        </p>
      )}
      {loading && <p className="px-1 text-[length:var(--t-sm)] text-[var(--n-8)]">Loading flow…</p>}

      <div className="min-h-[600px] flex-1 overflow-hidden rounded-[var(--r-3)] border border-[var(--n-4)] bg-[var(--n-1)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          connectionLineType={ConnectionLineType.SmoothStep}
          onNodeClick={onNodeClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--n-4)" />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'pipeline') {
                const t = getPipelineTheme((n.data as { templateId?: string }).templateId);
                return `hsl(${t.hue}, ${t.sat}%, 60%)`;
              }
              if (n.type === 'rule') return 'var(--accent-9)';
              if (n.type === 'action') return 'var(--n-7)';
              return 'var(--n-6)';
            }}
            maskColor="rgba(10, 10, 10, 0.6)"
            style={{ background: 'var(--n-2)' }}
            pannable
            zoomable
          />
        </ReactFlow>
      </div>
    </div>
  );
}

/**
 * Inlined styles for the custom node renderers. Kept here (not in
 * styles.css) so the FlowGraph is self-contained — drop the file, no
 * global CSS to wire up.
 */
function FlowGraphStyles() {
  return (
    <style>{`
      .flow-node {
        background: var(--n-2);
        border: 1px solid var(--n-4);
        border-radius: var(--r-2);
        padding: 10px 12px;
        color: var(--n-12);
        box-shadow: var(--shadow-1);
        font-size: var(--t-sm);
        cursor: pointer;
        transition: border-color var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease);
      }
      .flow-node:hover { border-color: var(--accent-9); box-shadow: var(--shadow-2); }
      .flow-node.trigger { background: var(--n-3); }
      .flow-node.tag-sink { background: var(--n-3); border-style: dashed; }
      .flow-node.rule { background: var(--n-2); }
      .flow-node.action { padding: 6px 10px; font-size: var(--t-xs); }
      .flow-node.action.danger { color: #fca5a5; border-color: #5a1a1a; background: #2d0e0e; }
      .flow-node.action.warn { color: #fbbf24; border-color: #6b3a00; background: #2d1a00; }
      .flow-node.action.success { color: #86efac; border-color: #1a5a30; background: #0d2e1a; }
      .flow-node.action.info { color: var(--accent-11); border-color: var(--accent-10); background: var(--accent-3); }
      .flow-node.action.muted { color: var(--n-9); }
      .flow-node-row { display: flex; align-items: center; gap: 8px; }
      .flow-node-emoji {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        width: 24px;
        border-radius: var(--r-1);
        background: var(--n-3);
        font-size: 14px;
        flex-shrink: 0;
      }
      .flow-node-title { font-weight: 500; line-height: 1.2; }
      .flow-node-sub { margin-top: 2px; font-size: var(--t-xs); color: var(--n-8); }
      /* React Flow theme tweaks to match our tokens */
      .react-flow__minimap { border-radius: var(--r-2); border: 1px solid var(--n-4); }
      .react-flow__controls button {
        background: var(--n-2);
        color: var(--n-11);
        border-color: var(--n-4);
      }
    `}</style>
  );
}

export function FlowGraph() {
  return (
    <ReactFlowProvider>
      <FlowGraphInner />
    </ReactFlowProvider>
  );
}
