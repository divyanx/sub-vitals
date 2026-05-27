/**
 * Module 05 — Impostor Detection
 * Tier: CORE · Phase 1
 *
 * Inverse of agent verification. When a comment author CLAIMS to be from the
 * brand (e.g. "I work at Sonos", "as a Sonos engineer", "I'm from Sonos
 * support") but is NOT detected as a verified agent (no distinguished, not
 * a mod, no matching flair, no AgentRecord), we flag it for mod review.
 *
 * This is the safeguard against the "random people responding as brand and
 * committing random things" failure mode the user surfaced.
 *
 * Cost discipline:
 *   - Cheap regex pre-filter (zero cost) — most comments don't claim
 *     affiliation and never go to the LLM
 *   - LLM judge only when regex pre-fires AND author isn't verified
 *   - Per-author 24h cooldown so spammers don't drain the budget
 *   - Always behind the shared llm.ts rate limit + cost cap
 *
 * Mod notification:
 *   - On confirmed impersonation, fires a modmail with the thread link and
 *     the LLM's reasoning
 *   - 24h cooldown per author to prevent flood
 */

import { context, reddit, redis } from '@devvit/web/server';
import { buildBrandPrefix, getBrandContext } from '@shared/brand-context.js';
import { processedOnce } from '@shared/idempotency.js';
import { llmObject } from '@shared/llm.js';
import { log } from '@shared/log.js';
import { isUserMod } from '@shared/permissions.js';
import { readEffectiveSetting } from '@shared/settings-overrides.js';
import { isAgent } from '@shared/storage.js';
import type { OnCommentCreateRequest, RedLatticeModule } from '@shared/types.js';
import { commentCreateMinimalSchema } from '@shared/validation.js';
import { z } from 'zod';

const HANDLER = 'impostor-detection';

/**
 * Default regex pre-filter — catches the most common impersonation phrasings.
 * The brand name itself is interpolated from the brand-name setting; this
 * default list covers the language pattern regardless of brand.
 */
const CLAIM_PATTERNS_GENERIC: RegExp[] = [
  /\bi\s+(?:work|am\s+working)\s+(?:at|for|with)\b/i,
  /\bi'?m\s+(?:from|with|on)\s+(?:the\s+)?[A-Z][a-z]+\s+(?:team|support|engineering|brand|company)\b/i,
  /\bas\s+(?:a|an|the)\s+\w+\s+(?:engineer|employee|representative|rep|agent|mod|moderator)\b/i,
  /\bspeaking\s+(?:officially|on\s+behalf|as\s+a)\b/i,
  /\b(?:our|my)\s+team\s+(?:can|will|is|has)\b/i,
];

const llmSchema = z.object({
  isImpersonation: z.boolean(),
  confidence: z.number().min(0).max(1),
  claim: z.string().max(200),
  reasoning: z.string().max(200),
});

export const impostorDetectionModule: RedLatticeModule = {
  name: 'impostor-detection',
  description:
    'Flags comments from non-verified users that claim brand affiliation, to prevent impersonation.',
  tier: 'core',

  async enabled(): Promise<boolean> {
    return true;
  },

  async onCommentCreate(event: OnCommentCreateRequest): Promise<void> {
    const parsed = commentCreateMinimalSchema.safeParse(event);
    if (!parsed.success || !parsed.data.comment) return;
    const comment = parsed.data.comment;
    // Prefer top-level UserV2.name; CommentV2.authorName is not populated by Devvit.
    const commentAuthorName = parsed.data.author?.name ?? comment.authorName;
    if (!comment.body || comment.body.length < 20) return;
    if (!commentAuthorName || commentAuthorName === '[deleted]') return;

    // Idempotency — only check each comment once.
    if (!(await processedOnce(HANDLER, comment.id))) return;

    // Skip distinguished/mod/flair/whitelisted authors — they ARE the brand.
    if (comment.distinguishedBy === 'moderator' || comment.distinguishedBy === 'admin') return;
    try {
      if (await isUserMod(commentAuthorName)) return;
      if (await isAgent(commentAuthorName)) return;
    } catch (err) {
      log.warn('impostor: verification check failed (non-fatal)', { err: String(err) });
      return;
    }

    // Build the regex set — includes the configured brand name if any.
    const brandName = await readBrandName();
    if (!brandName) {
      // Without a brand name, we don't know what claims to look for. The
      // generic patterns still apply but are stricter.
      log.debug('impostor: no brand-name configured, skipping');
      return;
    }

    const patterns = [
      ...CLAIM_PATTERNS_GENERIC,
      new RegExp(`\\b(?:from|at|with)\\s+${escapeRe(brandName)}\\b`, 'i'),
      new RegExp(`\\bas\\s+(?:a|an)\\s+${escapeRe(brandName)}\\b`, 'i'),
      new RegExp(
        `\\b${escapeRe(brandName)}\\s+(?:engineer|employee|rep|representative|support|team)\\b`,
        'i',
      ),
      new RegExp(
        `\\bI\\s+(?:work|am\\s+working)\\s+(?:at|for|with)\\s+${escapeRe(brandName)}\\b`,
        'i',
      ),
    ];

    // Cheap pre-filter — most comments fail and we save the LLM call.
    const matched = patterns.some((re) => re.test(comment.body));
    if (!matched) return;

    log.info('impostor: pre-filter matched, escalating to LLM', {
      commentId: comment.id,
      authorName: commentAuthorName,
    });

    // 24h per-author cooldown to avoid modmail floods.
    const cooldownKey = `rl:impostor:cd:${commentAuthorName.toLowerCase()}`;
    const recent = await redis.get(cooldownKey);
    if (recent) {
      log.debug('impostor: author in cooldown, skipping modmail', {
        authorName: commentAuthorName,
      });
      return;
    }

    const brand = await getBrandContext();
    const result = await llmObject({
      name: 'impostor-judge',
      schema: llmSchema,
      system:
        buildBrandPrefix(brand) +
        'You audit Reddit comments for whether the author is FALSELY claiming to be an employee or representative of a brand. A genuine claim from someone unverified is a problem because they may commit the brand to things or mislead users. Return a strict judgment.',
      prompt: [
        `Brand we're protecting: ${brandName}`,
        `Comment author: u/${commentAuthorName} (not on our verified list, not a moderator)`,
        `Comment text:\n"""${comment.body.slice(0, 1500)}"""`,
        '',
        'Does this comment make a substantive claim that the author works at, represents, or speaks for the brand? Ignore generic statements like "I love this brand" or third-person "their support team is great" — only flag first-person affiliation claims. Reply with isImpersonation (boolean), confidence (0-1), the exact claim phrase, and one-sentence reasoning.',
      ].join('\n'),
      maxTokens: 180,
    });

    if (!result.ok) {
      log.warn('impostor: LLM call failed', { reason: result.reason });
      return;
    }
    if (!result.data.isImpersonation || result.data.confidence < 0.7) {
      log.debug('impostor: LLM cleared the comment', {
        confidence: result.data.confidence,
      });
      return;
    }

    // Confirmed — modmail the team.
    const subredditName = context.subredditName;
    if (!subredditName || !comment.postId) return;
    const postIdShort = comment.postId.replace('t3_', '');
    const commentUrl = `https://www.reddit.com/r/${subredditName}/comments/${postIdShort}/_/${comment.id.replace('t1_', '')}`;
    const body = [
      `⚠️ **Possible impostor**`,
      '',
      `u/${commentAuthorName} appears to be claiming affiliation with **${brandName}** without being on the verified-agent list.`,
      '',
      `**Detected claim:** ${result.data.claim}`,
      `**Confidence:** ${(result.data.confidence * 100).toFixed(0)}%`,
      `**Reasoning:** ${result.data.reasoning}`,
      '',
      `**Link to comment:** ${commentUrl}`,
      '',
      'If this person actually is on your team, mark them as a verified agent (comment menu → "Mark verified agent") and SubVitals will stop flagging them. If they are not, consider replying publicly to set the record straight.',
    ].join('\n');

    try {
      await reddit.modMail.createConversation({
        subredditName,
        to: null,
        subject: `[SubVitals] Possible impostor: u/${commentAuthorName}`,
        body,
      });
      await redis.set(cooldownKey, '1', {
        expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      log.info('impostor: modmail sent', {
        authorName: commentAuthorName,
        commentId: comment.id,
        confidence: result.data.confidence,
      });
    } catch (err) {
      log.error('impostor: modmail create failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },
};

async function readBrandName(): Promise<string> {
  try {
    const v = await readEffectiveSetting<string>('brand-name');
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
