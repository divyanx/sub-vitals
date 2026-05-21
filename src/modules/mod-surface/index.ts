/**
 * Mod-surface — project RedLattice pipeline analysis into the *native*
 * Reddit moderation UI so mods see enrichment in the places they already
 * work (mod queue, post page) without ever opening our dashboard.
 *
 * Two projections:
 *   1. POST FLAIR — composite chip from current tags. Visible inline in
 *      the mod queue. Examples: "🚨 spam", "🚨 fraud", "🐛 bug · 😡",
 *      "✓ ok · 😊". Recomputed idempotently on every tag-write.
 *   2. STICKY DISTINGUISHED COMMENT — for high-signal posts (spam=true,
 *      fraud=true, or bug+strong-negative). Compact markdown summary of
 *      every pipeline result so the mod sees full context one click in.
 *      Posted at most once per post (sentinel guards re-runs).
 *
 * Why hook into recordTag() instead of running on onPostCreate:
 *   Pipelines complete asynchronously over several seconds. By the time
 *   onPostCreate handlers return, the LLM tag-writes haven't landed yet.
 *   We fire on every tag-write and recompute from the full current set —
 *   each call is a no-op if nothing changed, and the per-post lock
 *   coalesces the 4-5 writes that arrive within a few seconds.
 */

import { context, reddit, redis } from '@devvit/web/server';
import { log } from '@shared/log.js';
import { getTagsForTarget } from '@shared/tags.js';
import type { Tag } from '@shared/types.js';

// ---------------------------------------------------------------------------
// Lock + sentinel keys
// ---------------------------------------------------------------------------

const FLAIR_LOCK_TTL_SEC = 2;
const COMMENT_SENTINEL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days — re-comment if a stale post is re-flagged later

const lockKey = (postId: string) => `rl:modsurf:lock:${postId}`;
const commentKey = (postId: string) => `rl:modsurf:comment:${postId}`;

// ---------------------------------------------------------------------------
// Flair derivation
// ---------------------------------------------------------------------------

interface FlairChoice {
  text: string;
  backgroundColor: string;
  textColor: 'light' | 'dark';
}

const SENTIMENT_ICON: Record<string, string> = {
  positive: '😊',
  neutral: '😐',
  negative: '😡',
};

const INTENT_ICON: Record<string, string> = {
  bug: '🐛',
  refund: '💸',
  feature_request: '💡',
  praise: '🌟',
  question: '❓',
  account: '👤',
  billing: '💳',
  other: '•',
};

/** Format a value for display in the flair chip. */
function valueLabel(v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return v;
}

/**
 * Build a single composite flair chip. Priority: fraud > spam > impostor
 * > intent+sentiment > sentiment alone. Returns null when there are no
 * tags worth showing (caller should leave existing flair alone).
 */
function buildFlair(tags: Tag[]): FlairChoice | null {
  // Catalogue instance IDs use pi_<templateId> for preinstalled. We also
  // need to scan custom installed instances by templateId match against
  // pipelineId — but tags carry the *instance* id, not template id. So we
  // search both well-known instance ids AND legacy ids.
  const findByEither = (templateId: string, hardcodedId?: string): Tag | undefined =>
    tags.find(
      (t) =>
        t.pipelineId === `pi_${templateId}` ||
        t.pipelineId === templateId ||
        (hardcodedId !== undefined && t.pipelineId === hardcodedId),
    );

  const fraud = findByEither('fraud-detector');
  if (fraud && (fraud.value === true || fraud.value === 'true')) {
    return { text: '🚨 fraud', backgroundColor: '#7a0e0e', textColor: 'light' };
  }

  const spam = findByEither('spam-detector');
  if (spam && (spam.value === true || spam.value === 'true')) {
    return { text: '🚨 spam', backgroundColor: '#5b1717', textColor: 'light' };
  }

  const impostor = findByEither('impostor-flagger', 'impostor');
  if (impostor && (impostor.value === true || impostor.value === 'true')) {
    return { text: '🎭 impostor', backgroundColor: '#8a4500', textColor: 'light' };
  }

  const intent = findByEither('intent-classifier', 'contact-drivers');
  const sentiment = findByEither('sentiment-scorer', 'sentiment');
  const pii = findByEither('pii-detector');
  const brandMentions = findByEither('brand-mention-counter');

  if (intent || sentiment || pii || brandMentions) {
    const intentValue = intent ? valueLabel(intent.value) : '';
    const sentimentValue = sentiment ? valueLabel(sentiment.value) : '';
    const intentIcon = INTENT_ICON[intentValue] ?? '•';
    const sentimentIcon = SENTIMENT_ICON[sentimentValue] ?? '';

    // Pack as many signals into the one flair slot Reddit gives us as
    // possible — the queue list only shows this one chip.
    const parts: string[] = [];
    if (intent) parts.push(`${intentIcon} ${intentValue}`);
    if (sentiment) parts.push(sentimentIcon);
    if (pii && (pii.value === true || pii.value === 'true')) parts.push('🔒');
    if (brandMentions && typeof brandMentions.value === 'number' && brandMentions.value > 0) {
      parts.push(`📊${brandMentions.value}`);
    }
    const text = parts.join(' · ').slice(0, 64);

    const bg =
      sentimentValue === 'negative'
        ? '#3d1a1a'
        : sentimentValue === 'positive'
          ? '#0e3a22'
          : '#2a2a2a';
    return { text, backgroundColor: bg, textColor: 'light' };
  }

  return null;
}

/**
 * Decide whether to post the sticky distinguished analysis comment.
 *
 * Rule: post once a post has accumulated 2+ meaningful tags, OR any
 * single high-signal tag (spam/fraud/pii/impostor true). Mods asked for
 * "show me ALL the enrichment in the queue" — since Reddit gives us one
 * flair slot, the sticky comment is where the full picture lives.
 *
 * Threshold of 2 (not 1) keeps us from auto-commenting on posts where
 * only sentiment landed; one tag isn't worth the noise.
 */
function shouldComment(tags: Tag[]): boolean {
  const findByEither = (templateId: string, hardcodedId?: string): Tag | undefined =>
    tags.find(
      (t) =>
        t.pipelineId === `pi_${templateId}` ||
        t.pipelineId === templateId ||
        (hardcodedId !== undefined && t.pipelineId === hardcodedId),
    );

  // Any single high-signal tag → comment.
  const spam = findByEither('spam-detector');
  if (spam && (spam.value === true || spam.value === 'true')) return true;
  const fraud = findByEither('fraud-detector');
  if (fraud && (fraud.value === true || fraud.value === 'true')) return true;
  const pii = findByEither('pii-detector');
  if (pii && (pii.value === true || pii.value === 'true')) return true;
  const impostor = findByEither('impostor-flagger', 'impostor');
  if (impostor && (impostor.value === true || impostor.value === 'true')) return true;

  // Otherwise: post when at least two pipelines have produced anything.
  // Filter out the boolean=false noise so a "no spam, no fraud" pair
  // doesn't count as 2 tags.
  const meaningful = tags.filter((t) => {
    if (typeof t.value === 'boolean') return t.value === true;
    if (typeof t.value === 'number') return t.value !== 0;
    return String(t.value).trim().length > 0;
  });
  return meaningful.length >= 2;
}

/** Friendly display name for known pipelines; falls through to raw id. */
const PIPELINE_DISPLAY: Record<string, string> = {
  'pi_intent-classifier': 'Intent',
  'contact-drivers': 'Intent',
  'pi_sentiment-scorer': 'Sentiment',
  sentiment: 'Sentiment',
  'pi_topic-clusterer': 'Topic',
  'pi_impostor-flagger': 'Impostor',
  impostor: 'Impostor',
  'pi_volume-spike-detector': 'Volume spike',
  crisis: 'Volume spike',
  'pi_team-response-tracker': 'Team response',
  'pi_spam-detector': 'Spam',
  'spam-detector': 'Spam',
  'pi_fraud-detector': 'Fraud',
  'fraud-detector': 'Fraud',
  'pi_pii-detector': 'PII',
  'pii-detector': 'PII',
  'pi_brand-mention-counter': 'Brand mentions',
};

function displayName(pipelineId: string): string {
  return PIPELINE_DISPLAY[pipelineId] ?? pipelineId;
}

function renderCommentBody(tags: Tag[]): string {
  // Order: high-signal flags first, then intent/sentiment, then the rest.
  const priority = (t: Tag): number => {
    const n = displayName(t.pipelineId);
    if (n === 'Fraud' || n === 'Spam' || n === 'PII' || n === 'Impostor') return 0;
    if (n === 'Intent') return 1;
    if (n === 'Sentiment') return 2;
    return 3;
  };
  const sorted = [...tags].sort((a, b) => priority(a) - priority(b));

  const rows = sorted
    .map((t) => {
      const v = valueLabel(t.value);
      const conf = t.confidence !== undefined ? ` _(${Math.round(t.confidence * 100)}%)_` : '';
      const by = t.by === 'ai' ? 'AI' : t.by === 'lexicon' ? 'lexicon' : 'mod';
      return `| **${displayName(t.pipelineId)}** | \`${v}\`${conf} | ${by} |`;
    })
    .join('\n');

  return [
    '### 🔬 RedLattice analysis',
    '',
    '| Pipeline | Result | Source |',
    '|---|---|---|',
    rows,
    '',
    `_${tags.length} ${tags.length === 1 ? 'pipeline' : 'pipelines'} ran on this post._ ` +
      '_Edit pipelines + rules in the RedLattice dashboard._',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main entry — call this from recordTag() in tags.ts
// ---------------------------------------------------------------------------

/**
 * Re-derive flair (and post a sticky analysis comment for high-signal
 * posts) from the current tag set. Safe to call repeatedly — per-post
 * lock coalesces the rapid fire from 4-5 pipelines.
 */
export async function recomputeForPost(postId: string): Promise<void> {
  // Skip if a recompute is already in flight for this post.
  // setIfNotExists is unavailable in this Devvit Redis snapshot, so we
  // approximate with: get existing -> bail if present, else set with TTL.
  try {
    const existing = await redis.get(lockKey(postId));
    if (existing) return;
    await redis.set(lockKey(postId), '1');
    await redis.expire(lockKey(postId), FLAIR_LOCK_TTL_SEC);
  } catch (err) {
    // Locking is best-effort; carry on if Redis hiccups.
    log.warn('mod-surface: lock failed (non-fatal)', { err: String(err) });
  }

  const tags = await getTagsForTarget('post', postId);
  if (tags.length === 0) return;

  const sub = context.subredditName;
  if (!sub) return;

  // 1. Update flair
  const flair = buildFlair(tags);
  if (flair) {
    try {
      await reddit.setPostFlair({
        subredditName: sub,
        postId: `t3_${postId}` as `t3_${string}`,
        text: flair.text,
        backgroundColor: flair.backgroundColor,
        textColor: flair.textColor,
      });
      log.info('mod-surface: flair set', { postId, text: flair.text });
    } catch (err) {
      // Most common failure: the sub doesn't have flair templates
      // configured, or the API rejects an unknown color. Either way,
      // continue — flair is best-effort.
      log.warn('mod-surface: setPostFlair failed (non-fatal)', {
        postId,
        err: String(err),
      });
    }
  }

  // 2. Sticky distinguished analysis comment, once per post
  if (shouldComment(tags)) {
    try {
      const already = await redis.get(commentKey(postId));
      if (!already) {
        const body = renderCommentBody(tags);
        const comment = await reddit.submitComment({
          id: `t3_${postId}` as `t3_${string}`,
          text: body,
        });
        // distinguish() with sticky=true so the comment pins to the top
        // and shows the green [M] badge.
        try {
          await comment.distinguish(true);
        } catch (err) {
          // Some Devvit versions of distinguish are no-ops; safe to ignore.
          log.warn('mod-surface: distinguish failed (non-fatal)', { err: String(err) });
        }
        await redis.set(commentKey(postId), '1');
        await redis.expire(commentKey(postId), COMMENT_SENTINEL_TTL_SEC);
        log.info('mod-surface: analysis comment posted', { postId, commentId: comment.id });
      }
    } catch (err) {
      log.warn('mod-surface: submitComment failed (non-fatal)', {
        postId,
        err: String(err),
      });
    }
  }
}
