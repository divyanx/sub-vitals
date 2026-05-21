/**
 * Module — Copilot
 * Tier: PRO
 *
 * Embedded chat agent for moderators. The mod types natural-language queries
 * or commands; the LLM picks tools from `TOOLS`, executes read tools inline,
 * and proposes write actions for explicit confirmation via the UI.
 *
 * Routes:
 *   POST /api/copilot/chat            — run one turn (LLM + tool loop)
 *   POST /api/copilot/execute         — confirm + apply a write-tool action
 *   GET  /api/copilot/history         — list recent conversations
 *   GET  /api/copilot/history/:id     — fetch a single conversation
 *   POST /api/copilot/history/clear   — wipe all conversation history
 *   POST /api/copilot/history/:id/delete  — delete one conversation
 *
 * Cost: every LLM call routes through the existing `llmObject` cost-tracking
 * infrastructure (we use generateText here for tool-calling support; tokens
 * are still accounted via the same monthly Redis counters).
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { context, reddit, redis, settings } from '@devvit/web/server';
import { K } from '@shared/keys.js';
import { DEFAULT_MODEL, getEffectiveModel, readMonthlyCents } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import { takeToken } from '@shared/ratelimit.js';
import { readEffectiveSetting } from '@shared/settings-overrides.js';
import type { RedLatticeModule } from '@shared/types.js';
import { generateText, stepCountIs, tool } from 'ai';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { getTool, publicCatalogue, TOOLS } from './tools.js';

const MAX_CONVERSATIONS = 10;
const MAX_MESSAGES_PER_CONVO = 40;
const HISTORY_TTL_DAYS = 30;
const RATE_LIMIT_NAME = 'copilot-chat';
const MAX_STEPS = 4;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export type CopilotRole = 'user' | 'assistant' | 'tool';

export interface CopilotToolCall {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  /** Set for write tools — UI gates execution on confirmation. */
  preview?: {
    ok: boolean;
    summary?: string;
    error?: string;
    [k: string]: unknown;
  };
  /** Set after the mod confirms + the action runs. */
  committed?: { ok: boolean; result?: unknown; error?: string; at: number };
}

export interface CopilotMessage {
  id: string;
  role: CopilotRole;
  content: string;
  toolCalls?: CopilotToolCall[];
  ts: number;
}

export interface CopilotConversation {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: CopilotMessage[];
}

export interface CopilotContextHint {
  currentTab?: string | undefined;
  currentInstanceId?: string | undefined;
  currentPostId?: string | undefined;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const chatBodySchema = z.object({
  conversationId: z.string().min(1).max(80).optional(),
  message: z.string().min(1).max(4000),
  context: z
    .object({
      currentTab: z.string().max(40).optional(),
      currentInstanceId: z.string().max(80).optional(),
      currentPostId: z.string().max(80).optional(),
    })
    .strict()
    .optional(),
});

const executeBodySchema = z.object({
  conversationId: z.string().min(1).max(80),
  messageId: z.string().min(1).max(80),
  toolCallId: z.string().min(1).max(120),
});

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function currentUserId(): Promise<string | null> {
  try {
    // Prefer username — stable across sessions and easy to read in keys.
    const u = await reddit.getCurrentUsername();
    if (u) return u.toLowerCase();
  } catch {
    /* ignore */
  }
  try {
    if (context.userId) return context.userId;
  } catch {
    /* ignore */
  }
  return null;
}

async function loadConversation(
  userId: string,
  convoId: string,
): Promise<CopilotConversation | null> {
  try {
    const raw = await redis.get(K.copilotConvo(userId, convoId));
    if (!raw) return null;
    return JSON.parse(raw) as CopilotConversation;
  } catch (err) {
    log.warn('copilot: load convo failed', { err: String(err), convoId });
    return null;
  }
}

async function saveConversation(convo: CopilotConversation): Promise<void> {
  const key = K.copilotConvo(convo.userId, convo.id);
  await redis.set(key, JSON.stringify(convo), {
    expiration: new Date(Date.now() + HISTORY_TTL_DAYS * 86_400 * 1000),
  });
  await redis.zAdd(K.copilotIndex(convo.userId), {
    score: convo.updatedAt,
    member: convo.id,
  });

  // Trim to most-recent MAX_CONVERSATIONS — drop older entries.
  // zRange with reverse:false sorts ASC; we want lowest scores to evict.
  try {
    const all = (await redis.zRange(K.copilotIndex(convo.userId), 0, -1)) as Array<{
      member: string;
      score: number;
    }>;
    if (Array.isArray(all) && all.length > MAX_CONVERSATIONS) {
      const sorted = [...all].sort((a, b) => a.score - b.score);
      const toEvict = sorted.slice(0, sorted.length - MAX_CONVERSATIONS);
      for (const e of toEvict) {
        await redis.del(K.copilotConvo(convo.userId, e.member)).catch(() => undefined);
        await redis.zRem(K.copilotIndex(convo.userId), [e.member]).catch(() => undefined);
      }
    }
  } catch (err) {
    log.warn('copilot: trim failed', { err: String(err) });
  }
}

async function listConversations(userId: string): Promise<CopilotConversation[]> {
  const ids = (await redis.zRange(K.copilotIndex(userId), 0, -1).catch(() => [])) as
    | Array<{ member: string; score: number }>
    | string[];
  const flat = (Array.isArray(ids) ? ids : []).map((v: unknown) =>
    typeof v === 'string' ? { member: v, score: 0 } : (v as { member: string; score: number }),
  );
  flat.sort((a, b) => b.score - a.score);
  const out: CopilotConversation[] = [];
  for (const { member } of flat) {
    const convo = await loadConversation(userId, member);
    if (convo) out.push(convo);
  }
  return out;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: CopilotContextHint | undefined): string {
  const toolLines = TOOLS.map((t) => `- ${t.name} (${t.safety}): ${t.description}`).join('\n');

  const ctxBlock = ctx
    ? `\n\nCurrent UI context:\n` +
      `- tab: ${ctx.currentTab ?? 'unknown'}\n` +
      (ctx.currentInstanceId ? `- pipeline open: ${ctx.currentInstanceId}\n` : '') +
      (ctx.currentPostId ? `- post open: ${ctx.currentPostId}\n` : '') +
      `When the user says "this post" / "this pipeline", default to that id.`
    : '';

  return [
    'You are RedLattice Copilot, a CX analytics assistant for Reddit brand-subreddit moderators.',
    'You can call tools to look up data and propose mod actions. Be concise; prefer bullet lists.',
    'When the user asks about live data (posts, pipelines, rules, spend), call a read tool first — do not invent.',
    'For destructive or stateful actions, ALWAYS call the matching write tool. The system will',
    'render a confirmation card; do NOT pretend the action happened. Phrase replies as proposals',
    '("I will install …, click Confirm to proceed").',
    `\nAvailable tools:\n${toolLines}`,
    ctxBlock,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Build AI SDK tools from our registry
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: ai-sdk Tool type does not survive over a heterogeneous registry
function buildAiTools(collected: CopilotToolCall[]): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: same as above
  const out: Record<string, any> = {};
  for (const t of TOOLS) {
    out[t.name] = tool({
      description: t.description,
      // biome-ignore lint/suspicious/noExplicitAny: Zod -> ai-sdk FlexibleSchema bridge
      inputSchema: t.inputSchema as any,
      execute: async (args: unknown) => {
        const parsed = t.inputSchema.safeParse(args);
        if (!parsed.success) {
          return { error: 'invalid-arguments', issues: parsed.error.issues };
        }
        const id = newId('tc');
        if (t.safety === 'read') {
          try {
            const result = await t.execute(parsed.data);
            collected.push({ id, name: t.name, args: parsed.data, result });
            return result;
          } catch (err) {
            const result = { error: err instanceof Error ? err.message : String(err) };
            collected.push({ id, name: t.name, args: parsed.data, result });
            return result;
          }
        } else {
          // Write — only run preview during the LLM turn.
          const preview = await t.preview(parsed.data).catch((err) => ({
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }));
          collected.push({ id, name: t.name, args: parsed.data, preview });
          // Tell the model the action is queued for confirmation.
          return {
            status: 'pending-confirmation',
            toolCallId: id,
            preview,
          };
        }
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider setup — reuse OpenRouter config from shared/llm
// ---------------------------------------------------------------------------

async function getProvider() {
  const apiKey = (await settings.get('openrouter-api-key').catch(() => undefined)) as
    | string
    | undefined;
  if (!apiKey) return null;
  const { model } = await getEffectiveModel();
  // OpenAI direct — see comment in shared/llm.ts. openrouter.ai pending
  // Reddit approval; api.openai.com is in devvit.json from day one.
  const provider = createOpenAICompatible({
    name: 'openai-direct',
    apiKey,
    baseURL: 'https://api.openai.com/v1',
  });
  return { handle: provider(model || DEFAULT_MODEL), model: model || DEFAULT_MODEL };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const copilotModule: RedLatticeModule = {
  name: 'copilot',
  description: 'Natural-language agent for moderators.',
  tier: 'pro',

  async enabled() {
    return true;
  },

  apiRoutes(app: Hono): void {
    // ── GET /api/copilot/catalogue ─────────────────────────────────────────
    app.get('/api/copilot/catalogue', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      return c.json({ tools: publicCatalogue() });
    });

    // ── POST /api/copilot/chat ────────────────────────────────────────────
    app.post('/api/copilot/chat', async (c) => handleChat(c));

    // ── POST /api/copilot/execute ─────────────────────────────────────────
    app.post('/api/copilot/execute', async (c) => handleExecute(c));

    // ── GET /api/copilot/history ──────────────────────────────────────────
    app.get('/api/copilot/history', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const uid = await currentUserId();
      if (!uid) return c.json({ conversations: [] });
      const convos = await listConversations(uid);
      return c.json({
        conversations: convos.map((cv) => ({
          id: cv.id,
          title: cv.title,
          createdAt: cv.createdAt,
          updatedAt: cv.updatedAt,
          messageCount: cv.messages.length,
        })),
      });
    });

    // ── GET /api/copilot/history/:id ──────────────────────────────────────
    app.get('/api/copilot/history/:id', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const uid = await currentUserId();
      if (!uid) return c.json({ error: 'no-user' }, 401);
      const convo = await loadConversation(uid, c.req.param('id'));
      if (!convo) return c.json({ error: 'not-found' }, 404);
      return c.json({ conversation: convo });
    });

    // ── POST /api/copilot/history/clear ───────────────────────────────────
    app.post('/api/copilot/history/clear', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const uid = await currentUserId();
      if (!uid) return c.json({ ok: true, cleared: 0 });
      const ids = (await redis.zRange(K.copilotIndex(uid), 0, -1).catch(() => [])) as
        | Array<{ member: string }>
        | string[];
      const flat = (Array.isArray(ids) ? ids : []).map((v: unknown) =>
        typeof v === 'string' ? v : (v as { member: string }).member,
      );
      for (const id of flat) {
        await redis.del(K.copilotConvo(uid, id)).catch(() => undefined);
      }
      await redis.del(K.copilotIndex(uid)).catch(() => undefined);
      return c.json({ ok: true, cleared: flat.length });
    });

    // ── POST /api/copilot/history/:id/delete ──────────────────────────────
    app.post('/api/copilot/history/:id/delete', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);
      const uid = await currentUserId();
      if (!uid) return c.json({ error: 'no-user' }, 401);
      const id = c.req.param('id');
      await redis.del(K.copilotConvo(uid, id)).catch(() => undefined);
      await redis.zRem(K.copilotIndex(uid), [id]).catch(() => undefined);
      return c.json({ ok: true });
    });
  },
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleChat(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  const body = chatBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
  }

  // Rate-limit (20 msg/min/installation; per-user enforcement is approximate
  // — Devvit Redis is per-installation, so a brand sub with many mods
  // shares one bucket. Acceptable for hackathon scope.)
  const allowed = await takeToken({ name: RATE_LIMIT_NAME, capacity: 20, refillPerSec: 0.33 });
  if (!allowed) {
    return c.json({ error: 'rate-limited' }, 429);
  }

  // Pre-flight cost cap.
  try {
    const spent = await readMonthlyCents();
    const cap = ((await readEffectiveSetting<number>('llm-monthly-cost-cap-cents').catch(
      () => null,
    )) ?? 500) as number;
    if (spent >= cap) {
      return c.json({ error: 'cost-cap-exceeded' }, 402);
    }
  } catch {
    /* non-fatal */
  }

  const uid = (await currentUserId()) ?? 'anon';

  // Load-or-create conversation
  let convo: CopilotConversation | null = body.data.conversationId
    ? await loadConversation(uid, body.data.conversationId)
    : null;
  if (!convo) {
    const id = newId('cv');
    convo = {
      id,
      userId: uid,
      title: body.data.message.slice(0, 60),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
  }

  const userMsg: CopilotMessage = {
    id: newId('m'),
    role: 'user',
    content: body.data.message,
    ts: Date.now(),
  };
  convo.messages.push(userMsg);

  // Provider
  const provider = await getProvider();
  if (!provider) {
    const assistantMsg: CopilotMessage = {
      id: newId('m'),
      role: 'assistant',
      content:
        'I cannot respond — no `openrouter-api-key` is configured. Add it under Settings → AI.',
      ts: Date.now(),
    };
    convo.messages.push(assistantMsg);
    convo.updatedAt = Date.now();
    await saveConversation(convo);
    return c.json({ conversationId: convo.id, message: assistantMsg });
  }

  // Trim messages — keep last 20 turns for the model.
  const recent = convo.messages.slice(-20);

  const collected: CopilotToolCall[] = [];
  const tools = buildAiTools(collected);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort('timeout'), TIMEOUT_MS);

  let assistantText = '';
  try {
    const result = await generateText({
      model: provider.handle,
      system: buildSystemPrompt(body.data.context),
      messages: recent.map((m) => ({
        role: m.role === 'tool' ? 'assistant' : (m.role as 'user' | 'assistant'),
        content: m.content,
      })),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      abortSignal: ac.signal,
      temperature: 0.3,
      maxOutputTokens: 800,
    });
    assistantText = result.text || (collected.length > 0 ? 'Done.' : 'No response.');
  } catch (err) {
    log.warn('copilot: generateText failed', { err: String(err) });
    assistantText = `Sorry — the model call failed (${err instanceof Error ? err.message : String(err)}).`;
  } finally {
    clearTimeout(timer);
  }

  const assistantMsg: CopilotMessage = {
    id: newId('m'),
    role: 'assistant',
    content: assistantText,
    ...(collected.length > 0 ? { toolCalls: collected } : {}),
    ts: Date.now(),
  };
  convo.messages.push(assistantMsg);

  // Cap stored history length per conversation.
  if (convo.messages.length > MAX_MESSAGES_PER_CONVO) {
    convo.messages = convo.messages.slice(-MAX_MESSAGES_PER_CONVO);
  }
  convo.updatedAt = Date.now();

  await saveConversation(convo);
  return c.json({ conversationId: convo.id, message: assistantMsg });
}

async function handleExecute(c: Context): Promise<Response> {
  if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

  const body = executeBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
  }

  const uid = (await currentUserId()) ?? 'anon';
  const convo = await loadConversation(uid, body.data.conversationId);
  if (!convo) return c.json({ error: 'not-found' }, 404);

  const msg = convo.messages.find((m) => m.id === body.data.messageId);
  if (!msg || !msg.toolCalls) return c.json({ error: 'no-tool-call' }, 404);
  const call = msg.toolCalls.find((tc) => tc.id === body.data.toolCallId);
  if (!call) return c.json({ error: 'no-tool-call' }, 404);
  if (call.committed?.ok) {
    return c.json({ ok: true, alreadyCommitted: true, result: call.committed.result });
  }

  const def = getTool(call.name);
  if (!def || def.safety !== 'write') {
    return c.json({ error: 'not-a-write-tool' }, 400);
  }
  const parsed = def.inputSchema.safeParse(call.args);
  if (!parsed.success) {
    return c.json({ error: 'invalid-args', issues: parsed.error.issues }, 400);
  }

  try {
    const result = await def.commit(parsed.data);
    call.committed = { ok: true, result, at: Date.now() };
    convo.updatedAt = Date.now();
    await saveConversation(convo);
    return c.json({ ok: true, result });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    call.committed = { ok: false, error, at: Date.now() };
    convo.updatedAt = Date.now();
    await saveConversation(convo);
    log.warn('copilot: commit failed', { tool: call.name, err: error });
    return c.json({ ok: false, error }, 500);
  }
}
