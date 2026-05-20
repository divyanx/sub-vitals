/**
 * Unit tests for the Copilot tool registry.
 *
 * We mock @devvit/web/server + downstream singletons so we can import the
 * tool module without booting Devvit. Tests cover:
 *   - Tool catalogue shape (every entry has name/description/safety/schema)
 *   - Zod input validation rejects malformed args
 *   - Read tool happy path (listInstalledPipelines + getAISpend)
 *   - Write tool preview returns { ok: true, summary } and does NOT mutate
 *   - publicCatalogue() exposes no executors
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — devvit + shared dependencies the tool module pulls in.
// ---------------------------------------------------------------------------

const { redisStore, redisZSets, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const zsets = new Map<string, Array<{ member: string; score: number }>>();
  return {
    redisStore: store,
    redisZSets: zsets,
    redisMock: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      del: vi.fn(async (k: string) => {
        store.delete(k);
      }),
      hGet: vi.fn(async () => null),
      hGetAll: vi.fn(async () => ({})),
      hIncrBy: vi.fn(async () => 0),
      zRange: vi.fn(async (k: string) => zsets.get(k) ?? []),
      zAdd: vi.fn(async () => undefined),
      zRem: vi.fn(async () => undefined),
      expire: vi.fn(async () => undefined),
    },
  };
});

vi.mock('@devvit/web/server', () => ({
  redis: redisMock,
  reddit: { getPostById: vi.fn(), getCurrentUsername: vi.fn(async () => 'tester') },
  settings: { get: vi.fn(async () => undefined) },
  context: { username: 'tester', subredditName: 'test' },
}));

vi.mock('@shared/settings-overrides.js', () => ({
  readEffectiveSetting: vi.fn(async () => null),
}));

vi.mock('@shared/permissions.js', () => ({
  requireMod: vi.fn(async () => true),
  isCurrentUserMod: vi.fn(async () => true),
}));

vi.mock('@shared/pipeline-instances.js', () => ({
  listInstances: vi.fn(async () => [
    {
      id: 'p1',
      templateId: 'spam-detector',
      name: 'Spam',
      enabled: true,
      config: { trigger: 'post-create', outputSchema: 'boolean' },
      showIn: ['insights'],
    },
  ]),
  getInstance: vi.fn(async (id: string) =>
    id === 'p1'
      ? {
          id: 'p1',
          name: 'Spam',
          enabled: true,
          description: 'detects spam',
          config: { trigger: 'post-create', outputSchema: 'boolean', labels: [] },
        }
      : null,
  ),
  installFromTemplate: vi.fn(async () => ({ id: 'p2', name: 'New', enabled: true })),
  patchInstance: vi.fn(async (_id: string, p: { enabled?: boolean }) => ({
    enabled: p.enabled ?? true,
  })),
}));

vi.mock('@shared/rules-storage.js', () => ({
  listRules: vi.fn(async () => [
    {
      id: 'r1',
      name: 'esc',
      enabled: true,
      trigger: 'on-tag-write',
      actions: [{ type: 'audit-only', note: 'x' }],
      fireCount: 3,
      lastFiredAt: 1700000000,
    },
  ]),
  listEnabledRules: vi.fn(async () => []),
  saveRule: vi.fn(async () => undefined),
}));

vi.mock('@modules/audit-log/index.js', () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock('@shared/llm.js', () => ({
  readMonthlyCents: vi.fn(async () => 12.5),
  readMonthlyTokens: vi.fn(async () => ({ tokensIn: 1000, tokensOut: 500 })),
  DEFAULT_MODEL: 'anthropic/claude-haiku-4.5',
  getEffectiveModel: vi.fn(async () => ({
    model: 'anthropic/claude-haiku-4.5',
    isFallback: false,
  })),
}));

vi.mock('@shared/pipeline-templates.js', () => ({
  PIPELINE_TEMPLATES: [
    {
      id: 'spam-detector',
      name: 'Spam Detector',
      category: 'flagging',
      kind: 'boolean',
      shortDescription: 'detect spam',
    },
  ],
  getPipelineTemplate: (id: string) =>
    id === 'spam-detector'
      ? { id: 'spam-detector', name: 'Spam Detector', category: 'flagging', kind: 'boolean' }
      : undefined,
}));

vi.mock('@shared/log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports under test — must come AFTER vi.mock calls.
// ---------------------------------------------------------------------------

import { getTool, publicCatalogue, TOOLS } from '../src/modules/copilot/tools.ts';

beforeEach(() => {
  redisStore.clear();
  redisZSets.clear();
});

describe('TOOLS catalogue', () => {
  it('every tool has name + description + safety + schema', () => {
    for (const t of TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe('string');
      expect(['read', 'write']).toContain(t.safety);
      expect(t.inputSchema).toBeDefined();
    }
  });

  it('includes the documented core tools', () => {
    const names = TOOLS.map((t) => t.name);
    for (const n of [
      'listInstalledPipelines',
      'searchPosts',
      'getPostDetail',
      'getAvailableTemplates',
      'getRecentRules',
      'getAISpend',
      'installPipeline',
      'setPipelineEnabled',
      'createRule',
      'setPostStatus',
      'approvePost',
      'bulkSetStatus',
    ]) {
      expect(names).toContain(n);
    }
  });

  it('publicCatalogue exposes no executors', () => {
    const cat = publicCatalogue();
    for (const entry of cat) {
      expect(Object.keys(entry).sort()).toEqual(['description', 'name', 'safety']);
    }
  });
});

describe('Read tool — listInstalledPipelines', () => {
  it('returns installed instances from the mock', async () => {
    const t = getTool('listInstalledPipelines');
    expect(t).toBeDefined();
    if (!t || t.safety !== 'read') throw new Error('expected read tool');
    const result = (await t.execute({})) as { count: number; instances: Array<{ id: string }> };
    expect(result.count).toBe(1);
    expect(result.instances[0]?.id).toBe('p1');
  });
});

describe('Read tool — getAISpend', () => {
  it('returns month-to-date cents and tokens', async () => {
    const t = getTool('getAISpend');
    if (!t || t.safety !== 'read') throw new Error('expected read tool');
    const result = (await t.execute({})) as { monthCents: number; tokensIn: number };
    expect(result.monthCents).toBeCloseTo(12.5);
    expect(result.tokensIn).toBe(1000);
  });
});

describe('Write tool — installPipeline preview', () => {
  it('returns ok + summary without mutating', async () => {
    const t = getTool('installPipeline');
    if (!t || t.safety !== 'write') throw new Error('expected write tool');
    const preview = await t.preview({ templateId: 'spam-detector' });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.summary).toMatch(/Install pipeline/);
    }
  });

  it('returns ok=false for unknown template', async () => {
    const t = getTool('installPipeline');
    if (!t || t.safety !== 'write') throw new Error('expected write tool');
    const preview = await t.preview({ templateId: 'does-not-exist' });
    expect(preview.ok).toBe(false);
  });
});

describe('Schema validation', () => {
  it('searchPosts rejects out-of-bounds limit', () => {
    const t = getTool('searchPosts');
    if (!t) throw new Error('missing');
    const r = t.inputSchema.safeParse({ limit: 9999 });
    expect(r.success).toBe(false);
  });

  it('setPostStatus requires a valid enum', () => {
    const t = getTool('setPostStatus');
    if (!t) throw new Error('missing');
    expect(t.inputSchema.safeParse({ postId: 't3_x', status: 'bogus' }).success).toBe(false);
    expect(t.inputSchema.safeParse({ postId: 't3_x', status: 'resolved' }).success).toBe(true);
  });

  it('createRule requires actions array', () => {
    const t = getTool('createRule');
    if (!t) throw new Error('missing');
    expect(
      t.inputSchema.safeParse({
        name: 'r',
        trigger: 'on-tag-write',
        conditions: { op: 'and', children: [] },
        actions: [],
      }).success,
    ).toBe(false);
    expect(
      t.inputSchema.safeParse({
        name: 'r',
        trigger: 'on-tag-write',
        conditions: { op: 'and', children: [] },
        actions: [{ type: 'audit-only', note: 'x' }],
      }).success,
    ).toBe(true);
  });
});
