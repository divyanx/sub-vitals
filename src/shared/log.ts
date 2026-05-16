/**
 * Structured JSON logger.
 *
 * Uses console.{log,warn,error} so Devvit's `devvit logs` capture picks it up
 * (Devvit hooks the console object, not stdout fd 1). Each call emits one
 * JSON line. Per-request fields (subredditName, userId, postId) are pulled
 * from Devvit's async-local `context` when available.
 *
 * Secrets whose keys end in `-key`, `-secret`, `-token`, or whose key is
 * `apiKey`, `secret`, `token`, are redacted recursively before emission.
 *
 * Why not pino: it relies on a worker thread for non-sync transports which
 * isn't reliable in Devvit's sandboxed Node runtime, and its output bypasses
 * `console.*`. A 40-line shim does what we need.
 */

import { context } from '@devvit/web/server';

type Fields = Record<string, unknown>;
type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACT_KEY_RE = /(?:^|-)(?:key|secret|token|apikey|api[-_]key)$/i;

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields)) {
      out[k] = REDACT_KEY_RE.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

function contextFields(): Fields {
  try {
    const fields: Fields = {};
    if (context.subredditName) fields.sub = context.subredditName;
    if (context.userId) fields.userId = context.userId;
    if (context.username) fields.username = context.username;
    if (context.postId) fields.postId = context.postId;
    return fields;
  } catch {
    return {};
  }
}

function emit(level: Level, msg: string, fields?: Fields): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    app: 'redlattice',
    msg,
    ...contextFields(),
    ...((fields ? (redact(fields) as Fields) : undefined) ?? {}),
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug(msg: string, fields?: Fields): void {
    emit('debug', msg, fields);
  },
  info(msg: string, fields?: Fields): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields?: Fields): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields?: Fields): void {
    emit('error', msg, fields);
  },
};

export type Logger = typeof log;
