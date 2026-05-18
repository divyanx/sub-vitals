/**
 * Tooltip content map — single source of truth for metric explanations.
 * Used by <InfoTooltip tip={TOOLTIPS.postsToday} />.
 */
export const TOOLTIPS = {
  // Pulse KPIs
  postsToday:
    'Total posts submitted to this subreddit today (UTC). Includes all auto-tagged and manually tagged posts.',
  topDriver:
    'The contact driver category with the most posts today. Click to drill into the Drivers tab.',
  negativeShare:
    'Negative posts ÷ total posts today. Formula: negative_count / total_count. Threshold: ≥40% = alert, ≥25% = warning.',
  activeIncidents:
    'Open incidents auto-detected when comment volume or negative-sentiment ratio spikes above your 14-day baseline.',
  avgFirstResponse:
    'Mean time from post submission to first verified rep comment, averaged across all reps over the last 7 days.',
  aiSpendMtd:
    'Month-to-date LLM cost in USD, accumulated across contact-driver classification, sentiment judging, theme clustering, and AI draft replies.',

  // Sentiment cards
  sentimentPositive:
    'Posts scored positive by AFINN lexicon (or LLM judge when the lexicon result is ambiguous). Last 30 days.',
  sentimentNeutral:
    'Posts with a sentiment score near zero (−0.1 to +0.1). Often factual questions or announcements.',
  sentimentNegative: 'Posts scored negative. These drive incident detection and theme clustering.',

  // Team performance columns
  agentReplies: 'Total comments left by this rep on tagged posts in the selected window.',
  agentFirstResponseRate:
    'Percentage of open posts where this rep left the first verified rep comment.',
  agentAvgLatency:
    "Mean time (hh:mm) from post submission to this rep's first comment. Lower is better.",
  agentSentimentLift:
    'Average change in thread sentiment score after this rep replied. Positive = the thread got less negative after the response.',

  // Pipeline logic
  pipelineContactDrivers:
    'Keyword match → LLM classification. Posts matching a driver keyword skip the LLM call to save cost.',
  pipelineSentiment:
    'AFINN lexicon for clear signals; LLM judge only for ambiguous cases (score between −0.1 and +0.1).',
  pipelineImpostor:
    'Regex pre-filter removes obvious non-matches, then LLM judges whether the comment is an impersonation attempt.',
  pipelineCrisis:
    'Hourly scheduler compares volume and negative-share against a 14-day rolling baseline. No LLM call.',
  pipelineThemes:
    'Daily scheduler clusters the last 7 days of negative posts using an LLM and stores named theme groups.',
  pipelineAgentMetrics:
    'Fires on every comment to record first-response timestamps and update per-rep latency counters.',

  // Settings sliders
  escalationThreshold:
    'Number of negative comments in a thread before a modmail escalation alert is sent.',
  volumeMultiplier:
    'Crisis triggers when hourly post volume exceeds this multiple of the 14-day hourly average.',
  slaMinutes:
    'Reps are flagged as breaching SLA when their first response takes longer than this many minutes.',
} as const;

export type TooltipKey = keyof typeof TOOLTIPS;
