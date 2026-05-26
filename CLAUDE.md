# RedLettuce — Claude Code Instructions

This file is auto-loaded every Claude Code session in this directory. Keep it concise and load-bearing; long-form context belongs in `docs/`.

## What this is

Native CX analytics for Reddit brand communities, built on **Devvit Web** (`@devvit/web@0.12.23`). Hackathon target May 27, 2026.

Three Phase 1 modules: agent-verification, contact-drivers, sentiment. Don't build anything else until those three are production-quality.

## Read first

- `docs/01_decisions.md` — every architectural decision and *why*. Update it when you make a new one.
- `docs/03_devvit_web_primer.md` — Devvit Web concepts. Verify Devvit-specific assumptions here before guessing.
- `docs/05_architecture.md` — module contract, event flow, Redis schema.

## Hard rules

1. **Devvit Web only.** `@devvit/public-api` (classic) does NOT work. No `Devvit.add*`, no `main.tsx`. Server-side, import singletons from `@devvit/web/server` (`context`, `redis`, `reddit`, `settings`, `scheduler`). Client-side, from `@devvit/web/client`.
2. **No `ctx` parameter on handlers.** Devvit Web has an async-local `context` you import. Module handlers take only the trigger/menu/form payload.
3. **Redis TTL is `Date`, not seconds.** `redis.set(k, v, { expiration: new Date(Date.now() + 5 * 60_000) })`. The internal conversion to seconds happens inside `RedisClient.set`. Confirmed in `node_modules/@devvit/redis/RedisClient.js` (it subtracts `Date.now()` and divides by 1000). For atomic claim-once semantics use `redis.hSetNX(key, field, value)` which returns `1 | 0`, then `redis.expire(key, seconds)` for TTL.
4. **Strict TypeScript.** No `any`, no `@ts-expect-error`, no `as unknown as`. If a signature doesn't match, look up the real one in `node_modules/@devvit/*/index.d.ts` — that's source of truth.
5. **Production-quality bar.** Every external HTTP call wrapped in ratelimit + retry + timeout + cost tracking. Every mutating endpoint behind `requireMod()`. Every payload validated with Zod. Every write to rollups idempotent (sentinel key). Structured JSON logging only.
6. **HASH-based rollups.** Daily rollups use Redis `hIncrBy` (atomic). Never read-modify-write JSON blobs.
7. **Lexicon over LLM for Phase 1.** Sentiment is AFINN-style scoring. AI scoring is Phase 2 behind a feature flag.

## Devvit gotchas (don't relearn these)

- ModAction triggers can't be filtered at registration — filter the action type inside the handler.
- Settings scope is sticky after deploy. Don't move a setting between `global` and `subreddit` once shipped.
- Trigger handlers should complete in <5s. Defer LLM/Reddit-heavy work to `scheduler.runJob({...})`.
- PostCreate fires after automod approval (use it to avoid scoring spam). PostSubmit fires earlier.
- WebView iframe has no localStorage. State goes in Redis.
- Reddit content is markdown — escape before echoing into modmail.

## Workflow

- Before changing architecture: read `docs/05_architecture.md`.
- Before each non-trivial change: state the plan in chat, wait for approval.
- Commit per logical unit. Reference `docs/` section in commit messages.
- When stuck on a Devvit specific: grep `node_modules/@devvit/*/index.d.ts` first. If still unclear, stop and ask.

## Phase 2+ — DO NOT BUILD before May 27

`pii-guardian`, `response-analytics`, `ai-detector`, outbound webhooks, bearer-token REST. If a Phase 1 task tempts you toward these, name the temptation and drop it.
