/**
 * Module 08 — Audit Log
 * Tier: CORE · Phase 2
 *
 * Records every mutating action performed by mods to a per-installation
 * Redis ZSET capped at 5000 entries. Score = timestamp (ms) so the set is
 * always sorted by time. Members are JSON-encoded entries prefixed with the
 * timestamp to guarantee uniqueness within the same millisecond.
 *
 * Key: rl:audit:log (ZSET, score = ts, member = "<ts>:<nonce>:<json>")
 *
 * Entry shape (decoded): { ts, actor, action, target, meta? }
 *   - ts      ms timestamp
 *   - actor   username (null if context has no user)
 *   - action  kebab-case verb (see AuditAction)
 *   - target  entity id (postId, commentId, …) or null
 *   - meta    optional key/value bag with extra context
 *
 * recordAudit is fire-and-forget safe — it never throws. Callers can
 * `await` it for ordering guarantees or skip the await when the mutation
 * is already committed and audit failure must not roll anything back.
 *
 * Cap enforcement: after each write, trim the oldest entries so the set
 * never exceeds AUDIT_CAP entries (zRemRangeByRank removes from rank 0
 * upward, i.e. oldest-first since score = ts ascending).
 */

import { reddit, redis } from '@devvit/web/server';
import { K } from '@shared/keys.js';
import { log } from '@shared/log.js';
import { requireMod } from '@shared/permissions.js';
import type { RedLatticeModule } from '@shared/types.js';
import type { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'tag-issue'
  | 'mark-resolved'
  | 'mark-open'
  | 'mark-agent'
  | 'unmark-agent'
  | 'settings-update'
  | 'incident-resolve'
  | 'theme-regenerate'
  | 'bulk-status'
  | 'mod-approve'
  | 'mod-remove'
  | 'mod-spam'
  | 'mod-lock'
  | 'mod-distinguish'
  | 'mod-reply'
  | 'rule-fired'
  | 'rule-audit';

export interface AuditEntry {
  ts: number;
  actor: string | null;
  action: AuditAction;
  target: string | null;
  meta?: Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIT_CAP = 5000;

// ---------------------------------------------------------------------------
// Internal: monotonic nonce to ensure uniqueness within the same millisecond
// ---------------------------------------------------------------------------

let _nonce = 0;

function nextNonce(): number {
  _nonce = (_nonce + 1) % 1_000_000;
  return _nonce;
}

// ---------------------------------------------------------------------------
// Core helper — exported for use by other modules
// ---------------------------------------------------------------------------

/**
 * Record a mutating action to the audit log.
 *
 * Never throws — any error is logged at warn level and swallowed so that
 * an audit failure cannot break the caller's mutation path.
 *
 * Fire-and-forget usage (acceptable when mutation is already committed):
 *   void recordAudit('tag-issue', postId, { driverId });
 *
 * Awaited usage (preferred when order of operations matters):
 *   await recordAudit('mark-resolved', postId);
 */
export async function recordAudit(
  action: AuditAction,
  target: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    let actor: string | null = null;
    try {
      actor = (await reddit.getCurrentUsername()) ?? null;
    } catch {
      // getCurrentUsername can fail outside a request context — treat as null.
    }

    const ts = Date.now();
    const entry: AuditEntry = {
      ts,
      actor,
      action,
      target,
      ...(meta !== undefined ? { meta } : {}),
    };

    const nonce = nextNonce();
    // Member is prefixed with ts + nonce so members are unique even when two
    // actions land in the same millisecond. Prefix is stripped on read.
    const member = `${ts}:${nonce}:${JSON.stringify(entry)}`;
    const key = K.auditLog();

    await redis.zAdd(key, { score: ts, member });

    // Trim oldest entries so the ZSET stays capped at AUDIT_CAP.
    // ZSET is sorted ascending by score (ts). Rank 0 is the oldest.
    // After inserting we may have AUDIT_CAP + 1 entries; remove rank 0.
    // Using zRemRangeByRank(key, 0, -(AUDIT_CAP + 1)) removes everything
    // from rank 0 up to the (totalCount - AUDIT_CAP)-th entry.
    // Simpler: remove rank 0 to (totalCount - AUDIT_CAP - 1).
    // We approximate: just trim to -(AUDIT_CAP + 1) which handles bursts too.
    await redis.zRemRangeByRank(key, 0, -(AUDIT_CAP + 1));
  } catch (err) {
    log.warn('audit-log: recordAudit failed (non-fatal)', { err: String(err), action, target });
  }
}

// ---------------------------------------------------------------------------
// Internal: decode a ZSET member back to AuditEntry
// ---------------------------------------------------------------------------

function decodeMember(member: string): AuditEntry | null {
  // Format: "<ts>:<nonce>:<json>"
  const firstColon = member.indexOf(':');
  if (firstColon < 0) return null;
  const secondColon = member.indexOf(':', firstColon + 1);
  if (secondColon < 0) return null;
  const jsonStr = member.slice(secondColon + 1);
  try {
    return JSON.parse(jsonStr) as AuditEntry;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const auditLogModule: RedLatticeModule = {
  name: 'audit-log',
  description: 'Records mutating mod actions to a capped per-installation audit trail.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  apiRoutes(app: Hono): void {
    /**
     * GET /api/audit?limit=100&action=tag-issue&actor=username
     *
     * Returns the most recent audit entries (descending by timestamp).
     * Supports optional in-memory filtering by action and/or actor.
     *
     * Mod-only.
     */
    app.get('/api/audit', async (c) => {
      if (!(await requireMod())) return c.json({ error: 'mod-only' }, 403);

      const limitParam = Number.parseInt(c.req.query('limit') ?? '100', 10);
      const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
      const actionFilter = c.req.query('action') ?? null;
      const actorFilter = c.req.query('actor') ?? null;

      const key = K.auditLog();
      // Fetch more than requested when filters are active so filtering doesn't
      // silently truncate results. Without filters, a 1-pass fetch is fine.
      const fetchCount = actionFilter !== null || actorFilter !== null ? AUDIT_CAP : limit;

      // Fetch newest first: reverse=true, by='rank', from rank 0 to fetchCount-1
      // In a descending zRange, rank 0 is the highest score (newest entry).
      const members = await redis.zRange(key, 0, fetchCount - 1, {
        reverse: true,
        by: 'rank',
      });

      const entries: AuditEntry[] = [];
      for (const m of members) {
        const entry = decodeMember(m.member);
        if (!entry) continue;
        if (actionFilter !== null && entry.action !== actionFilter) continue;
        if (actorFilter !== null && (entry.actor ?? '').toLowerCase() !== actorFilter.toLowerCase())
          continue;
        entries.push(entry);
        if (entries.length >= limit) break;
      }

      return c.json({ count: entries.length, entries });
    });
  },
};
