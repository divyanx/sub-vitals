/**
 * Generic Pipeline Runner
 *
 * Closes the long-standing TODO in dispatcher.ts: any catalogue-installed
 * or from-scratch pipeline instance now actually executes on its configured
 * trigger. Previously only the 6 hardcoded modules ran; spam-detector,
 * pii-detector, brand-mention-counter, fraud-detector, and any user-built
 * pipeline were saved but inert.
 *
 * What it does on each event:
 *   1. List enabled instances matching the trigger
 *   2. Skip instances backed by a hardcoded module (those already ran)
 *   3. Substitute {{post.title}} / {{post.body}} / {{comment.body}} into prompts
 *   4. Call llmObject() with a schema derived from the instance's outputSchema
 *   5. Write the result via recordTag() — same storage path the built-ins use,
 *      so the Pipelines tab renders without any extra wiring
 *
 * Failure isolation: per-instance try/catch. One pipeline blowing up cannot
 * stop the others or the rest of the trigger chain.
 *
 * Idempotency: keyed per-instance so re-running pipelines on the same post
 * after a config tweak is safe.
 */

import { clearProcessedSentinel, processedOnce } from '@shared/idempotency.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { getInstance, listEnabledInstances } from '@shared/pipeline-instances.js';
import { enqueueRetry } from '@shared/retry-queue.js';
import { readEffectiveSetting } from '@shared/settings-overrides.js';
import { recordTag } from '@shared/tags.js';
import type {
  OnCommentCreateRequest,
  OnPostCreateRequest,
  PipelineInstance,
  RedLatticeModule,
} from '@shared/types.js';
import { commentCreateMinimalSchema, postCreateMinimalSchema } from '@shared/validation.js';
import { z } from 'zod';

/**
 * Template IDs whose execution is owned by a hardcoded module
 * (sentiment, contact-drivers, theme-clustering, etc). The runner must NOT
 * fire for these instances or every post would get double-tagged.
 *
 * 'root-cause-summariser' is alpha and triggers on status-change, which the
 * generic runner doesn't subscribe to — listed here defensively.
 */
const HARDCODED_TEMPLATE_IDS = new Set<string>([
  'intent-classifier',
  'sentiment-scorer',
  'topic-clusterer',
  'impostor-flagger',
  'volume-spike-detector',
  'team-response-tracker',
  'root-cause-summariser',
]);

interface PostCtx {
  kind: 'post';
  id: string;
  title: string;
  body: string;
  author: string;
}

interface CommentCtx {
  kind: 'comment';
  id: string;
  body: string;
  author: string;
  postId?: string | undefined;
}

type RunCtx = PostCtx | CommentCtx;

/** Render `{{post.title}}` / `{{comment.body}}` etc. against the event ctx. */
function renderTemplate(template: string, ctx: RunCtx): string {
  const vars: Record<string, string> =
    ctx.kind === 'post'
      ? {
          'post.title': ctx.title,
          'post.body': ctx.body,
          'post.author': ctx.author,
        }
      : {
          'comment.body': ctx.body,
          'comment.author': ctx.author,
        };
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '');
}

/**
 * Build a zod schema matching the instance's declared output shape.
 *
 * Note: OpenAI's structured-output mode is strict — every property must be in
 * `required`. `.optional()` triggers "Missing 'X' in required" errors. We use
 * `.nullable()` for fields like `reasoning` that the model may legitimately
 * skip; `null` is preserved in the response.
 */
function schemaFor(instance: PipelineInstance): z.ZodTypeAny {
  const labels = instance.config.labels ?? [];
  switch (instance.config.outputSchema) {
    case 'boolean':
      return z.object({
        value: z.boolean(),
        reasoning: z.string().nullable(),
      });
    case 'scalar':
      return z.object({
        value: z.number(),
        reasoning: z.string().nullable(),
      });
    case 'label-confidence':
      return z.object({
        label: labels.length > 0 ? z.enum(labels as [string, ...string[]]) : z.string(),
        confidence: z.number().min(0).max(1),
        reasoning: z.string().nullable(),
      });
    case 'single-label':
      return z.object({
        label: labels.length > 0 ? z.enum(labels as [string, ...string[]]) : z.string(),
        reasoning: z.string().nullable(),
      });
    case 'cluster':
      // Cluster outputs are owned by the dedicated theme-clustering module.
      // Treat as a no-op here.
      return z.object({}).strict();
    default:
      return z.object({ value: z.string() });
  }
}

/** Extract the scalar tag value from the structured LLM output. */
function valueFromResult(
  instance: PipelineInstance,
  data: Record<string, unknown>,
): string | number | boolean | null {
  switch (instance.config.outputSchema) {
    case 'boolean':
      return typeof data.value === 'boolean' ? data.value : null;
    case 'scalar':
      return typeof data.value === 'number' ? data.value : null;
    case 'label-confidence':
    case 'single-label':
      return typeof data.label === 'string' ? data.label : null;
    default:
      return null;
  }
}

function confidenceFromResult(data: Record<string, unknown>): number | undefined {
  return typeof data.confidence === 'number' ? data.confidence : undefined;
}

/**
 * Run one instance against one event. Idempotent + isolated.
 * Returns true if the pipeline produced a tag, false otherwise.
 */
async function runInstance(instance: PipelineInstance, ctx: RunCtx): Promise<boolean> {
  // Idempotency: the same (instance, content) pair runs at most once.
  // Disambiguates from the per-module sentinels so re-running with a new
  // instance config doesn't collide with another pipeline's sentinel.
  const handlerKey = `generic-pipeline:${instance.id}`;
  if (!(await processedOnce(handlerKey, ctx.id))) return false;

  if (instance.config.outputSchema === 'cluster') return false;

  const rawSystem = renderTemplate(instance.config.systemPrompt, ctx);
  const user = renderTemplate(instance.config.userPrompt, ctx);

  const [brandName, brandVoice] = await Promise.all([
    readEffectiveSetting<string>('brand-name'),
    readEffectiveSetting<string>('brand-voice'),
  ]);
  const contextParts: string[] = [];
  if (brandName) contextParts.push(`Brand/community: ${brandName}`);
  if (brandVoice) contextParts.push(`Context: ${brandVoice}`);
  const system =
    contextParts.length > 0 ? `${contextParts.join('. ')}.\n\n${rawSystem}` : rawSystem;

  // Empty prompts mean this pipeline is regex-only (brand-mention-counter,
  // PII regex pre-filter) and isn't ready for generic LLM execution. Skip
  // gracefully rather than burn tokens on an empty prompt.
  if (!user.trim()) {
    log.info('generic-runner: skipping instance with empty prompt', {
      instanceId: instance.id,
      templateId: instance.templateId,
    });
    return false;
  }

  try {
    const result = await llmObject({
      name: `generic-pipeline:${instance.id}`,
      schema: schemaFor(instance) as z.ZodObject<z.ZodRawShape>,
      ...(system ? { system } : {}),
      prompt: user,
      // Reasoning models need headroom; llmObject auto-floors at 768 for
      // gpt-5 family. Pass a generous budget for non-reasoning fallback too.
      maxTokens: 300,
    });

    if (!result.ok) {
      log.warn('generic-runner: llm call failed', {
        instanceId: instance.id,
        templateId: instance.templateId,
        reason: result.reason,
      });
      // Push to DLQ on TRANSIENT failures so the scheduler can retry
      // later. Hard failures (no-api-key, cost-cap-exceeded) won't
      // benefit from retry — only retry when the upstream is likely
      // to recover on its own.
      if (
        result.reason === 'timeout' ||
        result.reason === 'rate-limited' ||
        result.reason === 'no-object' ||
        result.reason === 'error'
      ) {
        // Reset the processed-once sentinel BEFORE re-enqueueing so the
        // retry handler is allowed to re-run. Without this the next
        // attempt would short-circuit at the idempotency check.
        await clearProcessedSentinel(handlerKey, ctx.id);
        await enqueueRetry<RetryPayload>('pipeline-run', {
          instanceId: instance.id,
          targetType: ctx.kind,
          targetId: ctx.id,
        });
      }
      return false;
    }

    const data = result.data as Record<string, unknown>;
    const value = valueFromResult(instance, data);
    if (value === null) {
      log.warn('generic-runner: result did not match schema shape', {
        instanceId: instance.id,
        data,
      });
      return false;
    }

    const tagInput: Parameters<typeof recordTag>[0] = {
      pipelineId: instance.id,
      targetType: ctx.kind,
      targetId: ctx.id,
      value,
      by: 'ai',
      createdAt: Date.now(),
    };
    const confidence = confidenceFromResult(data);
    if (confidence !== undefined) tagInput.confidence = confidence;
    await recordTag(tagInput);

    log.info('generic-runner: tagged', {
      instanceId: instance.id,
      templateId: instance.templateId,
      targetType: ctx.kind,
      targetId: ctx.id,
      value: String(value),
    });
    return true;
  } catch (err) {
    log.error('generic-runner: instance threw', {
      instanceId: instance.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function runMatchingInstances(
  trigger: 'post-create' | 'comment-create',
  ctx: RunCtx,
): Promise<void> {
  const all = await listEnabledInstances();
  const candidates = all.filter(
    (i) => i.config.trigger === trigger && !HARDCODED_TEMPLATE_IDS.has(i.templateId),
  );
  if (candidates.length === 0) return;

  // Run sequentially: per-installation Redis rate limit is 60/min and we'd
  // rather degrade gracefully than burst N pipelines into a single tick.
  for (const instance of candidates) {
    await runInstance(instance, ctx);
  }
}

export const genericPipelineRunnerModule: RedLatticeModule = {
  name: 'generic-pipeline-runner',
  description:
    'Executes any catalogue-installed or scratch pipeline instance on its configured trigger.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onPostCreate(event: OnPostCreateRequest): Promise<void> {
    const parsed = postCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.post) return;
    const p = parsed.data.post;
    await runMatchingInstances('post-create', {
      kind: 'post',
      id: p.id,
      title: p.title ?? '',
      body: p.selftext ?? p.body ?? '',
      author: p.authorName ?? '',
    });
  },

  async onCommentCreate(event: OnCommentCreateRequest): Promise<void> {
    const parsed = commentCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.comment) return;
    const c = parsed.data.comment;
    await runMatchingInstances('comment-create', {
      kind: 'comment',
      id: c.id,
      body: c.body ?? '',
      author: c.authorName ?? '',
      postId: c.postId,
    });
  },
};

// ---------------------------------------------------------------------------
// Retry queue payload + handler — invoked by the rl-retry-sweep scheduler
// ---------------------------------------------------------------------------

/**
 * Payload pushed onto the `pipeline-run` retry queue when a pipeline LLM
 * call fails transiently (timeout, rate-limit, no-object). The scheduler
 * sweeps the queue every 5 min and replays one instance against one
 * target. Re-runs are safe because clearProcessedSentinel() is called
 * before enqueueing.
 */
export interface RetryPayload {
  instanceId: string;
  targetType: 'post' | 'comment';
  targetId: string;
}

/**
 * Retry handler — fetches the original content from Reddit, looks up the
 * instance config, and runs one pipeline pass. Used by the rl-retry-sweep
 * scheduler. Throws on persistent failure so retry-queue can re-schedule.
 */
export async function retryPipelineRun(payload: RetryPayload): Promise<void> {
  const { reddit } = await import('@devvit/web/server');
  const instance = await getInstance(payload.instanceId);
  if (!instance) {
    // Instance was deleted while job was queued — silently drop.
    log.info('generic-runner: retry skipped, instance gone', { ...payload });
    return;
  }
  if (!instance.enabled) {
    log.info('generic-runner: retry skipped, instance disabled', { ...payload });
    return;
  }

  if (payload.targetType === 'post') {
    const fullId = payload.targetId.startsWith('t3_')
      ? (payload.targetId as `t3_${string}`)
      : (`t3_${payload.targetId}` as `t3_${string}`);
    const post = await reddit.getPostById(fullId);
    await runInstance(instance, {
      kind: 'post',
      id: post.id,
      title: post.title ?? '',
      body: post.body ?? '',
      author: post.authorName ?? '',
    });
  } else {
    const fullId = payload.targetId.startsWith('t1_')
      ? (payload.targetId as `t1_${string}`)
      : (`t1_${payload.targetId}` as `t1_${string}`);
    const comment = await reddit.getCommentById(fullId);
    await runInstance(instance, {
      kind: 'comment',
      id: comment.id,
      body: comment.body ?? '',
      author: comment.authorName ?? '',
      postId: comment.postId,
    });
  }
}
