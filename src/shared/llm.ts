/**
 * LLM client — placeholder.
 *
 * Phase 1 modules do NOT call this. It exists so Phase 2 (AI auto-tagging,
 * AI sentiment judge, PII LLM check) can build on a stable interface.
 *
 * When implemented, this module will:
 *   - Wrap OpenAI + Gemini behind a common `complete(prompt, opts)` API
 *     using the Vercel AI SDK (`ai` + `@ai-sdk/openai` + `@ai-sdk/google`)
 *   - Gate every call through `takeToken` (rate limit per installation)
 *   - 15s AbortController timeout
 *   - Exponential backoff + jitter on 429/503 via `p-retry`
 *   - Cache responses by `sha256(prompt + model)` for 24h in Redis
 *   - Track cumulative cost in `rl:cost:{YYYY-MM}` with a configurable hard cap
 *
 * Until Phase 2: importing this file is a build error so we don't ship a
 * half-baked LLM path that bypasses the production safeguards.
 */

export interface LLMOptions {
  provider: 'openai' | 'gemini';
  model: string;
  prompt: string;
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Temperature. */
  temperature?: number;
}

export interface LLMResult {
  text: string;
  /** Tokens used (in + out). */
  tokens: number;
  /** Estimated cost in cents (USD). */
  costCents: number;
  /** True if served from the response cache. */
  cached: boolean;
}

export function llmComplete(_opts: LLMOptions): Promise<LLMResult> {
  throw new Error(
    'llm.ts is a Phase 2 placeholder. Phase 1 must not call LLMs — use lexicon/regex baselines.',
  );
}
