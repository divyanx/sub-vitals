/**
 * Webhook delivery helper.
 *
 * `deliverWebhook(webhookId, eventKind, payload)` — looks up the webhook
 * record, format-adapts the payload (Slack / Discord / PagerDuty / generic),
 * signs with HMAC-SHA256, delivers with 1 retry on 5xx, logs the outcome to
 * the deliveries ZSET, and never throws to the caller.
 *
 * `notifyWebhooks(eventKind, payload)` — fan-out to all enabled webhooks that
 * subscribe to the given event kind (or '*').
 *
 * Storage:
 *   rl:webhooks           HASH  id → JSON Webhook
 *   rl:webhook:del:{id}   ZSET  score = ts, member = JSON delivery record
 */

import { redis } from '@devvit/web/server';
import { log } from './log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebhookFormat = 'slack' | 'discord' | 'pagerduty' | 'generic';

export type WebhookEventKind =
  | 'post-tag'
  | 'sentiment-spike'
  | 'incident-open'
  | 'incident-resolve'
  | 'theme-regenerate'
  | 'custom-rule-fire'
  | '*';

export interface Webhook {
  id: string;
  name: string;
  targetUrl: string;
  events: string[];
  enabled: boolean;
  secret: string;
  format: WebhookFormat;
  createdAt: number;
}

export interface WebhookDelivery {
  eventKind: string;
  statusCode: number | null;
  success: boolean;
  responseExcerpt: string;
  attemptedAt: number;
}

export interface DeliverResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Redis keys (must stay in sync with src/shared/keys.ts constants)
// ---------------------------------------------------------------------------

const WEBHOOK_HASH = 'rl:webhooks';
const MAX_DELIVERIES = 50;

function deliveryKey(webhookId: string): string {
  return `rl:webhook:del:${webhookId}`;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256
// ---------------------------------------------------------------------------

async function hmacSha256(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export function detectFormat(url: string, declared: WebhookFormat): WebhookFormat {
  if (declared !== 'generic') return declared;
  if (/hooks\.slack\.com/i.test(url)) return 'slack';
  if (/discord\.com\/api\/webhooks/i.test(url)) return 'discord';
  if (/events\.pagerduty\.com/i.test(url)) return 'pagerduty';
  return 'generic';
}

// ---------------------------------------------------------------------------
// Payload adapters
// ---------------------------------------------------------------------------

const EVENT_COLOR: Record<string, number> = {
  'incident-open': 0xff2200,
  'sentiment-spike': 0xff8800,
  'custom-rule-fire': 0xffaa00,
  'post-tag': 0x0088ff,
  'incident-resolve': 0x00cc66,
  'theme-regenerate': 0x9933ff,
};

function buildSlackBody(event: string, payload: Record<string, unknown>): unknown {
  const fields = Object.entries(payload)
    .slice(0, 6)
    .map(([k, v]) => ({
      type: 'mrkdwn',
      text: `*${k}*\n${typeof v === 'object' ? JSON.stringify(v) : String(v)}`,
    }));
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `RedLattice · ${event}`, emoji: true },
      },
      ...(fields.length > 0
        ? [{ type: 'section', fields }]
        : [{ type: 'section', text: { type: 'mrkdwn', text: '_No additional fields._' } }]),
    ],
  };
}

function buildDiscordBody(event: string, payload: Record<string, unknown>): unknown {
  const color = EVENT_COLOR[event] ?? 0x5865f2;
  const fields = Object.entries(payload)
    .slice(0, 6)
    .map(([k, v]) => ({
      name: k,
      value: String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 1024),
      inline: true,
    }));
  return {
    embeds: [
      {
        title: `RedLattice · ${event}`,
        description: `Event fired at <t:${Math.floor(Date.now() / 1000)}:T>`,
        color,
        fields,
      },
    ],
  };
}

function buildPagerDutyBody(event: string, payload: Record<string, unknown>): unknown {
  const severity = event.includes('incident') ? 'critical' : 'warning';
  return {
    routing_key: '', // callers using PD should set this in their URL or via payload override
    event_action: event === 'incident-resolve' ? 'resolve' : 'trigger',
    payload: {
      summary: `RedLattice: ${event}`,
      source: 'redlattice-devvit',
      severity,
      custom_details: payload,
    },
  };
}

function buildGenericBody(
  event: string,
  ts: number,
  payload: Record<string, unknown>,
  signature: string,
): unknown {
  return { event, ts, payload, signature };
}

// ---------------------------------------------------------------------------
// Core delivery — called by deliverWebhook AND the /test endpoint
// ---------------------------------------------------------------------------

interface DeliverOptions {
  skipLog?: boolean; // true for /test endpoint
}

export async function deliverWebhook(
  webhookId: string,
  eventKind: string,
  payload: Record<string, unknown>,
  opts: DeliverOptions = {},
): Promise<DeliverResult> {
  // Load webhook record.
  let webhook: Webhook;
  try {
    const raw = await redis.hGet(WEBHOOK_HASH, webhookId);
    if (!raw) return { ok: false, error: 'webhook not found' };
    webhook = JSON.parse(raw) as Webhook;
  } catch (err) {
    return {
      ok: false,
      error: `redis read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!webhook.enabled) return { ok: false, error: 'webhook disabled' };

  const format = detectFormat(webhook.targetUrl, webhook.format);
  const ts = Date.now();

  // Build body.
  let bodyObj: unknown;
  let hexSig: string;
  try {
    hexSig = await hmacSha256(`${ts}.${JSON.stringify(payload)}`, webhook.secret);
    switch (format) {
      case 'slack':
        bodyObj = buildSlackBody(eventKind, payload);
        break;
      case 'discord':
        bodyObj = buildDiscordBody(eventKind, payload);
        break;
      case 'pagerduty':
        bodyObj = buildPagerDutyBody(eventKind, payload);
        break;
      default:
        bodyObj = buildGenericBody(eventKind, ts, payload, `sha256=${hexSig}`);
    }
  } catch (err) {
    const error = `sign/format error: ${err instanceof Error ? err.message : String(err)}`;
    log.error('webhook-delivery: build failed', { webhookId, eventKind, error });
    return { ok: false, error };
  }

  const rawBody = JSON.stringify(bodyObj);

  // Attempt delivery with 1 retry on 5xx.
  const attempt = async (): Promise<{ statusCode: number; ok: boolean; excerpt: string }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(webhook.targetUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-redlattice-signature': `sha256=${hexSig}`,
          'x-redlattice-timestamp': String(ts),
          'x-redlattice-event': eventKind,
        },
        body: rawBody,
        signal: ctrl.signal,
      });
      const text = (await res.text().catch(() => '')).slice(0, 200);
      return { statusCode: res.status, ok: res.ok, excerpt: text };
    } finally {
      clearTimeout(timer);
    }
  };

  let result: { statusCode: number; ok: boolean; excerpt: string };
  try {
    result = await attempt();
    if (!result.ok && result.statusCode >= 500) {
      // 1 retry after 2s on 5xx
      await new Promise((r) => setTimeout(r, 2_000));
      result = await attempt();
    }
  } catch (err) {
    const error = `fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    log.error('webhook-delivery: fetch threw', { webhookId, eventKind, error });
    if (!opts.skipLog) {
      await logDelivery(webhookId, {
        eventKind,
        statusCode: null,
        success: false,
        responseExcerpt: error,
        attemptedAt: ts,
      }).catch(() => undefined);
    }
    return { ok: false, error };
  }

  const deliveryRecord: WebhookDelivery = {
    eventKind,
    statusCode: result.statusCode,
    success: result.ok,
    responseExcerpt: result.excerpt,
    attemptedAt: ts,
  };

  if (!opts.skipLog) {
    await logDelivery(webhookId, deliveryRecord).catch((err) => {
      log.warn('webhook-delivery: failed to log delivery', {
        webhookId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  log.info('webhook-delivery: delivered', {
    webhookId,
    eventKind,
    status: result.statusCode,
    ok: result.ok,
  });

  return result.ok
    ? { ok: true, statusCode: result.statusCode }
    : { ok: false, statusCode: result.statusCode, error: `HTTP ${result.statusCode}` };
}

// ---------------------------------------------------------------------------
// Delivery log helpers
// ---------------------------------------------------------------------------

async function logDelivery(webhookId: string, record: WebhookDelivery): Promise<void> {
  const key = deliveryKey(webhookId);
  const member = JSON.stringify(record);
  await redis.zAdd(key, { score: record.attemptedAt, member });
  // Cap at MAX_DELIVERIES — remove oldest entries beyond the cap
  await redis.zRemRangeByRank(key, 0, -(MAX_DELIVERIES + 1));
}

export async function getDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
  const key = deliveryKey(webhookId);
  const members = await redis.zRange(key, 0, -1, { by: 'rank', reverse: true });
  return members.map((m) => {
    try {
      return JSON.parse(
        typeof m === 'string' ? m : (m as { member: string }).member,
      ) as WebhookDelivery;
    } catch {
      return {
        eventKind: 'unknown',
        statusCode: null,
        success: false,
        responseExcerpt: 'parse error',
        attemptedAt: 0,
      };
    }
  });
}

// ---------------------------------------------------------------------------
// CRUD helpers for webhooks (used by server routes)
// ---------------------------------------------------------------------------

export async function listWebhooks(): Promise<Webhook[]> {
  const all = await redis.hGetAll(WEBHOOK_HASH);
  return Object.values(all)
    .map((v) => {
      try {
        return JSON.parse(v) as Webhook;
      } catch {
        return null;
      }
    })
    .filter((w): w is Webhook => w !== null)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function getWebhook(id: string): Promise<Webhook | null> {
  const raw = await redis.hGet(WEBHOOK_HASH, id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Webhook;
  } catch {
    return null;
  }
}

export async function saveWebhook(webhook: Webhook): Promise<void> {
  await redis.hSet(WEBHOOK_HASH, { [webhook.id]: JSON.stringify(webhook) });
}

export async function deleteWebhook(id: string): Promise<void> {
  await redis.hDel(WEBHOOK_HASH, [id]);
  // Best-effort cleanup of delivery log
  try {
    const key = deliveryKey(id);
    // Delete all members
    await redis.zRemRangeByRank(key, 0, -1);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

/**
 * Notify all enabled webhooks subscribed to `eventKind` (or '*').
 * Runs deliveries in parallel; never throws.
 */
export async function notifyWebhooks(
  eventKind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let webhooks: Webhook[];
  try {
    webhooks = await listWebhooks();
  } catch (err) {
    log.error('notifyWebhooks: failed to list webhooks', {
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const targets = webhooks.filter(
    (w) => w.enabled && (w.events.includes(eventKind) || w.events.includes('*')),
  );

  if (targets.length === 0) return;

  await Promise.allSettled(
    targets.map((w) =>
      deliverWebhook(w.id, eventKind, payload).catch((err) => {
        log.error('notifyWebhooks: delivery threw unexpectedly', {
          webhookId: w.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }),
    ),
  );
}
