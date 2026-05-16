# BrandPulse — Project Context for Claude Code

> This file is auto-loaded by Claude Code on every session. It's the durable context bridge between planning (done in Claude.ai) and execution (here).

---

## What this is

Native CX analytics suite for Reddit brand subreddits (r/Sonos, r/OpenPhone, r/Fidelity-style communities), built on Reddit's Devvit platform.

- **Hackathon deadline**: May 27, 2026 — targeting Best New Mod Tool category ($20K prize)
- **Long-term play**: Reddit Developer Funds (up to $167K per app, $500K cap across 3 apps) + Pro/Enterprise tier subscriptions
- **Strategic moat**: Sprinklr-style customer experience analytics, native to Reddit, zero direct competition on Devvit

## Background on the developer (me)

- Work at Sprinklr on contact drivers, quality management, CSAT products — domain expert in CX analytics
- Solo side project — **cannot use Sprinklr APIs or claim partnership**
- Comfortable with AI pipelines (this is my professional area)
- **New to Reddit and Devvit specifically** — please verify Devvit-specific assumptions against developers.reddit.com, don't take my word on platform details
- Based in India (Gurugram); timezone IST

## Architecture summary

Full detail in `docs/03_architecture_spec.html`. Quick version:

- **One Devvit app, two render surfaces**:
  - Classic Blocks (vstack/hstack/text/button) for menu actions and the Daily Pulse custom post — feels 100% native
  - Devvit Web (Vite + React + Hono) for the full analytics dashboard — rich UI freedom
- **Module pattern**: every feature is a `BrandPulseModule` (see `src/shared/types.ts`)
- **Central dispatcher** (`src/shared/dispatcher.ts`) fans trigger events to all enabled modules with **failure isolation** — one module throwing cannot break the others
- **Redis only** for persistence — Devvit auto-scopes per-installation. Key schemas centralized in `src/shared/storage.ts` under the `K.*` namespace
- **Hono server** at `src/server/index.ts` powers the webview dashboard API; each module registers its own routes via `mod.apiRoutes(app)`

## Phase 1 MVP scope (hackathon — DO NOT EXCEED)

Three modules, fully implemented and polished:

1. **agent-verification** — settings whitelist + mod menu actions to mark/unmark verified company agents
2. **contact-drivers** — manual tagging form + keyword-based auto-suggest on PostSubmit (NO AI tagging in Phase 1)
3. **sentiment** — AFINN-style lexicon scoring on every post and comment + escalation modmail when threads trend negative

Plus:
- Daily Pulse custom post (Blocks UI pinned post)
- WebView dashboard (Overview, Drivers, Sentiment, Agents, Settings tabs)
- Settings page wired up correctly (App-scope secrets vs Installation-scope mod config)

## Phase 2+ scope (POST-hackathon — DO NOT BUILD before May 27)

- pii-guardian — regex + LLM PII detection and redaction
- response-analytics — first-response SLA tracking via verified-agent comment timestamps
- ai-detector — AI-generated content classifier (perplexity + LLM judge)
- Outbound webhooks for external CX tools
- Bearer-token REST API for Sprinklr-style integrations

If during Phase 1 you find yourself drifting toward any of these, STOP and refocus. Polish on the three Phase 1 modules beats feature breadth every time.

## Production-quality bar (non-negotiable)

This is being installed by real brand subreddits handling real user data. Hackathon-demo quality is not the bar; production quality is.

### Security
- No secret ever logged, even in error paths
- All API keys via App-scope settings with `isSecret: true` (never in code, never Installation-scope)
- Input validation on every Hono route and every form handler — use Zod
- Every mutating handler calls `requireMod()` first, no exceptions
- Sanitize user-provided text before storing or echoing into modmail (modmail is markdown — escape it)
- Fail closed on permission check failures, not open

### Rate limiting & LLM cost control
- Every external HTTP call wrapped in a Redis-backed token bucket per installation
- Exponential backoff with jitter on 429/503; max 3 retries; 15s AbortController timeout
- Per-installation monthly cost tracking in `bp:cost:{sub}:{YYYY-MM}` with configurable hard cap
- Cache LLM responses by content hash for 24h — same content scored twice shouldn't bill twice
- Reddit API calls batched; never loop `getCommentById` when `getComments` works

### Reliability
- Every trigger handler completes in <5s; defer expensive work (LLM) to scheduler queues
- Idempotency guard on every write that affects rollups (`bp:processed:{contentId}` sentinel, 7-day TTL)
- Daily rollups migrated from JSON-blob read-modify-write to Redis HASH + HINCRBY (atomic)
- Graceful degradation: Redis down → log and continue; LLM down → fall back to lexicon/regex

### Observability
- Structured JSON logging only — use `src/shared/log.ts` helper, no raw console.log
- Per-module counters in Redis: events_received, events_processed, events_failed, llm_calls, llm_tokens, llm_cost_cents
- `/api/admin/debug` endpoint (mod-only) for stats inspection

### Testing
- Vitest for all pure-logic units (lexicon, keyword suggester, PII regex when added)
- Hono routes tested against stubbed Redis
- Pre-commit hook runs type-check + tests

## Known Devvit gotchas

These are documented but easy to forget — re-check before assuming behavior:

1. **ModAction triggers cannot be filtered at registration** — filter the action type inside the handler
2. **Settings scope is sticky after deploy** — if you change a setting from App-scope to Installation-scope (or vice versa) after deploy, the old encrypted value shadows the new one. Pick the scope once, commit to it.
3. **Trigger handler timeout** ~30s but aim for <5s. Devvit will kill long handlers.
4. **Triggers have no UI context** — you cannot `ctx.ui.showToast` from a trigger. Use modmail or scheduler-driven notifications.
5. **No SQL, Redis only** — design key access patterns up front, no joins to fall back on
6. **WebView is iframed** — no localStorage; use Redis for all state
7. **PostSubmit can fire twice** for the same post under edge cases — idempotency guard is mandatory
8. **Reddit content is markdown** — escape it before echoing into modmail or anywhere markdown is rendered

## Workflow rules

- Read `docs/03_architecture_spec.html` before changing architecture
- Verify against developers.reddit.com when uncertain about Devvit specifics — the API evolves
- Run `npm run type-check` before every commit; tests must pass
- Test on a private subreddit with <200 members (Devvit playtest requirement)
- Commit per logical unit; reference architecture spec sections in commit messages where relevant
- When stuck on Devvit specifics you can't resolve from docs, **stop and ask** — don't guess

## Day-by-day plan

Today is May 16, 2026. Deadline May 27 (11 days). Detailed daily plan in README.md.

Compressed version:
- Days 1–2: Foundation (production primitives, scaffold compiles, playtest runs)
- Day 3: Agent Verification end-to-end
- Days 4–5: Contact Drivers manual + auto-suggest
- Day 6: Sentiment scoring + escalation modmail
- Day 7: Daily Pulse custom post
- Days 8–9: Polish, permissions hardening, dashboard styling
- Day 10: Test sub seeding + demo recording
- Day 11: Submission
- Day 12 (May 27): Buffer

## Commands

```bash
npm install                  # install deps
npx devvit login             # auth to Reddit
npm run dev                  # devvit playtest — live reload on test sub
npm run type-check           # tsc + eslint + prettier check
npm run build                # production build
npm run deploy               # upload new version to app directory
npm run launch               # publish for review (post-hackathon)
npx devvit settings set KEY  # set App-scope secrets (encrypted at rest)
```

## Reference documents

- `docs/01_research_brief.html` — Devvit platform anatomy, integration surfaces, UI standards, monetization
- `docs/03_architecture_spec.html` — module contract, event flows, Redis schema, failure modes, phasing
- `README.md` — project layout, getting started, daily build plan
