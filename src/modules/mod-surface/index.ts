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
import { listInstances } from '@shared/pipeline-instances.js';
import { readEffectiveSetting } from '@shared/settings-overrides.js';
import { getTagsForTarget } from '@shared/tags.js';
import type { Tag } from '@shared/types.js';

// ---------------------------------------------------------------------------
// Auto-reports gate (60s in-memory cache to avoid hitting settings on every
// tag-write; same pattern as the Studio bridge).
// ---------------------------------------------------------------------------

let reportsEnabledCache: { value: boolean; expiresAt: number } | null = null;
const REPORTS_CACHE_TTL_MS = 60_000;

async function isAutoReportsEnabled(): Promise<boolean> {
  const now = Date.now();
  if (reportsEnabledCache && reportsEnabledCache.expiresAt > now) {
    return reportsEnabledCache.value;
  }
  try {
    const v = await readEffectiveSetting<boolean>('auto-reports-enabled', true);
    reportsEnabledCache = { value: v !== false, expiresAt: now + REPORTS_CACHE_TTL_MS };
    return reportsEnabledCache.value;
  } catch {
    // Fall open: default to true. Auto-reports are useful enough that a
    // settings-read hiccup shouldn't disable them.
    return true;
  }
}

// ---------------------------------------------------------------------------
// Lock + sentinel keys
// ---------------------------------------------------------------------------

// Coalesces the burst of recomputes from N pipelines all writing tags
// within a few ms of each other. Too long and late-arriving tags
// (e.g. fraud at T+3s) get skipped entirely — their report never lands.
// Too short and we hit Reddit's flair API N times back-to-back.
// 1s threads the needle: parallel pipelines that finish in the same
// tick share a single recompute, while a tag arriving 1s+ later gets
// its own pass.
const FLAIR_LOCK_TTL_SEC = 1;
const COMMENT_SENTINEL_TTL_SEC = 60 * 60 * 24 * 7; // 7 days — re-comment if a stale post is re-flagged later
const REPORTS_SENTINEL_TTL_SEC = 60 * 60 * 24 * 30; // 30 days — match Reddit's report retention

const lockKey = (postId: string) => `rl:modsurf:lock:${postId}`;
const reportsKey = (postId: string) => `rl:modsurf:reports:${postId}`;
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
 * Build a map: templateId → tag for the current post.
 *
 * Tags carry the *instance* id (e.g. `pi_e678565a27984d568c75` for
 * catalogue-installed pipelines, or `pi_spam-detector` for pre-installed,
 * or the bare hardcoded module id like `sentiment`). To answer "did the
 * spam-detector fire?" we need to map back to the underlying template.
 *
 * Path 1: bare hardcoded ids — pipelineId IS the templateId equivalent.
 * Path 2: pi_<templateId> form (pre-installed instances) — strip prefix.
 * Path 3: pi_<nanoid> form (catalogue installs) — look up via the
 *         PipelineInstance list and use its templateId field.
 *
 * Returns a Map so we can do constant-time lookups in buildFlair / etc.
 */
async function buildTemplateMap(tags: Tag[]): Promise<Map<string, Tag>> {
  // Hardcoded module IDs are also valid "template names" for our purposes.
  // IMPORTANT: include EVERY raw pipelineId that hardcoded modules pass to
  // recordTag. Missing aliases here = silent invisibility in mod-surface.
  // Audit by grepping `recordTag.*pipelineId:` in src/modules/.
  const HARDCODED_AS_TEMPLATE: Record<string, string> = {
    // sentiment module → 'sentiment'
    sentiment: 'sentiment-scorer',
    // contact-drivers module → 'intent' (NOT 'contact-drivers')
    intent: 'intent-classifier',
    'contact-drivers': 'intent-classifier',
    // impostor-detection module
    impostor: 'impostor-flagger',
    // crisis-detection module
    crisis: 'volume-spike-detector',
    // theme-clustering module
    themes: 'topic-clusterer',
    // agent-metrics module
    'agent-metrics': 'team-response-tracker',
  };

  // First pass: anything with a known shape resolves without a DB read.
  const map = new Map<string, Tag>();
  const unresolved: Tag[] = [];

  for (const t of tags) {
    const pid = t.pipelineId;
    const hardcoded = HARDCODED_AS_TEMPLATE[pid];
    if (hardcoded) {
      map.set(hardcoded, t);
      // Keep the raw hardcoded id too in case a caller checks for it.
      map.set(pid, t);
    } else if (pid.startsWith('pi_')) {
      const rest = pid.slice('pi_'.length);
      // Pre-installed instances look like pi_<templateId> (kebab-case).
      // Catalogue installs look like pi_<nanoid> (alphanumeric, no
      // hyphens, fixed length-ish).
      if (rest.includes('-')) {
        map.set(rest, t);
      } else {
        unresolved.push(t);
      }
    }
  }

  // Second pass: catalogue installs need a DB lookup. Skip the round-trip
  // when nothing is unresolved.
  if (unresolved.length > 0) {
    try {
      const instances = await listInstances();
      const idToTemplate = new Map(instances.map((i) => [i.id, i.templateId]));
      for (const t of unresolved) {
        const tpl = idToTemplate.get(t.pipelineId);
        if (tpl) map.set(tpl, t);
      }
    } catch (err) {
      log.warn('mod-surface: instance lookup failed (non-fatal)', { err: String(err) });
    }
  }

  return map;
}

/**
 * Build a single composite flair chip. Priority: fraud > spam > impostor
 * > intent+sentiment > sentiment alone. Returns null when there are no
 * tags worth showing (caller should leave existing flair alone).
 */
function buildFlair(byTemplate: Map<string, Tag>): FlairChoice | null {
  const find = (templateId: string): Tag | undefined => byTemplate.get(templateId);

  const fraud = find('fraud-detector');
  if (fraud && (fraud.value === true || fraud.value === 'true')) {
    return { text: '🚨 fraud', backgroundColor: '#7a0e0e', textColor: 'light' };
  }

  const spam = find('spam-detector');
  if (spam && (spam.value === true || spam.value === 'true')) {
    return { text: '🚨 spam', backgroundColor: '#5b1717', textColor: 'light' };
  }

  const impostor = find('impostor-flagger');
  if (impostor && (impostor.value === true || impostor.value === 'true')) {
    return { text: '🎭 impostor', backgroundColor: '#8a4500', textColor: 'light' };
  }

  const intent = find('intent-classifier');
  const sentiment = find('sentiment-scorer');

  if (intent || sentiment) {
    // Keep the flair single-chip clean: intent + sentiment-emoji only.
    // PII, brand mentions, and other signals get their own report lines
    // (see buildReports below) instead of being crammed into the flair.
    const intentValue = intent ? valueLabel(intent.value) : '';
    const sentimentValue = sentiment ? valueLabel(sentiment.value) : '';
    const intentIcon = INTENT_ICON[intentValue] ?? '•';
    const sentimentIcon = SENTIMENT_ICON[sentimentValue] ?? '';

    const parts: string[] = [];
    if (intent) parts.push(`${intentIcon} ${intentValue}`);
    if (sentiment) parts.push(sentimentIcon);
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
 * Build the set of report reasons to attach to this post. Each entry is
 * one line that will appear under the post in Reddit's "Reported" queue.
 *
 * Why reports instead of cramming everything into the flair: Reddit's
 * native queue groups multi-report posts and shows every reason inline,
 * so each pipeline gets its own labeled line without competing for the
 * single flair slot. AutoMod uses the same pattern.
 *
 * We dedupe within the function (one report per concept) and the caller
 * dedupes across calls (per-post Redis set tracks already-submitted
 * reason hashes) so re-runs don't pile on duplicates.
 *
 * Reasons MUST start with "RedLattice:" so mods can scan the queue and
 * tell our reports apart from user reports at a glance.
 */
function buildReports(byTemplate: Map<string, Tag>): string[] {
  const find = (templateId: string): Tag | undefined => byTemplate.get(templateId);

  const reports: string[] = [];

  // Safety flags — each gets its own line so the queue shows the
  // specific violation rather than a generic "flagged" badge.
  const spam = find('spam-detector');
  if (spam && (spam.value === true || spam.value === 'true')) {
    reports.push(formatReport('🚨 Spam detector fired', spam));
  }
  const fraud = find('fraud-detector');
  if (fraud && (fraud.value === true || fraud.value === 'true')) {
    reports.push(formatReport('🚨 Fraud / scam detected', fraud));
  }
  const impostor = find('impostor-flagger');
  if (impostor && (impostor.value === true || impostor.value === 'true')) {
    reports.push(formatReport('🎭 Possible brand impostor', impostor));
  }
  const pii = find('pii-detector');
  if (pii && (pii.value === true || pii.value === 'true')) {
    reports.push(formatReport('🔒 PII detected (phone/email/SSN/etc)', pii));
  }

  // Intent + sentiment — combined into a single line. They almost always
  // co-occur and splitting them adds noise. Skip when sentiment is the
  // only signal (one line of "Sentiment: neutral" isn't worth queue space).
  const intent = find('intent-classifier');
  const sentiment = find('sentiment-scorer');
  if (intent) {
    const intentValue = valueLabel(intent.value);
    const intentIcon = INTENT_ICON[intentValue] ?? '•';
    let line = `${intentIcon} Intent: ${intentValue}`;
    if (intent.confidence !== undefined) {
      line += ` (${Math.round(intent.confidence * 100)}%)`;
    }
    if (sentiment) {
      const sentimentValue = valueLabel(sentiment.value);
      const sentimentIcon = SENTIMENT_ICON[sentimentValue] ?? '';
      line += ` · ${sentimentIcon} ${sentimentValue}`;
      if (sentiment.confidence !== undefined) {
        line += ` (${sentiment.confidence.toFixed(2)})`;
      }
    }
    reports.push(`RedLattice: ${line}`);
  }

  return reports;
}

function formatReport(label: string, tag: Tag): string {
  const conf = tag.confidence !== undefined ? ` (${Math.round(tag.confidence * 100)}%)` : '';
  return `RedLattice: ${label}${conf}`;
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
function shouldComment(tags: Tag[], byTemplate: Map<string, Tag>): boolean {
  const find = (templateId: string): Tag | undefined => byTemplate.get(templateId);

  // Any single high-signal tag → comment.
  const spam = find('spam-detector');
  if (spam && (spam.value === true || spam.value === 'true')) return true;
  const fraud = find('fraud-detector');
  if (fraud && (fraud.value === true || fraud.value === 'true')) return true;
  const pii = find('pii-detector');
  if (pii && (pii.value === true || pii.value === 'true')) return true;
  const impostor = find('impostor-flagger');
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

  // Tag.targetId already carries the `t3_` prefix (Devvit's post.id is
  // prefixed). Strip it before re-wrapping so we don't end up with
  // `t3_t3_…` IDs that 404 against Reddit.
  const bareId = postId.startsWith('t3_') ? postId.slice(3) : postId;
  const fullId = `t3_${bareId}` as `t3_${string}`;

  // Resolve instance IDs → templateIds once. Without this catalogue-
  // installed pipelines (pi_<nanoid>) would silently fall through every
  // findByTemplate check, leaving the flair / reports / sticky comment
  // empty even though tags were written.
  const byTemplate = await buildTemplateMap(tags);

  // 1. Update flair
  const flair = buildFlair(byTemplate);
  if (flair) {
    try {
      await reddit.setPostFlair({
        subredditName: sub,
        postId: fullId,
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

  // 2. Auto-reports — one line per signal in the native Reported queue.
  //    Gated behind the per-installation `auto-reports-enabled` setting
  //    (defaults true; mods can flip off if they don't want bot reports).
  //    Idempotency: ZSET of reasons already submitted for this post.
  if (await isAutoReportsEnabled()) {
    const reports = buildReports(byTemplate);
    if (reports.length > 0) {
      try {
        const alreadyMembers = await redis.zRange(reportsKey(postId), 0, -1, { by: 'rank' });
        const alreadySet = new Set(alreadyMembers.map((m) => m.member));

        let post: Awaited<ReturnType<typeof reddit.getPostById>> | null = null;
        for (const reason of reports) {
          if (alreadySet.has(reason)) continue;
          try {
            if (!post) {
              post = await reddit.getPostById(fullId);
            }
            await reddit.report(post, { reason: reason.slice(0, 100) });
            await redis.zAdd(reportsKey(postId), { score: Date.now(), member: reason });
            log.info('mod-surface: report added', { postId, reason });
          } catch (err) {
            // Most common: insufficient mod scope, or Reddit rate-limited
            // our reports. Don't blow up the loop.
            log.warn('mod-surface: report failed (non-fatal)', {
              postId,
              reason,
              err: String(err),
            });
          }
        }
        // Refresh TTL after any successful write.
        if (reports.some((r) => !alreadySet.has(r))) {
          await redis.expire(reportsKey(postId), REPORTS_SENTINEL_TTL_SEC);
        }
      } catch (err) {
        log.warn('mod-surface: reports block failed (non-fatal)', { postId, err: String(err) });
      }
    }
  }

  // 3. Sticky distinguished analysis comment — DISABLED.
  //
  // Devvit only allows submitComment when the app runs as the user
  // (scope: 'user'), which would break our mod-only actions (ban,
  // remove, modmail) that require scope: 'moderator'. The asUser
  // permission for SUBMIT_COMMENT is documented but "not currently in
  // use" per the schema. With the auto-reports surface (above) carrying
  // every signal as its own queue line, the sticky comment was a
  // nice-to-have rather than load-bearing — disabling it stops the
  // recurring 403 noise in the logs.
  //
  // To re-enable in the future: change reddit scope to 'user' AND
  // re-wire all mod actions (ban/remove/modmail) to either run via a
  // dedicated mod account or accept loss of those features.
  void shouldComment;
  void renderCommentBody;
  void commentKey;
  void COMMENT_SENTINEL_TTL_SEC;
}
