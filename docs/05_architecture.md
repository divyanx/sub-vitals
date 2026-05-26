# 05 · Architecture

> Module contract, event flow, Redis schema. Read before changing structure.

## Module contract

Every feature is a `SubVitalsModule`:

```ts
// src/shared/types.ts
export interface SubVitalsModule {
  readonly name: string;
  readonly description: string;
  readonly tier: 'core' | 'pro' | 'enterprise';

  /** Feature flag — read from subreddit settings. */
  enabled(): Promise<boolean>;

  /** Optional event handlers — only define those the module cares about. */
  onAppInstall?(event: OnAppInstallRequest): Promise<void>;
  onAppUpgrade?(event: OnAppUpgradeRequest): Promise<void>;
  onPostCreate?(event: OnPostCreateRequest): Promise<void>;
  onPostUpdate?(event: OnPostUpdateRequest): Promise<void>;
  onCommentCreate?(event: OnCommentCreateRequest): Promise<void>;
  onModAction?(event: OnModActionRequest): Promise<void>;

  /** Optional API routes for the dashboard. Receive the Hono app. */
  apiRoutes?(app: Hono): void;
}
```

No `ctx` parameter. Modules import `context`, `redis`, `reddit`, `settings`, `scheduler` directly from `@devvit/web/server`. Real trigger payloads are imported from `@devvit/web/shared`.

## Event flow: PostCreate

```
1. User posts in r/<brand-sub>
2. Reddit's backend → PostCreate event (after automod)
3. Devvit platform → POST /internal/triggers/post-create  (body = OnPostCreateRequest JSON)
4. Server route handler:
     a. Parse body with Zod
     b. dispatcher.dispatch('PostCreate', body)
5. Dispatcher:
     a. For each module where module.onPostCreate exists AND module.enabled():
        run module.onPostCreate(body) wrapped in try/catch
     b. Promise.allSettled → one module throwing doesn't break others; errors logged
6. Server → 200 OK
```

Total budget: < 5s. Lexicon sentiment is sub-ms. Redis writes are ~5ms. The expensive path (LLM calls in Phase 2+) MUST defer with `scheduler.runJob`.

## Event flow: Menu action

```
1. Mod clicks "SubVitals · Tag issue" on a post
2. Devvit → POST /internal/menu/tag-issue  (body = { location, targetId })
3. Server route handler:
     a. Parse body with Zod
     b. requireMod() — if false, return 403 (Devvit shows an error toast)
     c. Look up post details, current tag from Redis
     d. Return a UI-effect response: { type: 'form', formName: 'tag-issue', data: {...} }
4. Devvit renders the form
5. Mod submits form
6. Devvit → POST /internal/forms/tag-issue  (body = { values: {...}, data: {...} })
7. Server route handler:
     a. Parse, requireMod()
     b. Write tag to Redis (atomic hIncrBy on rollup)
     c. Return { type: 'toast', text: '✓ Tagged' }
```

## Redis schema

All keys prefixed `rl:`. Per-installation isolation is automatic; we don't include subreddit name in keys (Devvit Redis auto-scopes it).

| Key | Type | Atomicity | Owner module |
|---|---|---|---|
| `rl:tx` | STRING (JSON) | RMW | contact-drivers (taxonomy) |
| `rl:tag:{postId}` | STRING (JSON) | overwrite | contact-drivers |
| `rl:dr:idx:{driverId}` | ZSET | atomic | contact-drivers (post-by-driver index) |
| `rl:dr:roll:{date}` | HASH | hIncrBy ✓ | contact-drivers (daily counts) |
| `rl:ag:{username}` | STRING (JSON) | overwrite | agent-verification |
| `rl:ag:list` | ZSET | atomic | agent-verification (agent index) |
| `rl:sent:{contentId}` | STRING (JSON) | overwrite | sentiment |
| `rl:sent:roll:{date}` | HASH | hIncrBy ✓ | sentiment (daily breakdown) |
| `rl:sent:cd:{postId}` | STRING + TTL | overwrite | sentiment (alert cooldown, 4h) |
| `rl:proc:{handler}:{contentId}` | STRING + TTL | NX | shared idempotency (7d) |
| `rl:rl:{name}:{window}` | STRING + TTL | atomic incr | shared rate limit |
| `rl:cost:{YYYY-MM}` | STRING (number) | incrBy | shared LLM cost tracking |
| `rl:llm:cache:{hash}` | STRING (JSON) + TTL | overwrite | shared LLM response cache |
| `rl:perm:mod:{user}` | STRING + TTL | overwrite | permissions (5-min cache) |

**Why HASH for rollups:** lets us `hIncrBy(key, driverId, 1)` atomically. No race conditions under concurrent triggers.

## Permissions

```ts
// src/shared/permissions.ts
export async function requireMod(): Promise<boolean>;
```

- Reads `context.username` and `context.subredditName` (set per-request by Devvit).
- Checks 5-min Redis cache (`rl:perm:mod:{user}` → `'1'` or `'0'`).
- On cache miss: calls `reddit.getModerators({subredditName}).all()` and checks membership.
- **Fail-closed:** any error (network, parse, missing context) returns `false`.

Every mutating endpoint in the server calls `requireMod()` first. Read-only `/api/*` routes also check (mods only); we'll relax for the Daily Pulse pinned post which is public-readable separately.

## Idempotency

```ts
// src/shared/idempotency.ts
export async function processedOnce(handler: string, contentId: string, ttlSec = 7 * 86400): Promise<boolean>;
```

Returns `true` if this is the first time we've seen `(handler, contentId)`, sets sentinel atomically. Returns `false` on repeat — caller skips.

Used in every handler that mutates a rollup.

## Rate limiting

```ts
// src/shared/ratelimit.ts
export async function takeToken(name: string, capacity: number, refillPerSec: number): Promise<boolean>;
```

Redis-backed token bucket per installation. Used to gate external HTTP calls (LLM providers in Phase 2+).

## LLM client (active — wires contact-drivers + sentiment)

```ts
// src/shared/llm.ts
export async function llmComplete(opts: LLMOptions): Promise<LLMResult>;
```

Wraps OpenAI / Gemini with:
- Provider abstraction (`opts.provider: 'openai' | 'gemini'`)
- Token bucket via `ratelimit.takeToken`
- AbortController timeout (15s default)
- Exponential backoff + jitter on 429/503 (max 3 retries)
- Response cache by `sha256(prompt)` for 24h
- Cost tracking — increments `rl:cost:{YYYY-MM}` per call; hard cap configurable

Both `contact-drivers` and `sentiment` call this with structured-output Zod schemas as a hybrid escalation layer. Lexicon wins when it's confident; LLM augments when it isn't. The client returns a discriminated-union `LLMResult<T>` and never throws — callers always have a deterministic fallback.

## Logger

```ts
// src/shared/log.ts
export const log: { info(msg, fields?), warn(msg, fields?), error(msg, fields?) };
```

- Structured JSON to stdout (Devvit captures it).
- Auto-includes `subredditName`, `userId`, `traceId` from `context`.
- Never logs values from settings whose keys end in `-key` or `-secret`.
- One line per call.

No `console.log` allowed in module code — Biome lint rule enforces.

## Validation

Every external boundary uses Zod schemas in `src/shared/validation.ts`:
- Trigger payload schemas (one per `OnXxxRequest`)
- Menu request schema
- Form submission schemas
- API request body schemas
- Settings value schemas (post-parse from `settings.get`)

Modules consume `safeParse` results; failures log + skip rather than throw.
