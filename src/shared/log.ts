/**
 * Structured JSON logger.
 *
 * Built on pino. Auto-injects per-request fields (subredditName, userId,
 * traceId) from Devvit's async-local `context`. Never log values whose keys
 * end in `-key`, `-secret`, or `-token` — those are redacted automatically.
 *
 * Usage:
 *   import { log } from '@shared/log';
 *   log.info('post tagged', { postId, driverId });
 */

import { context } from '@devvit/web/server';
import pino from 'pino';

const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'redlattice' },
  redact: {
    paths: ['*-key', '*-secret', '*-token', '*.apiKey', '*.secret', '*.token'],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

function withContext(fields?: Record<string, unknown>): Record<string, unknown> {
  // `context` access can throw if called outside a request scope (e.g. at
  // module load). Guard so logging never crashes the caller.
  let sub: string | undefined;
  let userId: string | undefined;
  let postId: string | undefined;
  try {
    sub = context.subredditName;
    userId = context.userId;
    postId = context.postId;
  } catch {
    /* outside request scope — no extra fields */
  }
  return {
    ...(sub && { sub }),
    ...(userId && { userId }),
    ...(postId && { postId }),
    ...fields,
  };
}

export const log = {
  debug(msg: string, fields?: Record<string, unknown>): void {
    base.debug(withContext(fields), msg);
  },
  info(msg: string, fields?: Record<string, unknown>): void {
    base.info(withContext(fields), msg);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    base.warn(withContext(fields), msg);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    base.error(withContext(fields), msg);
  },
};

export type Logger = typeof log;
