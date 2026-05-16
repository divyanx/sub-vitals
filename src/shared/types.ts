/**
 * Shared types and the module contract.
 *
 * Trigger payload types are re-exported from `@devvit/web/shared` — those are
 * the canonical proto-derived shapes. We don't hand-roll our own.
 */

import type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentCreateRequest,
  OnModActionRequest,
  OnPostCreateRequest,
  OnPostUpdateRequest,
} from '@devvit/web/shared';
import type { Hono } from 'hono';

// ---------------------------------------------------------------------------
// Re-exports — make the rest of the codebase import event types from here so
// we have a single import path even if @devvit/web reorganizes.
// ---------------------------------------------------------------------------

export type {
  OnAppInstallRequest,
  OnAppUpgradeRequest,
  OnCommentCreateRequest,
  OnModActionRequest,
  OnPostCreateRequest,
  OnPostUpdateRequest,
};

// ---------------------------------------------------------------------------
// Module contract
// ---------------------------------------------------------------------------

/**
 * Every RedLattice feature module implements this contract. The dispatcher
 * fans trigger events to every module that subscribes, with failure isolation.
 *
 * Handlers receive only the typed event payload — there is no `ctx` parameter.
 * Devvit Web exposes per-request state via the async-local `context` import
 * from `@devvit/web/server`, and platform clients (`redis`, `reddit`,
 * `settings`, `scheduler`) are imported singletons.
 */
export interface RedLatticeModule {
  readonly name: string;
  readonly description: string;
  readonly tier: 'core' | 'pro' | 'enterprise';

  /** Feature-flag check. Read from subreddit settings. */
  enabled(): Promise<boolean>;

  onAppInstall?(event: OnAppInstallRequest): Promise<void>;
  onAppUpgrade?(event: OnAppUpgradeRequest): Promise<void>;
  onPostCreate?(event: OnPostCreateRequest): Promise<void>;
  onPostUpdate?(event: OnPostUpdateRequest): Promise<void>;
  onCommentCreate?(event: OnCommentCreateRequest): Promise<void>;
  onModAction?(event: OnModActionRequest): Promise<void>;

  /** Optional API routes registered against the Hono app. */
  apiRoutes?(app: Hono): void;
}

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

export type AgentRole = 'verified' | 'lead' | 'removed';

export interface AgentRecord {
  username: string;
  role: AgentRole;
  verifiedAt: number;
  verifiedBy: string;
}

export interface TaxonomyNode {
  id: string;
  label: string;
  description?: string | undefined;
  color?: string | undefined;
}

export type PostStatus = 'open' | 'in-progress' | 'responded' | 'resolved';

export interface PostTag {
  postId: string;
  driverId: string;
  taggedBy: 'manual' | 'auto' | 'ai';
  taggedByUser?: string | undefined;
  confidence?: number | undefined;
  reasoning?: string | undefined;
  taggedAt: number;
  status?: PostStatus | undefined;
  statusChangedAt?: number | undefined;
  statusChangedBy?: string | undefined;
}

export interface PostMeta {
  postId: string;
  title: string;
  authorName: string;
  url: string;
  createdAt: number;
}

export interface CommentMeta {
  commentId: string;
  postId: string;
  parentId?: string | undefined;
  authorName: string;
  body: string;
  createdAt: number;
  isAgent: boolean;
}

export type SentimentLabel = 'positive' | 'neutral' | 'negative';

export interface SentimentScore {
  contentId: string;
  contentType: 'post' | 'comment';
  score: number;
  label: SentimentLabel;
  scoredAt: number;
  scoredBy: 'lexicon' | 'ai';
}

export interface SentimentRollup {
  date: string;
  positive: number;
  neutral: number;
  negative: number;
  total: number;
  averageScore: number;
}

export interface DriverRollup {
  date: string;
  totalPosts: number;
  counts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Settings keys (mirrors devvit.json settings declarations)
// ---------------------------------------------------------------------------

export const SETTINGS = {
  OPENAI_API_KEY: 'openai-api-key',
  GEMINI_API_KEY: 'gemini-api-key',
  AGENT_WHITELIST: 'agent-whitelist',
  TAXONOMY_JSON: 'taxonomy-json',
  SENTIMENT_THRESHOLD: 'sentiment-threshold',
  SLA_MINUTES: 'sla-minutes',
} as const;

export type SettingKey = (typeof SETTINGS)[keyof typeof SETTINGS];
