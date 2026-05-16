# 01 · Decisions

> Every architectural call and *why*. Update this when you make a new one.

Format: each decision is a small ADR (Architecture Decision Record). When a decision is overturned, leave the old one in place with a "**Superseded by ADR-NN**" note — history is more useful than a tidy file.

---

## ADR-01 · Devvit Web, not classic Devvit Blocks

**Date:** 2026-05-16
**Status:** Accepted

**Context.** Devvit ships two paradigms. Classic Devvit (`@devvit/public-api`) uses a `main.tsx` with `Devvit.addTrigger/addMenuItem/addCustomPostType` and renders UI via Blocks (`vstack`/`hstack`/`text`). Devvit Web (`@devvit/web`) uses a `devvit.json` manifest that declares HTTP endpoints, a real HTTP server, and React in an iframe.

**Decision.** Devvit Web.

**Why.**
- RedLattice is fundamentally a multi-tab analytics dashboard. Devvit Web is purpose-built for that. Blocks is purpose-built for in-feed games/widgets.
- Reddit's 2025 hackathon center of gravity was Devvit Web. Hackathon judges will recognize it as on-platform-strategy. A classic-Blocks dashboard reads as legacy.
- Pro-tier plans (external REST API for Sprinklr-style consumers, webhooks) need a real HTTP server. Classic Devvit doesn't provide one natively.
- The original scaffold mixed both paradigms (`devvit.json` Devvit-Web shape + `main.tsx` classic-style). The two don't compose. We picked the side that fits this product.

**Consequences.** Server code imports singletons from `@devvit/web/server` (no `ctx` param). Custom post is a React iframe, not Blocks. Settings live in `devvit.json`, not `Devvit.addSettings`. We lose access to classic-only Blocks niceties (e.g. `useWebView` from a Blocks render function) — fine, we don't need them.

---

## ADR-02 · Pin every dependency

**Date:** 2026-05-16
**Status:** Accepted

**Context.** The original scaffold pinned `@devvit/public-api: "latest"`. Two days later "latest" could be a different major. Reproducible builds matter.

**Decision.** Every dep in `package.json` is pinned to an exact version (no `^` or `~`). When we upgrade, we do it deliberately and test.

**Why.** `npm install` should produce the same `node_modules` today and three weeks from now. Drift bugs in a hackathon are the worst kind — you didn't change anything but something stopped working.

---

## ADR-03 · State-of-the-art toolchain

**Date:** 2026-05-16
**Status:** Accepted

| Choice | Picked | Why |
|---|---|---|
| Language | TypeScript 6.0 | Latest. Better inference, faster checks. |
| Bundler | Vite 8 | Industry standard for React SPAs. Native ESM, fast HMR. |
| UI lib | React 19 | Latest. New hooks (`use`, `useActionState`) where useful. |
| State/fetch | TanStack Query 5 | Best-in-class server-state lib. Caching, retries, mutations. |
| Styling | Tailwind v4 | CSS-first config (no `tailwind.config.js`). Better build perf. |
| Server | Hono 4.12 | Fast, web-standard fetch API, runs on Devvit's `createServer`. Express is legacy. |
| Validation | Zod 4 | Best DX, smaller bundle than Zod 3, better type inference. |
| Tests | Vitest 4 | Vite-native, ESM-first. Jest is legacy. |
| Lint/format | Biome 2 | Replaces ESLint + Prettier with a single Rust binary. Order of magnitude faster. |
| Hooks | simple-git-hooks | Lightweight (no Husky bloat). Runs lint + type-check + tests pre-commit. |
| Charts | Recharts 3 | Production-grade React charts. |

We pick latest because the hackathon submission will be scored partly on code quality / modernity, and because picking older tools means re-doing this decision later.

---

## ADR-04 · One React bundle for both Daily Pulse and Dashboard

**Date:** 2026-05-16
**Status:** Accepted

**Context.** RedLattice has two surfaces:
1. **Daily Pulse** — a pinned post in the brand subreddit, auto-updating, glanceable.
2. **Dashboard** — the full multi-tab analytics surface (Overview / Drivers / Sentiment / Agents / Settings).

We could build these as two separate apps, or as one React app with different views.

**Decision.** One React bundle. View chosen by URL query string (`?view=pulse` vs default). The pinned-post entrypoint mounts the same React app pointed at the `pulse` route; the "Open Dashboard" subreddit-menu action opens the same app at the default route.

**Why.**
- One codebase, one design system, one place to fix bugs.
- TanStack Query cache works across both views — opening the dashboard after viewing the pinned post is instant.
- The "pulse" view can be a richer mini-dashboard than what Blocks would give us — small bar charts, sparklines, real interactivity — without a separate Blocks UI to maintain.

**Consequences.** Slightly larger initial bundle for the pinned post than a Blocks-only summary would be. We mitigate with code-splitting if it matters in practice.

---

## ADR-05 · Redis HASH + hIncrBy for rollups

**Date:** 2026-05-16
**Status:** Accepted

**Context.** Daily rollups (e.g. "today's driver counts by category") could be stored as a single JSON blob per day, requiring read-modify-write to increment a count. Devvit triggers can fire in parallel; concurrent increments race and lose updates.

**Decision.** Each daily rollup is a Redis HASH with one field per counter. Increments use `redis.hIncrBy` — atomic, no race.

**Why.** Read-modify-write JSON blobs are the #1 way Devvit apps undercount in practice. `hIncrBy` is what Redis exists for. Marginal complexity is zero — we just call `hIncrBy(key, field, 1)` instead of `get`/`parse`/`++`/`set`.

**Schema.**
- `rl:dr:roll:{date}` → HASH, fields = driver IDs, values = counts. Plus a `__total__` field for total posts.
- `rl:sent:roll:{date}` → HASH, fields = `positive` / `neutral` / `negative` / `score_sum` / `total`. Average score derived from `score_sum / total` on read.

(Key prefix is `rl:` for RedLattice; the legacy spec used `bp:`. We're not maintaining backward compatibility — this is a fresh build.)

---

## ADR-06 · Module contract drops `ctx`

**Date:** 2026-05-16
**Status:** Accepted

**Context.** Classic Devvit passes `ctx` (with `ctx.redis`, `ctx.reddit`, etc.) into every handler. Devvit Web has an async-local `context` you `import` from `@devvit/web/server` plus separate `redis`/`reddit`/`settings`/`scheduler` singletons.

**Decision.** Our `RedLatticeModule` interface takes only the typed event payload, no `ctx`. Modules import what they need.

**Why.** It matches the platform. Passing a synthetic `ctx` just to mirror the classic API would be a leaky abstraction that bites us later when we hit something `ctx` doesn't cover.

---

## ADR-07 · Fail closed on permission checks

**Date:** 2026-05-16
**Status:** Accepted

**Context.** `requireMod()` queries Reddit's mod list. Reddit's API can be flaky; the request can fail.

**Decision.** If the mod check fails (network error, timeout, anything), `requireMod()` returns `false` and the action is denied. Caller surfaces a clear error to the user.

**Why.** A momentary Reddit hiccup must not let a non-mod execute a mod-only action. The alternative ("if we can't check, assume mod") is a security bug. The 5-minute cache (legitimately-mod users have their status cached) keeps the failure window small.

---

## ADR-08 · Sentinel-key idempotency on every rollup write

**Date:** 2026-05-16
**Status:** Accepted

**Context.** PostCreate / CommentCreate triggers can fire more than once for the same content in edge cases (Devvit platform retries, automod re-approval flows). If a module increments a counter on each fire, counts drift up.

**Decision.** Every write that affects a counter is gated by an idempotency sentinel: `rl:proc:{handlerName}:{contentId}` set with a 7-day TTL on first processing. If already set, skip.

**Why.** Atomic `hIncrBy` is great for ordering; idempotency is a separate guarantee. Together they give correct counts under any retry behavior.

---

---

## ADR-09 · LLM tagging via OpenRouter, hybrid with lexicon

**Date:** 2026-05-17
**Status:** Accepted

**Context.** Phase 1 shipped with keyword-only contact-driver classification and AFINN-only sentiment. Both are deterministic and free but miss subtle cases (sarcasm, multi-issue posts, anything not blatantly worded). Hackathon scoring rewards demos of real AI in action.

**Decision.** Use **OpenRouter** (OpenAI-compatible meta-provider) via the **Vercel AI SDK 6** with `@ai-sdk/openai-compatible`. Default model `anthropic/claude-haiku-4.5` (configurable per-installation via the `llm-model` global setting). Pipelines are **hybrid** — lexicon runs first as a fast/free pass; LLM is invoked only when the lexicon answer is weak.

**Why OpenRouter.** One key gives access to every model worth using (Anthropic, OpenAI, Google, Meta, Mistral, ...). Per-installation model swap without redeploy. Single billing surface. Standard OpenAI-compatible API so we never get locked in.

**Hybrid escalation rules.**
- **contact-drivers:** lexicon first → if no match or `confidence < 0.6`, call LLM with structured output enforcing categories from the current taxonomy. Tag stored with `taggedBy='ai'` + the model's reasoning.
- **sentiment:** lexicon first → if `|score| < 0.15` AND text length ≥ 12 chars, escalate. Otherwise lexicon wins. Score stored with `scoredBy='ai'` for LLM-judged.

**Cost control.** Every call gates through `src/shared/llm.ts` which:
- Reads `openrouter-api-key` (global setting, encrypted) — returns failure if missing
- Estimates per-call cost from token counts × a per-model cents table; cumulative spend tracked in `rl:cost:{YYYY-MM}` (HASH)
- Hard cap from `llm-monthly-cost-cap-cents` setting (default $5/mo per installation); LLM returns failure when exceeded → automatic fall-back to lexicon
- 24h SHA-256 prompt-hash response cache in `rl:llm:cache:{hash}`
- Token-bucket rate limit (60 req/min) shared across all LLM calls per installation
- AbortController 15s timeout, p-retry 3x exponential backoff + jitter
- Never throws — returns `LLMResult<T> = success | { ok:false, reason }`. Callers always have a clean fallback path.

**Consequences.**
- The dashboard shows `taggedBy: 'ai' | 'auto' | 'manual'` and `scoredBy: 'lexicon' | 'ai'` badges, so mods can see what made each decision.
- AI spend appears as a card on the Overview tab — operators see what it's costing them.
- Setting the cap to 0 effectively disables AI without uninstalling.

## ADR-10 · CSV export as primary external-integration path

**Date:** 2026-05-17
**Status:** Accepted

**Context.** "Will Redis support professional use cases?" was the right question to ask. Devvit Redis is great for the operational tier (counters, recent activity) but isn't suited for long retention, ad-hoc analytics, or being a data source for Sprinklr / Khoros / a customer's data warehouse.

**Decision.** Expose `GET /api/export/posts.csv?limit=N` (mod-only, same-origin via dashboard). Customers who need real warehouse analytics poll this endpoint and ingest into their own systems.

**Why CSV.** Universal. Every BI tool, every warehouse loader, every spreadsheet accepts it. Phase 2 will add bearer-token auth + an additional JSON pull endpoint for fully programmatic ingestion.

**Consequences.** RedLattice positions cleanly as "the on-Reddit analytics tier"; customers wire the CSV pull into their existing CX stack in 30 minutes. No partnership negotiation needed.

