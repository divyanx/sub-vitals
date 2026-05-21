/**
 * Curated model catalog for RedLattice.
 *
 * Pricing assumptions per tagging call: ~500 input tokens + ~200 output tokens.
 * Costs are guidance estimates; actual billing comes from OpenRouter.
 */

export interface ModelOption {
  slug: string; // OpenRouter slug
  label: string; // human name
  provider: 'anthropic' | 'openai' | 'google' | 'mistral' | 'meta' | 'cohere';
  tier: 'recommended' | 'fast' | 'cheapest' | 'best' | 'eu-hosted';
  pricePer1kTaggingCalls: number; // estimate in USD — (500 in + 200 out) tokens
  supportsStructuredOutput: boolean;
  notes?: string;
}

/**
 * Per-model cost rates: USD cents per 1K tokens (input / output).
 * Source: OpenRouter pricing page, rounded up for conservatism.
 */
const COST_TABLE: Record<string, { in: number; out: number }> = {
  'anthropic/claude-haiku-4.5': { in: 0.1, out: 0.5 },
  'openai/gpt-5-mini': { in: 0.025, out: 0.2 },
  'google/gemini-2.5-flash': { in: 0.03, out: 0.25 },
  'anthropic/claude-sonnet-4-6': { in: 0.3, out: 1.5 },
  'openai/gpt-5': { in: 0.5, out: 2.0 },
  'mistralai/mistral-large-2509': { in: 0.2, out: 0.6 },
  'google/gemini-2.5-pro': { in: 0.125, out: 1.0 },
  'meta-llama/llama-4-scout': { in: 0.011, out: 0.034 },
  'cohere/command-r-plus': { in: 0.25, out: 1.0 },
};

/**
 * Compute guidance cost for 1 000 tagging calls using ~500 in + 200 out tokens each.
 * Returns USD.
 */
function estimateUsd(slug: string): number {
  const rate = COST_TABLE[slug] ?? { in: 0.2, out: 0.8 };
  const perCall = (500 / 1000) * rate.in + (200 / 1000) * rate.out;
  return Number(perCall.toFixed(4));
}

export const CURATED_MODELS: ModelOption[] = [
  {
    slug: 'anthropic/claude-haiku-4.5',
    label: 'Claude Haiku 4.5',
    provider: 'anthropic',
    tier: 'recommended',
    pricePer1kTaggingCalls: estimateUsd('anthropic/claude-haiku-4.5'),
    supportsStructuredOutput: true,
    notes: 'Best balance of speed, cost, and reliability for tagging pipelines.',
  },
  {
    slug: 'openai/gpt-5-mini',
    label: 'GPT-5 Mini',
    provider: 'openai',
    tier: 'fast',
    pricePer1kTaggingCalls: estimateUsd('openai/gpt-5-mini'),
    supportsStructuredOutput: true,
    notes: 'Low latency; good for real-time tagging.',
  },
  {
    slug: 'google/gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'google',
    tier: 'cheapest',
    pricePer1kTaggingCalls: estimateUsd('google/gemini-2.5-flash'),
    supportsStructuredOutput: true,
    notes: 'Lowest cost option; ideal for high-volume subreddits.',
  },
  {
    slug: 'anthropic/claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    tier: 'best',
    pricePer1kTaggingCalls: estimateUsd('anthropic/claude-sonnet-4-6'),
    supportsStructuredOutput: true,
    notes: 'Highest accuracy; use for complex reasoning tasks.',
  },
  {
    slug: 'openai/gpt-5',
    label: 'GPT-5',
    provider: 'openai',
    tier: 'best',
    pricePer1kTaggingCalls: estimateUsd('openai/gpt-5'),
    supportsStructuredOutput: true,
    notes: "OpenAI's most capable model.",
  },
  {
    slug: 'mistralai/mistral-large-2509',
    label: 'Mistral Large 2509',
    provider: 'mistral',
    tier: 'eu-hosted',
    pricePer1kTaggingCalls: estimateUsd('mistralai/mistral-large-2509'),
    supportsStructuredOutput: true,
    notes: 'EU data residency; GDPR-friendly choice.',
  },
  {
    slug: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    tier: 'best',
    pricePer1kTaggingCalls: estimateUsd('google/gemini-2.5-pro'),
    supportsStructuredOutput: true,
    notes: "Google's most capable model with long context.",
  },
  {
    slug: 'meta-llama/llama-4-scout',
    label: 'Llama 4 Scout',
    provider: 'meta',
    tier: 'cheapest',
    pricePer1kTaggingCalls: estimateUsd('meta-llama/llama-4-scout'),
    supportsStructuredOutput: false,
    notes: 'Very cheap; does not reliably support structured output.',
  },
  {
    slug: 'cohere/command-r-plus',
    label: 'Command R+',
    provider: 'cohere',
    tier: 'eu-hosted',
    pricePer1kTaggingCalls: estimateUsd('cohere/command-r-plus'),
    supportsStructuredOutput: true,
    notes: 'Cohere EU region; strong RAG and structured-output support.',
  },
];

// Default model — OpenAI direct because openrouter.ai is pending Reddit
// outbound-domain approval. Once openrouter is approved we can switch
// the default back to anthropic/claude-haiku-4.5 (cheaper + faster).
export const DEFAULT_MODEL = 'gpt-5-mini';

/** Look up a model by slug. Returns null if not in the catalog. */
export function findModel(slug: string): ModelOption | null {
  return CURATED_MODELS.find((m) => m.slug === slug) ?? null;
}

/** True if the model is known to support structured output (generateObject). */
export function isStructuredOutputCapable(slug: string): boolean {
  const m = findModel(slug);
  // Unknown slugs: optimistically assume capable (callers handle actual failure).
  return m ? m.supportsStructuredOutput : true;
}

/** Return the tier badge label shown in the UI. */
export const TIER_LABELS: Record<ModelOption['tier'], string> = {
  recommended: 'Recommended',
  fast: 'Fast',
  cheapest: 'Cheapest',
  best: 'Best',
  'eu-hosted': 'EU',
};
