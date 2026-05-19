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
  keywords?: string[] | undefined;
  /** null or missing = root driver. Non-null = child of named parent. */
  parentId?: string | null | undefined;
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
  /**
   * Why this comment was treated as agent-authored, if it was:
   *   - 'distinguished' — `distinguishedBy === 'moderator'|'admin'` on the
   *      Reddit comment itself. Strongest native Reddit signal.
   *   - 'mod-list'      — author is currently a mod of this subreddit.
   *   - 'flair'         — author's flair text matches the configured
   *                       agent-flair-pattern regex.
   *   - 'record'        — explicit AgentRecord exists for this user
   *                       (mod-marked or whitelist-seeded).
   *   - undefined       — comment is not from a verified agent.
   */
  agentSource?: 'distinguished' | 'mod-list' | 'flair' | 'record' | undefined;
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
// Crisis detection
// ---------------------------------------------------------------------------

export type IncidentStatus = 'open' | 'resolved';

export interface Incident {
  id: string;
  startedAt: number;
  reason: string;
  postIds: string[];
  commentIds: string[];
  status: IncidentStatus;
  resolvedAt?: number | undefined;
  resolvedBy?: string | undefined;
}

// ---------------------------------------------------------------------------
// Theme clustering
// ---------------------------------------------------------------------------

export interface Theme {
  name: string;
  summary: string;
  samplePostIds: string[];
  postCount: number;
  avgSentiment: number;
}

export interface ThemeSnapshot {
  generatedAt: number;
  themes: Theme[];
}

// ---------------------------------------------------------------------------
// Pipeline system — Templates (catalogue) + Instances (installed, running)
// ---------------------------------------------------------------------------

export type PipelineKind = 'categorical' | 'ordinal' | 'cluster' | 'scalar' | 'boolean';
export type PipelineTrigger = 'post-create' | 'comment-create' | 'status-change' | 'scheduled';
export type PipelineOutputSchema =
  | 'single-label'
  | 'label-confidence'
  | 'boolean'
  | 'scalar'
  | 'cluster';
export type PipelineCategory = 'tagging' | 'scoring' | 'flagging' | 'clustering' | 'extraction';

/** Which UI surfaces this pipeline instance's output should appear in. */
export type PipelineShowIn = 'insights' | 'incidents' | 'team' | 'audit';

// ---------------------------------------------------------------------------
// Template — immutable catalogue entry defined in code
// ---------------------------------------------------------------------------

export interface PipelineTemplateConfig {
  trigger: PipelineTrigger;
  systemPrompt: string;
  userPrompt: string;
  outputSchema: PipelineOutputSchema;
  labels?: string[] | undefined;
  threshold?: number | undefined;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  category: PipelineCategory;
  kind: PipelineKind;
  iconEmoji?: string | undefined;
  defaultConfig: PipelineTemplateConfig;
  /** Which fields mods are allowed to override when installing or tuning. */
  configurable: Array<'systemPrompt' | 'userPrompt' | 'labels' | 'threshold' | 'trigger'>;
  example?: { input: string; output: string } | undefined;
  /** The module key used for stats lookup in the admin debug endpoint */
  moduleKey?: string | undefined;
  /** Human-readable description of the processing chain */
  logic?: string | undefined;
  /** Alpha templates are stubbed / not yet fully functional */
  alpha?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Instance — Redis-stored, mutable, installed from a template or from scratch
// ---------------------------------------------------------------------------

export type PipelineInstanceSource = 'preinstalled' | 'installed' | 'scratch';

export interface PipelineInstanceConfig {
  trigger: PipelineTrigger;
  systemPrompt: string;
  userPrompt: string;
  outputSchema: PipelineOutputSchema;
  labels?: string[] | undefined;
  threshold?: number | undefined;
}

export interface PipelineInstance {
  id: string;
  templateId: string;
  name: string;
  description?: string | undefined;
  enabled: boolean;
  config: PipelineInstanceConfig;
  /**
   * - 'preinstalled' = shipped as default, cannot be deleted (but can be disabled)
   * - 'installed'    = mod clicked Install from catalogue
   * - 'scratch'      = mod created from blank (no template)
   */
  source: PipelineInstanceSource;
  createdAt: number;
  updatedAt: number;
  showIn: PipelineShowIn[];
  /** Display order in Pipelines tab (lower = earlier) */
  order?: number | undefined;
}

// ---------------------------------------------------------------------------
// Legacy Pipeline shape — kept for backward-compat with server routes that
// haven't been migrated yet. New code should use PipelineInstance.
// ---------------------------------------------------------------------------

/** @deprecated Use PipelineInstance */
export type PipelineSource = 'builtin' | 'custom';

/** @deprecated Use PipelineInstance */
export interface Pipeline {
  id: string;
  name: string;
  description?: string | undefined;
  kind: PipelineKind;
  trigger: PipelineTrigger;
  systemPrompt?: string | undefined;
  userPrompt?: string | undefined;
  outputSchema: PipelineOutputSchema;
  source: PipelineSource;
  enabled: boolean;
  labels?: string[] | undefined;
  order?: number | undefined;
  logic?: string | undefined;
  moduleKey?: string | undefined;
  alpha?: boolean | undefined;
  showIn?: Array<'insights' | 'pipelines' | 'incidents' | 'team' | 'audit'> | undefined;
}

export interface Tag {
  pipelineId: string;
  targetType: 'post' | 'comment';
  targetId: string;
  value: string | number | boolean;
  confidence?: number | undefined;
  by: 'lexicon' | 'ai' | 'manual';
  createdAt: number;
}

export interface TagDistributionEntry {
  value: string;
  count: number;
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
