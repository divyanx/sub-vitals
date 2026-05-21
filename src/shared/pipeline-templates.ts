/**
 * Pipeline template catalogue — immutable, in-code definitions.
 *
 * Templates are the "what can be installed" catalogue. Mods pick from here
 * and create PipelineInstances. The first 7 templates correspond to the old
 * BUILTIN_PIPELINES. Templates 8-10 are new capabilities.
 *
 * Rule: never mutate this file at runtime. All mutable state lives in Redis
 * as PipelineInstance records.
 */

import type { PipelineTemplate } from './types.js';

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  // -------------------------------------------------------------------------
  // 1. Intent classifier  (replaces old 'intent' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'intent-classifier',
    name: 'Intent classifier',
    shortDescription: 'Classifies each post into a contact-driver category.',
    description:
      'Uses your contact-driver taxonomy to tag every incoming post with the most likely intent. Combines keyword pre-matching with an LLM judge for ambiguous posts.',
    category: 'tagging',
    kind: 'categorical',
    iconEmoji: '🎯',
    defaultConfig: {
      trigger: 'post-create',
      systemPrompt:
        'You are a customer experience analyst. Given a Reddit post from a brand subreddit, classify the post into exactly one of the provided categories. Respond with the category id only.',
      userPrompt:
        'Post title: {{post.title}}\nPost body: {{post.body}}\nCategories: {{labels}}\n\nCategory:',
      outputSchema: 'single-label',
    },
    configurable: ['systemPrompt', 'userPrompt', 'labels'],
    moduleKey: 'contact-drivers',
    logic: 'Lexicon → LLM',
    example: {
      input: 'My Sonos app keeps crashing after the latest update.',
      output: 'bug',
    },
  },

  // -------------------------------------------------------------------------
  // 2. Sentiment scorer  (replaces old 'sentiment' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'sentiment-scorer',
    name: 'Sentiment scorer',
    shortDescription: 'Scores each post as positive, neutral, or negative.',
    description:
      'Applies AFINN lexicon scoring to every post and comment, then uses an LLM judge for ambiguous texts (score near zero). Results feed the Insights sentiment chart.',
    category: 'scoring',
    kind: 'ordinal',
    iconEmoji: '💭',
    defaultConfig: {
      trigger: 'post-create',
      systemPrompt:
        'You are a sentiment analysis model. Classify the sentiment of the following Reddit post. Respond with one of: positive, neutral, negative.',
      userPrompt: 'Post: {{post.title}}\n\n{{post.body}}\n\nSentiment:',
      outputSchema: 'label-confidence',
      labels: ['positive', 'neutral', 'negative'],
    },
    configurable: ['systemPrompt', 'userPrompt', 'threshold'],
    moduleKey: 'sentiment',
    logic: 'AFINN lexicon → LLM judge for ambiguous',
    example: {
      input: 'This is absolutely ridiculous, nothing works.',
      output: 'negative (0.92)',
    },
  },

  // -------------------------------------------------------------------------
  // 3. Topic clusterer  (replaces old 'themes' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'topic-clusterer',
    name: 'Topic clusterer',
    shortDescription: 'Groups recent posts into recurring topic clusters.',
    description:
      'Runs on a schedule (daily by default). Sends recent negative posts to an LLM that extracts recurring topics and names each cluster. Output drives the Themes section of Insights.',
    category: 'clustering',
    kind: 'cluster',
    iconEmoji: '🗂️',
    defaultConfig: {
      trigger: 'scheduled',
      systemPrompt:
        'You are a topic modelling assistant. Given a list of Reddit posts, identify up to 8 recurring topic clusters. For each cluster return: name (short), summary (1 sentence), samplePostIds (up to 3 ids).',
      userPrompt: 'Posts (JSON array): {{posts_json}}\n\nClusters (JSON):',
      outputSchema: 'cluster',
    },
    configurable: ['systemPrompt', 'userPrompt'],
    moduleKey: 'theme-clustering',
    logic: 'LLM clustering of recent posts',
    example: {
      input: '20 posts over 7 days',
      output: 'App crashes (8), Connectivity (5), Setup (4), …',
    },
  },

  // -------------------------------------------------------------------------
  // 4. Impostor flagger  (replaces old 'impostor' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'impostor-flagger',
    name: 'Impostor flagger',
    shortDescription: 'Flags comments that impersonate brand agents.',
    description:
      'Combines regex pre-filtering (username similarity, common social-engineering phrases) with an LLM judge to catch comments that impersonate verified company agents or attempt phishing.',
    category: 'flagging',
    kind: 'boolean',
    iconEmoji: '🚨',
    defaultConfig: {
      trigger: 'comment-create',
      systemPrompt:
        'You are a trust-and-safety classifier. Given a Reddit comment and the list of verified agent usernames, determine whether this comment impersonates a brand agent or attempts social engineering. Respond with true or false.',
      userPrompt:
        'Verified agents: {{agents}}\nComment author: {{author}}\nComment: {{body}}\n\nImpostor:',
      outputSchema: 'boolean',
    },
    configurable: ['systemPrompt', 'userPrompt', 'threshold'],
    moduleKey: 'impostor-detection',
    logic: 'Regex pre-filter → LLM judge',
    example: {
      input: 'DM me your account details — I am from Sonos support',
      output: 'true',
    },
  },

  // -------------------------------------------------------------------------
  // 5. Volume spike detector  (replaces old 'crisis' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'volume-spike-detector',
    name: 'Volume spike detector',
    shortDescription: 'Detects unusual spikes in post/comment volume.',
    description:
      'Monitors hourly comment velocity and negative-sentiment share. Triggers an incident when volume exceeds configurable thresholds. No LLM — purely heuristic for speed.',
    category: 'flagging',
    kind: 'cluster',
    iconEmoji: '📈',
    defaultConfig: {
      trigger: 'comment-create',
      systemPrompt: '',
      userPrompt: '',
      outputSchema: 'boolean',
      threshold: 0.4,
    },
    configurable: ['threshold'],
    moduleKey: 'crisis-detection',
    logic: 'Hourly volume + negative-share thresholds',
    example: {
      input: '47 comments in 1 hour, 60% negative',
      output: 'incident opened',
    },
  },

  // -------------------------------------------------------------------------
  // 6. Team response tracker  (replaces old 'agent-metrics' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'team-response-tracker',
    name: 'Team response tracker',
    shortDescription: 'Tracks first-response latency for verified agents.',
    description:
      'On every comment from a verified agent, records first-response latency (time since post creation) and the sentiment delta. Feeds per-agent scorecards in the Team tab.',
    category: 'scoring',
    kind: 'scalar',
    iconEmoji: '⏱️',
    defaultConfig: {
      trigger: 'comment-create',
      systemPrompt: '',
      userPrompt: '',
      outputSchema: 'scalar',
    },
    configurable: [],
    moduleKey: 'agent-metrics',
    logic: 'First-response latency + sentiment delta tracking',
    example: {
      input: 'Agent reply at T+18 min',
      output: 'SLA: met (18 min)',
    },
  },

  // -------------------------------------------------------------------------
  // 7. Root cause summariser  (replaces old 'root-cause' builtin)
  // -------------------------------------------------------------------------
  {
    id: 'root-cause-summariser',
    name: 'Root cause summariser',
    shortDescription: 'AI summarises a resolved post into a root-cause string.',
    description:
      'Fires when a post is marked resolved. Sends the post title, body, and the agent reply thread to an LLM that extracts a concise root cause. Useful for QA retrospectives.',
    category: 'extraction',
    kind: 'categorical',
    iconEmoji: '🔍',
    defaultConfig: {
      trigger: 'status-change',
      systemPrompt:
        'You are a customer experience analyst. Given a resolved Reddit support post and the agent replies, extract a concise root cause in one sentence.',
      userPrompt:
        'Post: {{post.title}}\n{{post.body}}\n\nAgent replies:\n{{agent_replies}}\n\nRoot cause:',
      outputSchema: 'single-label',
    },
    configurable: ['systemPrompt', 'userPrompt'],
    moduleKey: 'root-cause',
    logic: 'LLM extracts root cause on status-change → resolved',
    alpha: true,
    example: {
      input: 'Post: "App crashes on launch" → resolved by agent',
      output: 'Corrupted local cache after v3.1 upgrade',
    },
  },

  // -------------------------------------------------------------------------
  // 8. Spam detector  (NEW)
  // -------------------------------------------------------------------------
  {
    id: 'spam-detector',
    name: 'Spam detector',
    shortDescription: 'Flags posts and comments that look like spam.',
    description:
      'Regex pre-filter catches common spam patterns (promo codes, repeated text, suspicious links) then an LLM judge confirms. Flagged content is surfaced in the Audit log.',
    category: 'flagging',
    kind: 'boolean',
    iconEmoji: '🛡️',
    defaultConfig: {
      trigger: 'post-create',
      systemPrompt:
        'You are a strict spam classifier for a brand subreddit. Output value=true (spam) ONLY when the post is clearly spam. Spam includes any of: crypto/NFT/airdrop giveaways, "free X" lures, promo or discount codes, affiliate or shortened links, pump-and-dump tickers, MLM recruitment, sexual or adult-services solicitation, "I made $X working from home" testimonials, repeated copy-paste content, or off-topic advertising for unrelated products. Customer support questions, complaints, refund requests, bug reports, and feature suggestions are NEVER spam even if they mention prices or brand names. Provide a one-sentence reasoning.',
      userPrompt:
        'Post title: {{post.title}}\nPost body: {{post.body}}\n\nClassify whether this post is spam.',
      outputSchema: 'boolean',
    },
    configurable: ['systemPrompt', 'userPrompt', 'threshold'],
    moduleKey: 'spam-detector',
    logic: 'LLM judge with explicit spam patterns',
    example: {
      input: 'Free Bitcoin giveaway! DM me to claim 0.1 BTC, limited spots',
      output: 'true',
    },
  },

  // -------------------------------------------------------------------------
  // 8b. Fraud detector  (NEW)
  // -------------------------------------------------------------------------
  {
    id: 'fraud-detector',
    name: 'Fraud detector',
    shortDescription: 'Flags posts that look like scams targeting community members.',
    description:
      'Catches social-engineering scams, phishing, fake support impersonation, and account-takeover bait. Distinct from spam (commercial junk) — fraud is intent to defraud or harm specific users.',
    category: 'flagging',
    kind: 'boolean',
    iconEmoji: '🚨',
    defaultConfig: {
      trigger: 'post-create',
      systemPrompt:
        'You are a fraud and scam classifier for a brand subreddit. Output value=true (fraud) ONLY for posts that try to defraud or harm users. Fraud includes: fake "official support" DMs ("DM me your password and I will fix it"), phishing links pretending to be the brand login, requests for credentials/2FA codes/seed phrases, wire-transfer or gift-card payment demands, fake refund forms collecting payment info, account-recovery social-engineering ("send me a screenshot of your ID"), impersonation of brand employees asking for money, romance/investment scams, and tech-support scareware. Normal customer complaints, legitimate questions, and even angry posts are NOT fraud. Provide a one-sentence reasoning.',
      userPrompt:
        'Post title: {{post.title}}\nPost body: {{post.body}}\n\nClassify whether this post is a fraud or scam attempt.',
      outputSchema: 'boolean',
    },
    configurable: ['systemPrompt', 'userPrompt', 'threshold'],
    moduleKey: 'fraud-detector',
    logic: 'LLM judge with explicit scam patterns',
    example: {
      input: 'OFFICIAL Sonos support — DM me your account password and I will issue your refund',
      output: 'true',
    },
  },

  // -------------------------------------------------------------------------
  // 9. PII detector  (NEW)
  // -------------------------------------------------------------------------
  {
    id: 'pii-detector',
    name: 'PII detector',
    shortDescription: 'Flags content containing personal information.',
    description:
      'Regex patterns catch phone numbers, emails, credit card numbers, and SSNs. An LLM judge handles edge cases. Flagged posts are surfaced in the Audit log for mod review.',
    category: 'flagging',
    kind: 'boolean',
    iconEmoji: '🔒',
    defaultConfig: {
      trigger: 'post-create',
      systemPrompt:
        'You are a PII detection model. Given a Reddit post, determine whether it contains personal identifiable information (PII) such as full name + address, phone numbers, email addresses, credit card numbers, or government IDs. Respond with true (PII detected) or false.',
      userPrompt: 'Post: {{post.title}}\n\n{{post.body}}\n\nPII detected:',
      outputSchema: 'boolean',
    },
    configurable: ['systemPrompt', 'userPrompt'],
    moduleKey: 'pii-detector',
    logic: 'Regex patterns → LLM judge',
    example: {
      input: 'My number is 555-867-5309 and I live at 123 Main St',
      output: 'true',
    },
  },

  // -------------------------------------------------------------------------
  // 10. Brand mention counter  (NEW)
  // -------------------------------------------------------------------------
  {
    id: 'brand-mention-counter',
    name: 'Brand mention counter',
    shortDescription: 'Counts brand and competitor name mentions per post.',
    description:
      'Pure regex — no LLM. Scans post title and body for a configurable list of brand and competitor terms. Outputs a scalar mention count, useful for share-of-voice tracking in Insights.',
    category: 'extraction',
    kind: 'scalar',
    iconEmoji: '📊',
    defaultConfig: {
      trigger: 'post-create',
      systemPrompt: '',
      userPrompt: '',
      outputSchema: 'scalar',
    },
    configurable: ['labels'],
    moduleKey: 'brand-mention-counter',
    logic: 'Regex term matching',
    example: {
      input: 'Sonos beats Bose any day, also tried Apple HomePod',
      output: '3 mentions',
    },
  },
];

/** Look up a single template by id. */
export function getPipelineTemplate(id: string): PipelineTemplate | undefined {
  return PIPELINE_TEMPLATES.find((t) => t.id === id);
}

/** Return templates filtered by category. */
export function getTemplatesByCategory(category: PipelineTemplate['category']): PipelineTemplate[] {
  return PIPELINE_TEMPLATES.filter((t) => t.category === category);
}

/**
 * Templates pre-installed as running instances on AppInstall.
 *
 * Only the three obviously-useful pipelines start enabled out of the box.
 * The rest (impostor / crisis / team-performance / root-cause / spam / pii /
 * brand-mention) sit in the catalogue waiting — mods opt in via "+ Install".
 *
 * Decision recorded 2026-05-19: aggressive pre-install was clutter; let mods
 * choose what's relevant to their subreddit instead of disabling things they
 * didn't ask for.
 */
export const PREINSTALLED_TEMPLATE_IDS: string[] = [
  'intent-classifier',
  'sentiment-scorer',
  'topic-clusterer',
];
