/**
 * Module: Rules Engine
 * Tier: CORE
 *
 * CRUD endpoints for rules, plus the test/dry-run endpoint.
 * Rule execution is wired into recordTag() in tags.ts via the onTagWrite hook.
 */

import { redis } from '@devvit/web/server';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import { testRule } from '@shared/rules-engine.js';
import { buildSeedRules } from '@shared/rules-seed.js';
import {
  appendToOrder,
  deleteRule,
  getRule,
  getRuleStats,
  listRules,
  reorderRules,
  saveRule,
} from '@shared/rules-storage.js';
import type { Action, ConditionTree, Rule, RuleContext, RuleTrigger } from '@shared/rules-types.js';
import type { RedLatticeModule } from '@shared/types.js';
import type { Hono } from 'hono';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const conditionTreeSchema: z.ZodType<ConditionTree> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(['and', 'or']),
      children: z.array(conditionTreeSchema),
    }),
    z.object({
      op: z.literal('condition'),
      pipelineId: z.string().min(1),
      field: z.enum(['value', 'confidence', 'label']),
      operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'matches']),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ]),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tag-post'), instanceId: z.string(), value: z.string() }),
  z.object({
    type: z.literal('set-status'),
    status: z.enum(['open', 'in-progress', 'responded', 'resolved']),
  }),
  z.object({
    type: z.literal('send-modmail'),
    subject: z.string().max(100),
    bodyTemplate: z.string().max(10000),
  }),
  z.object({ type: z.literal('remove-post'), spam: z.boolean().optional() }),
  z.object({ type: z.literal('remove-comment'), spam: z.boolean().optional() }),
  z.object({ type: z.literal('lock-post') }),
  z.object({ type: z.literal('distinguish-comment') }),
  z.object({ type: z.literal('approve') }),
  z.object({
    type: z.literal('escalate'),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
  }),
  z.object({
    type: z.literal('webhook'),
    url: z.string().url(),
    method: z.enum(['POST', 'PUT']).optional(),
  }),
  z.object({ type: z.literal('audit-only'), note: z.string().max(500) }),
]);

const createRuleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(false),
  trigger: z.enum([
    'on-tag-write',
    'on-post-create',
    'on-comment-create',
    'on-status-change',
  ] satisfies [RuleTrigger, ...RuleTrigger[]]),
  conditions: conditionTreeSchema,
  actions: z.array(actionSchema).min(1).max(20),
});

const updateRuleSchema = createRuleSchema.partial();

const reorderSchema = z.object({
  ids: z.array(z.string()).min(1),
});

const testRuleSchema = z.object({
  sampleTags: z
    .record(
      z.string(),
      z.object({
        value: z.union([z.string(), z.number(), z.boolean()]),
        confidence: z.number().optional(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  postId: z.string().optional(),
  commentId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function newRuleId(): string {
  const rand =
    typeof crypto !== 'undefined'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `rule_${rand}`;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const SEED_SENTINEL = 'rl:rules:seeded';

async function maybeInsertSeedRules(): Promise<void> {
  try {
    const seeded = await redis.get(SEED_SENTINEL);
    if (seeded) return;
    const seeds = buildSeedRules();
    for (const rule of seeds) {
      await saveRule(rule);
      await appendToOrder(rule.id);
    }
    await redis.set(SEED_SENTINEL, '1');
    log.info('rules: seeded sample rules', { count: seeds.length });
  } catch (err) {
    log.warn('rules: seed failed (non-fatal)', { err: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const rulesModule: RedLatticeModule = {
  name: 'rules',
  description: 'Conditional automation — WHEN pipeline tags match conditions, THEN fire actions.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onAppInstall(): Promise<void> {
    await maybeInsertSeedRules();
  },

  apiRoutes(app: Hono): void {
    // ── GET /api/rules ──────────────────────────────────────────────────────
    app.get('/api/rules', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const rules = await listRules();
      // Merge stats inline
      const withStats = await Promise.all(
        rules.map(async (r) => {
          const stats = await getRuleStats(r.id);
          return {
            ...r,
            fireCount: stats.fireCount,
            lastFiredAt: stats.lastFiredAt,
            errorCount: stats.errorCount,
          };
        }),
      );
      return c.json({ count: withStats.length, rules: withStats });
    });

    // ── POST /api/rules ─────────────────────────────────────────────────────
    app.post('/api/rules', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const body = await c.req.json().catch(() => null);
      const parsed = createRuleSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 400);

      const now = Date.now();
      const { description, actions, ...restData } = parsed.data;
      const rule: Rule = {
        ...restData,
        actions: actions as Action[],
        id: newRuleId(),
        createdAt: now,
        updatedAt: now,
        fireCount: 0,
        ...(description !== undefined ? { description } : {}),
      };
      await saveRule(rule);
      await appendToOrder(rule.id);
      log.info('rules: created', { id: rule.id, name: rule.name });
      return c.json({ rule }, 201);
    });

    // ── PATCH /api/rules/order ───────────────────────────────────────────────
    // Must come before /:id routes
    app.patch('/api/rules/order', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const body = await c.req.json().catch(() => null);
      const parsed = reorderSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 400);
      await reorderRules(parsed.data.ids);
      return c.json({ ok: true });
    });

    // ── PATCH /api/rules/:id ─────────────────────────────────────────────────
    app.patch('/api/rules/:id', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const id = c.req.param('id');
      const existing = await getRule(id);
      if (!existing) return c.json({ error: 'not-found' }, 404);

      const body = await c.req.json().catch(() => null);
      const parsed = updateRuleSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 400);

      const patch = parsed.data;
      // Build a safe partial update, only including defined fields
      const safeUpdate: Partial<Rule> = {};
      if (patch.name !== undefined) safeUpdate.name = patch.name;
      if (patch.enabled !== undefined) safeUpdate.enabled = patch.enabled;
      if (patch.trigger !== undefined) safeUpdate.trigger = patch.trigger;
      if (patch.conditions !== undefined) safeUpdate.conditions = patch.conditions;
      if (patch.actions !== undefined) safeUpdate.actions = patch.actions as Action[];
      if (patch.description !== undefined) safeUpdate.description = patch.description;
      const updated: Rule = {
        ...existing,
        ...safeUpdate,
        id,
        updatedAt: Date.now(),
      };
      await saveRule(updated);
      return c.json({ rule: updated });
    });

    // ── DELETE /api/rules/:id ────────────────────────────────────────────────
    app.delete('/api/rules/:id', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const id = c.req.param('id');
      await deleteRule(id);
      return c.json({ ok: true });
    });

    // ── POST /api/rules/:id/test ─────────────────────────────────────────────
    app.post('/api/rules/:id/test', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const id = c.req.param('id');
      const rule = await getRule(id);
      if (!rule) return c.json({ error: 'not-found' }, 404);

      const body = await c.req.json().catch(() => ({}));
      const parsed = testRuleSchema.safeParse(body);
      if (!parsed.success) return c.json({ error: 'validation', issues: parsed.error.issues }, 400);

      const ctx: RuleContext = {
        allTags: (parsed.data.sampleTags ?? {}) as RuleContext['allTags'],
        dryRun: true,
        ...(parsed.data.postId !== undefined ? { postId: parsed.data.postId } : {}),
        ...(parsed.data.commentId !== undefined ? { commentId: parsed.data.commentId } : {}),
      };
      const result = await testRule(rule, ctx);
      return c.json(result);
    });

    // ── POST /api/rules/:id/toggle ───────────────────────────────────────────
    app.post('/api/rules/:id/toggle', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const id = c.req.param('id');
      const rule = await getRule(id);
      if (!rule) return c.json({ error: 'not-found' }, 404);

      const updated: Rule = { ...rule, enabled: !rule.enabled, updatedAt: Date.now() };
      await saveRule(updated);
      return c.json({ rule: updated });
    });
  },
};
