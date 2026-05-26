# 03 · Devvit Web primer

> What you need to know about Devvit Web to be productive. ~15 min if you're new to it.

## The mental model

A Devvit Web app is **a node HTTP server plus a static React bundle**, hosted by Reddit's platform. The platform reads `devvit.json` to learn:

- Which URLs serve as **trigger handlers** (Reddit POSTs to your server when a trigger fires)
- Which URLs serve as **menu action handlers** (Reddit POSTs when a mod clicks a menu item)
- Which URLs serve as **scheduler handlers** (cron jobs)
- Which URLs serve as **form submission handlers**
- Where your static React bundle lives (Reddit serves it as the post iframe)
- What **permissions** your app needs (Reddit API, Redis, allowed outbound HTTP domains, etc.)
- What **settings** mods see in the configuration page (typed schema with global vs subreddit scope)

Everything that classic Devvit does via `Devvit.add*` calls in `main.tsx`, Devvit Web does via `devvit.json` + HTTP routes.

## The two halves of `@devvit/web`

### `@devvit/web/server` — used inside `src/server/` and `src/modules/`

```ts
import {
  context,           // async-local per-request context; holds subredditName, userId, postId, etc.
  createServer,      // node-http compatible server constructor — Reddit's runtime injects this
  getServerPort,     // returns the port we should listen on
  reddit,            // RedditClient — getModerators, getCommentById, modMail.createConversation, …
  redis,             // RedisClient — set/get/hSet/hIncrBy/zAdd/zRange/expire/…
  settings,          // SettingsClient — settings.get('agent-whitelist')
  scheduler,         // SchedulerClient — scheduler.runJob({name, data, runAt})
} from '@devvit/web/server';
```

Key gotcha: **none of these singletons take a `ctx` argument**. They all read from the async-local `context` set up by Devvit's runtime per request. The server code never has to thread `ctx` around like classic Devvit does.

### `@devvit/web/client` — used inside `src/post/`

```ts
import { context, /* effects, hooks, ... */ } from '@devvit/web/client';
```

`context` on the client has the same shape as server (subredditName, userId, postId) but is populated by the iframe host on mount.

### `@devvit/web/shared` — used in both

```ts
import type {
  TriggerRequest,
  OnPostCreateRequest,
  OnCommentCreateRequest,
  OnModActionRequest,
  // ...
} from '@devvit/web/shared';
```

These are the **real** trigger payload types, defined by Reddit's protos. They're discriminated unions on the `type` field.

## How a trigger fires (end-to-end)

A user submits a post. The flow:

1. Reddit's backend emits a `PostCreate` event (fires after automod approval, so it's post-spam-filter).
2. Devvit platform looks at our `devvit.json` `triggers.onPostCreate` → `/internal/triggers/post-create`.
3. Reddit's platform POSTs to our server at that path. The body is `OnPostCreateRequest` (JSON).
4. Our Hono server's route handler parses the body with Zod, then calls `dispatcher.dispatch('PostCreate', payload)`.
5. The dispatcher finds every module subscribed to `onPostCreate`, runs them in parallel with failure isolation (one module throwing doesn't break the others).
6. Each module reads `context.subredditName`, `context.userId`, etc. as needed, calls `redis.hIncrBy(...)` for atomic rollup updates, returns.
7. Server responds `200 OK`.

The whole fan-out must finish in **< 5 seconds** (the platform kills handlers around 30s but you want headroom). Anything slow (LLM calls, large Reddit API queries) gets deferred to a scheduler job we trigger from inside the handler.

## How a menu action fires

A mod clicks "SubVitals · Tag issue" on a post. The flow:

1. Reddit POSTs to our server at the endpoint we declared in `devvit.json` `menu.items[].endpoint`.
2. The body is `{ location: "post", targetId: "t3_xyz" }`.
3. The handler validates with Zod, checks `requireMod()`, then returns a **UI effect response** — a JSON object telling Devvit "show a form", "show a toast", "open a webview", etc.

The UI effect response format comes from `@devvit/web/server`'s effect types. For "show a form" we register the form under `forms.{name}` in `devvit.json` (pointing at another endpoint that handles the submission) and reference it in the response.

## How the React iframe app talks to the server

The React app in `src/post/` runs inside an iframe Reddit owns. `fetch('/api/foo')` works as same-origin — Reddit's platform routes those requests to our server. We use TanStack Query to wrap each fetch:

```tsx
const { data } = useQuery({
  queryKey: ['dashboard-summary'],
  queryFn: () => fetch('/api/dashboard/summary').then(r => r.json()),
});
```

Routes under `/api/*` are mod-only (the server's middleware checks). Routes under `/internal/*` are platform-only (we never expose them to the React app). Public read-only routes don't exist in Phase 1.

## Settings: global vs subreddit

```jsonc
// devvit.json
"settings": {
  "global": {
    "openai-api-key": { "type": "string", "isSecret": true, ... }
  },
  "subreddit": {
    "sentiment-threshold": { "type": "number", "defaultValue": 5, ... }
  }
}
```

- **Global settings** are app-wide, set by the developer via `devvit settings set <name>`. Encrypted at rest. Used for API keys.
- **Subreddit settings** are configured by each subreddit's mod team in the Devvit settings page. Used for per-sub config (taxonomy, thresholds, agent whitelist).

**Gotcha:** scope is sticky after deploy. If you ship a setting as `subreddit` and later move it to `global`, the old encrypted value shadows the new schema and things break in confusing ways. Decide scope once and commit.

## Redis client

`@devvit/redis`'s `RedisClient` exposes the standard Redis ops: `set/get/del/exists/incr/incrBy/expire/hSet/hGet/hIncrBy/hGetAll/hDel/zAdd/zRange/zRem/zRemRangeByScore/...` Per-installation isolation is automatic — two subreddits installing SubVitals can use the same key strings without colliding.

Critical syntax note:

```ts
await redis.set('rl:foo', '1', { expiration: new Date(Date.now() + 300_000) });   // ✅ Date
await redis.set('rl:foo', '1', { expiration: 300 });                              // ❌ wrong shape
```

The `expiration` field is a `Date` (Devvit's RedisClient converts to seconds internally relative to `Date.now()`). For TTL on existing keys use `redis.expire(key, seconds)` — *that* one is `number` of seconds. For atomic claim-once semantics prefer `redis.hSetNX(key, field, value)` (returns `1` if set, `0` if existed) plus a follow-up `redis.expire(...)`.

## Reddit client

```ts
import { reddit } from '@devvit/web/server';

const comment = await reddit.getCommentById('t1_xxx');
const mods = await reddit.getModerators({ subredditName: 'r/foo' }).all();
await reddit.modMail.createConversation({ subredditId, to: null, subject: '…', body: '…' });
```

Pagination returns a `Listing` you can iterate with `.all()` for everything or `.next()` page-at-a-time.

## When something's unclear

The real source of truth is in `node_modules`:

```bash
node_modules/@devvit/web/server/index.d.ts          # what's exported
node_modules/@devvit/web/shared/index.d.ts          # shared types
node_modules/@devvit/redis/index.d.ts               # redis API
node_modules/@devvit/reddit/index.d.ts              # reddit API
node_modules/@devvit/settings/index.d.ts            # settings API
node_modules/@devvit/scheduler/index.d.ts           # scheduler API
node_modules/@devvit/shared-types/schemas/config-file.v1.d.ts   # devvit.json schema
```

`grep`-ing those is faster and more reliable than searching docs.
